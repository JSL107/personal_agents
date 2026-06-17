// 블로그 자동 발행 시 set 할 Notion DB 속성.
// 속성명은 사용자가 '블로그 초안' DB 에 만든 속성명과 **정확히 일치**해야 한다(Part A 셋업).
export const BLOG_PROP = {
  status: '상태',
  publishedAt: '발행일',
  tags: '태그',
  summary: '요약',
} as const;

export const BLOG_STATUS_PUBLISHED = '발행';

export interface BlogPublishMeta {
  tags: string[];
  summary: string | null;
  publishedAt: string; // YYYY-MM-DD (KST)
}

// Notion API properties payload 구성. 상태=발행 + 발행일은 항상, 태그/요약은 값 있을 때만.
export const buildBlogPublishProperties = ({
  tags,
  summary,
  publishedAt,
}: BlogPublishMeta): Record<string, unknown> => {
  const properties: Record<string, unknown> = {
    [BLOG_PROP.status]: { select: { name: BLOG_STATUS_PUBLISHED } },
    [BLOG_PROP.publishedAt]: { date: { start: publishedAt } },
  };
  if (tags.length > 0) {
    properties[BLOG_PROP.tags] = {
      multi_select: tags.map((name) => ({ name })),
    };
  }
  if (summary) {
    properties[BLOG_PROP.summary] = {
      rich_text: [{ text: { content: summary } }],
    };
  }
  return properties;
};
