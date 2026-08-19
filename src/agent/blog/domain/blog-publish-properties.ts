// 블로그 자동 발행 시 set 할 Notion DB 속성.
// 속성명은 사용자가 '블로그 초안' DB 에 만든 속성명과 **정확히 일치**해야 한다(Part A 셋업).
export interface BlogPublishPropertyNames {
  status: string;
  publishedAt: string;
  tags: string;
  summary: string;
}

export const DEFAULT_BLOG_PROP: BlogPublishPropertyNames = {
  status: '상태',
  publishedAt: '발행일',
  tags: '태그',
  summary: '요약',
};

export const DEFAULT_BLOG_STATUS_PUBLISHED = '발행';
export const DEFAULT_BLOG_STATUS_DRAFT = '초안';
// 편집 단계가 '발행 부적합' 으로 판정한 초안을 옮겨 두는 상태. 이 값이 없으면 같은 초안이
// 매일 다시 뽑혀 뒤에 있는 초안이 영구히 발행되지 않는다(선택 로직이 가장 오래된 1건 고정).
export const DEFAULT_BLOG_STATUS_HOLD = '보류';

export interface BlogPublishMeta {
  tags: string[];
  summary: string | null;
  publishedAt: string; // YYYY-MM-DD (KST)
}

// Notion API properties payload 구성. 상태=발행 + 발행일은 항상, 태그/요약은 값 있을 때만.
export const buildBlogPublishProperties = (
  { tags, summary, publishedAt }: BlogPublishMeta,
  propNames: BlogPublishPropertyNames = DEFAULT_BLOG_PROP,
  statusPublishedValue: string = DEFAULT_BLOG_STATUS_PUBLISHED,
): Record<string, unknown> => {
  const properties: Record<string, unknown> = {
    [propNames.status]: { select: { name: statusPublishedValue } },
    [propNames.publishedAt]: { date: { start: publishedAt } },
  };
  if (tags.length > 0) {
    properties[propNames.tags] = {
      multi_select: tags.map((name) => ({ name })),
    };
  }
  if (summary) {
    properties[propNames.summary] = {
      rich_text: [{ text: { content: summary } }],
    };
  }
  return properties;
};

// 상태 속성만 바꾸는 properties. 보류 전환은 발행일·태그·요약을 건드리지 않아야 한다 —
// 발행하지 않은 글에 발행일이 찍히면 다음 판정과 통계가 함께 어긋난다.
export const buildBlogStatusProperty = (
  statusValue: string,
  propNames: BlogPublishPropertyNames = DEFAULT_BLOG_PROP,
): Record<string, unknown> => ({
  [propNames.status]: { select: { name: statusValue } },
});
