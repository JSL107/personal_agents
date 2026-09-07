import { REVISION_WINDOW_DAYS } from './revision-rate';

/** 규칙 추출에 사용할 최근 수정 글의 기간. 오래된 편집은 현재 편집 습관을 흐린다. */
export { REVISION_WINDOW_DAYS };

/** 1~2편의 수정은 개별 글 사정일 수 있어 성향으로 일반화하지 않는다. */
export const MIN_SOURCE_POSTS = 3;

/** 가장 크게 수정된 글에 집중하되 모델 호출 재료가 과도해지지 않도록 상위 3편만 보낸다. */
export const CONVENTION_SOURCE_LIMIT = 3;

/** 규칙을 많이 싣으면 편집 프롬프트의 핵심 규칙이 희석되므로 상한을 둔다. */
export const MAX_CONVENTIONS = 4;

/** 200자를 넘으면 자를 때 결론부가 사라질 수 있어 해당 규칙을 통째로 버린다. */
export const MAX_CONVENTION_LENGTH = 200;
