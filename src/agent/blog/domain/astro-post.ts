/**
 * 블로그 저장소가 허용하는 분류 값. 태그와 달리 글마다 하나만 붙는다.
 *
 * 정본은 블로그 저장소의 `src/utils/categories.ts` 이고 거기서 zod enum 으로 강제한다 —
 * 여기 없는 값을 넣으면 발행 뒤 블로그 빌드가 깨진다. 값을 늘릴 때는 양쪽을 함께 고칠 것.
 * 옵셔널로 두는 이유는 블로그 스키마도 optional 이기 때문이다: 빠지면 화면에 '미분류' 로
 * 드러나므로, 값 하나 때문에 발행 전체를 막는 것보다 낫다.
 */
export const BLOG_CATEGORY_IDS = ['backend', 'web', 'infra', 'note'] as const;

export type BlogCategoryId = (typeof BLOG_CATEGORY_IDS)[number];

export const isBlogCategoryId = (value: string): value is BlogCategoryId =>
  (BLOG_CATEGORY_IDS as readonly string[]).includes(value);

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
  category?: BlogCategoryId;
}

export interface AstroPost {
  path: string;
  content: string;
}

const KST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;

const POST_PATH_PATTERN = /^src\/content\/posts\/\d{4}-\d{2}-\d{2}-(.+)\.md$/;

/**
 * 발행 경로에서 주제 식별자(slug)를 뽑는다. 경로를 만드는 규칙이 여기 있으므로 되읽는 규칙도
 * 같은 자리에 둔다 — 한쪽만 바뀌면 중복 판정이 조용히 빗나간다.
 *
 * 날짜를 떼는 이유는 그것이 **같은 주제를 다시 쓴 글을 가르는 유일한 차이**이기 때문이다.
 * 실제로 `2026-08-19-http-cache-...` 와 `2026-08-21-http-cache-...` 가 이틀 간격으로 나갔다.
 * 형식이 맞지 않으면 빈 문자열을 돌려준다 — 판정하는 쪽이 "모름"을 통과로 다루게 한다.
 */
export const extractPostSlug = (path: string): string =>
  POST_PATH_PATTERN.exec(path.trim())?.[1] ?? '';

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
    category: input.category,
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
  category?: BlogCategoryId;
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
  // 분류는 값이 있을 때만 적는다. 빈 값을 적으면 zod enum 이 거부해 블로그 빌드가 깨진다.
  if (input.category) {
    lines.push(`category: ${input.category}`);
  }
  lines.push('---');
  return lines.join('\n');
};

// YAML 의 double-quoted 스칼라는 escape 규칙이 JSON 문자열과 호환된다. 직접 escape 하면
// 개행·탭·제어문자가 그대로 남아 frontmatter 구조를 깨뜨리고, 공개 저장소 main 에 커밋된
// 뒤에야 Astro 빌드 실패로 드러난다. tag 도 같은 이유로 quoting 없이 넣지 않는다.
const toYamlString = (value: string): string => JSON.stringify(value);
