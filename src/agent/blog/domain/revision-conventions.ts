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

/**
 * 규칙이 빈 회차를 건너뛰며 되짚을 창(일).
 *
 * 수정률 집계의 lookback 과 같은 28일이다. 이보다 오래된 성향은 이미 프롬프트에 반영됐거나
 * 지금 글쓰기와 어긋나 있을 가능성이 높다.
 */
export const CONVENTION_FALLBACK_DAYS = 28;

/** 되짚을 회차 수. 주간 회차라 28일이면 네 번이다. */
export const CONVENTION_FALLBACK_RUNS = 4;

/**
 * 원장 output 에서 규칙 배열만 꺼낸다(순수).
 *
 * `output` 은 Json 이라 이 필드가 없던 시절의 회차도 섞여 온다. 형태가 어긋나면 빈 배열 —
 * 학습 재료 하나 때문에 발행이 멈추면 안 된다.
 */
export const readRevisionConventions = (output: unknown): string[] => {
  if (output === null || typeof output !== 'object') {
    return [];
  }
  const conventions: unknown = (output as { conventions?: unknown })
    .conventions;
  // 문자열만 골라내지 않고 통째로 버린다 — 추출 단계가 이미 문자열만 저장하므로, 섞인
  // 배열은 형태가 어긋났다는 신호다. 그중 일부만 골라 쓰면 어긋난 회차를 정상처럼 소비한다.
  if (
    !Array.isArray(conventions) ||
    !conventions.every(
      (convention): convention is string => typeof convention === 'string',
    )
  ) {
    return [];
  }
  return conventions;
};
