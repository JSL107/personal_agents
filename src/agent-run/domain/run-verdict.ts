// 사람이 에이전트 실행 결과에 내린 판정의 허용 값 — 버튼 빌더와 핸들러가 이 한 곳을 같이 읽는다.
// (설계: docs/superpowers/specs/2026-09-30-human-feedback-channel-design.md §4)
//
// 계약 점수(agent_run.contract_score)는 형식만 본다. 이 판정은 "내용이 쓸모 있었는가" 라는 다른 축이다.
// 버튼 값은 슬랙에서 되돌아오는 입력이라, 핸들러가 여기 목록으로 다시 검사한다 — 목록 밖 값은 저장하지 않는다.
export const RUN_VERDICT_FACETS = {
  // 저녁 회고 KPT 의 문제 칸 — 지어낸 것인지 사람이 가른다(2026-09-18-evening-retro-kpt-design.md §3-2).
  retro_problem: {
    label: '문제 칸',
    verdicts: {
      REAL: '실제로 아쉬웠던 것',
      FABRICATED: '지어낸 것',
    },
  },
  overall: {
    label: '회고 전체',
    verdicts: {
      GOOD: '👍 쓸모 있음',
      BAD: '👎 헛다리',
    },
  },
} as const;

export type RunVerdictFacet = keyof typeof RUN_VERDICT_FACETS;

export const RUN_VERDICT_SOURCE = {
  BUTTON: 'button',
} as const;

export type RunVerdictSource =
  (typeof RUN_VERDICT_SOURCE)[keyof typeof RUN_VERDICT_SOURCE];

export const isRunVerdictFacet = (value: unknown): value is RunVerdictFacet =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(RUN_VERDICT_FACETS, value);

export const isAllowedRunVerdict = (
  facet: RunVerdictFacet,
  verdict: unknown,
): verdict is string =>
  typeof verdict === 'string' &&
  Object.prototype.hasOwnProperty.call(
    RUN_VERDICT_FACETS[facet].verdicts,
    verdict,
  );

export const getRunVerdictLabel = (
  facet: RunVerdictFacet,
  verdict: string,
): string =>
  (RUN_VERDICT_FACETS[facet].verdicts as Record<string, string>)[verdict] ??
  verdict;
