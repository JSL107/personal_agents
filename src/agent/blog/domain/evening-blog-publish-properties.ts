// 저녁 회고 블로그 초안을 "블로그 초안" DB 행으로 적재할 때 채우는 속성.
// 속성명과 select 값은 대상 DB 의 기존 스키마와 정확히 일치해야 한다
// (출처유형=[웹,PR,메모] / 상태=[초안,검토,발행] / 카테고리=[... 개발 회고 ...]).
// 자연어 경로(blog-publish-properties.ts)와 달리 env 오버라이드를 두지 않는다 — 설정만 늘고 이득이 없다.
export const EVENING_BLOG_PROP = {
  tags: '태그',
  sourceType: '출처유형',
  category: '카테고리',
  status: '상태',
} as const;

// 저녁 회고는 그날 머지된 PR 을 근거로 쓴다.
export const EVENING_BLOG_SOURCE_TYPE = 'PR';
export const EVENING_BLOG_CATEGORY = '개발 회고';
export const EVENING_BLOG_STATUS = '초안';

// Notion multi_select 옵션명은 쉼표를 포함할 수 없고 과도하게 길면 거부된다.
// 키워드는 모델 출력이라 두 조건 모두 깨질 수 있어 방어적으로 정리한다.
const TAG_MAX_LENGTH = 100;
const MAX_TAGS = 10;

const toSafeTag = (raw: string): string =>
  raw.replace(/,/g, ' ').trim().slice(0, TAG_MAX_LENGTH);

export const toSafeTags = (keywords: string[]): string[] => {
  const seen = new Set<string>();
  for (const keyword of keywords) {
    const safe = toSafeTag(keyword);
    if (safe.length > 0) {
      seen.add(safe);
    }
  }
  return [...seen].slice(0, MAX_TAGS);
};

// Notion API properties payload 구성. 출처유형/카테고리/상태는 항상, 태그는 값이 있을 때만.
export const buildEveningBlogProperties = (
  keywords: string[],
): Record<string, unknown> => {
  const properties: Record<string, unknown> = {
    [EVENING_BLOG_PROP.sourceType]: {
      select: { name: EVENING_BLOG_SOURCE_TYPE },
    },
    [EVENING_BLOG_PROP.category]: { select: { name: EVENING_BLOG_CATEGORY } },
    [EVENING_BLOG_PROP.status]: { select: { name: EVENING_BLOG_STATUS } },
  };
  const tags = toSafeTags(keywords);
  if (tags.length > 0) {
    properties[EVENING_BLOG_PROP.tags] = {
      multi_select: tags.map((name) => ({ name })),
    };
  }
  return properties;
};
