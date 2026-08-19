export interface AstroPostInput {
  title: string;
  description: string;
  slug: string;
  tags: string[];
  // 글에 찍히는 날짜(KST). 초안을 쓴 날이 아니라 **발행하는 날**을 넘긴다 —
  // 밀린 초안이 과거 날짜로 발행되면 최신순 목록 아래에 묻힌다.
  publishedAt: string;
  pageId: string;
  body: string;
}

export interface AstroPost {
  path: string;
  content: string;
}

const KST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;

export const buildAstroPost = (input: AstroPostInput): AstroPost => {
  const description = input.description.trim();
  if (description.length === 0) {
    throw new Error('Astro post description is required');
  }
  const pageId = input.pageId.trim();
  if (pageId.length === 0) {
    throw new Error('Astro post pageId is required');
  }

  const publishedAt = formatKstDateTime(input.publishedAt);
  const slug = normalizeSlug(input.slug, pageId);
  const body = removeLeadingHeading(input.body);
  const frontmatter = buildFrontmatter({
    title: input.title,
    description,
    publishedAt,
    tags: input.tags,
  });

  return {
    path: `src/content/posts/${publishedAt.date}-${slug}.md`,
    content: `${frontmatter}\n\n${body}\n`,
  };
};

const formatKstDateTime = (
  isoTimestamp: string,
): {
  date: string;
  value: string;
} => {
  const timestamp = new Date(isoTimestamp).getTime();
  if (Number.isNaN(timestamp)) {
    throw new Error('Invalid publishedAt timestamp');
  }

  const kstDate = new Date(timestamp + KST_OFFSET_MILLISECONDS);
  const year = kstDate.getUTCFullYear();
  const month = pad(kstDate.getUTCMonth() + 1);
  const day = pad(kstDate.getUTCDate());
  const hour = pad(kstDate.getUTCHours());
  const minute = pad(kstDate.getUTCMinutes());
  const date = `${year}-${month}-${day}`;

  return { date, value: `${date}T${hour}:${minute}:00+09:00` };
};

const pad = (value: number): string => String(value).padStart(2, '0');

const normalizeSlug = (rawSlug: string, pageId: string): string => {
  const slug = rawSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > 0) {
    return slug;
  }

  return `notion-${pageId.slice(0, 8)}`;
};

const removeLeadingHeading = (body: string): string =>
  body.replace(/^# [^\r\n]*(?:\r?\n)?/, '').trim();

const buildFrontmatter = (input: {
  title: string;
  description: string;
  publishedAt: { value: string };
  tags: string[];
}): string => {
  const lines = [
    '---',
    `title: ${toYamlString(input.title)}`,
    `description: ${toYamlString(input.description)}`,
    `pubDatetime: ${input.publishedAt.value}`,
  ];
  if (input.tags.length > 0) {
    lines.push('tags:', ...input.tags.map((tag) => `  - ${toYamlString(tag)}`));
  }
  lines.push('---');
  return lines.join('\n');
};

// YAML 의 double-quoted 스칼라는 escape 규칙이 JSON 문자열과 호환된다. 직접 escape 하면
// 개행·탭·제어문자가 그대로 남아 frontmatter 구조를 깨뜨리고, 공개 저장소 main 에 커밋된
// 뒤에야 Astro 빌드 실패로 드러난다. tag 도 같은 이유로 quoting 없이 넣지 않는다.
const toYamlString = (value: string): string => JSON.stringify(value);
