import {
  EVENING_BLOG_PROP,
  toSafeTags,
} from './evening-blog-publish-properties';

// 딥다이브 초안이 들어가는 곳은 저녁 회고와 **같은 '블로그 초안' DB** 다. 속성명(EVENING_BLOG_PROP)과
// 태그 정리 규칙(toSafeTags)은 그 DB 의 스키마 사실이라 그대로 쓰고, 값만 이 출처에 맞게 바꾼다.
//
// 출처유형은 발행 순서를 정하는 키로도 쓰인다 — publish-notion-draft.usecase 의 selectDraft 가
// 이 값을 보고 오늘의 공부 초안을 먼저 집는다. 문자열이 갈리면 새치기가 조용히 사라지므로
// 양쪽이 이 상수 하나를 공유한다.
export const STUDY_DEEPDIVE_SOURCE_TYPE = '오늘의 공부';
export const STUDY_DEEPDIVE_CATEGORY = '기술 학습';
export const STUDY_DEEPDIVE_STATUS = '초안';

export const buildStudyDeepdiveBlogProperties = (
  tags: string[],
): Record<string, unknown> => {
  const properties: Record<string, unknown> = {
    [EVENING_BLOG_PROP.sourceType]: {
      select: { name: STUDY_DEEPDIVE_SOURCE_TYPE },
    },
    [EVENING_BLOG_PROP.category]: { select: { name: STUDY_DEEPDIVE_CATEGORY } },
    [EVENING_BLOG_PROP.status]: { select: { name: STUDY_DEEPDIVE_STATUS } },
  };
  const safeTags = toSafeTags(tags);
  if (safeTags.length > 0) {
    properties[EVENING_BLOG_PROP.tags] = {
      multi_select: safeTags.map((name) => ({ name })),
    };
  }
  return properties;
};
