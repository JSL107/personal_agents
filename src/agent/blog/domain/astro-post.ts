export interface AstroPostInput {
  title: string;
  description: string;
  slug: string;
  tags: string[];
  createdTime: string;
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

  const publishedAt = formatKstDateTime(input.createdTime);
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
  createdTime: string,
): {
  date: string;
  value: string;
} => {
  const timestamp = new Date(createdTime).getTime();
  if (Number.isNaN(timestamp)) {
    throw new Error('Invalid createdTime');
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
    `title: "${escapeYamlValue(input.title)}"`,
    `description: "${escapeYamlValue(input.description)}"`,
    `pubDatetime: ${input.publishedAt.value}`,
  ];
  if (input.tags.length > 0) {
    lines.push('tags:', ...input.tags.map((tag) => `  - ${tag}`));
  }
  lines.push('---');
  return lines.join('\n');
};

const escapeYamlValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
