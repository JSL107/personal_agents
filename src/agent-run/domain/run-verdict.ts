// 사람이 에이전트 실행 결과에 내린 판정의 허용 값 — 버튼 빌더와 핸들러가 이 한 곳을 같이 읽는다.
// (설계: docs/superpowers/specs/2026-09-30-human-feedback-channel-design.md §4)
//
// 계약 점수(agent_run.contract_score)는 형식만 본다. 이 판정은 "내용이 쓸모 있었는가" 라는 다른 축이다.
// 버튼 값은 슬랙에서 되돌아오는 입력이라, 핸들러가 여기 목록으로 다시 검사한다 — 목록 밖 값은 저장하지 않는다.
// `heading` 은 판정 댓글 머리 — 한 댓글의 축은 한 실행 몫이라 첫 축의 값을 쓴다.
// `quoteLabel` 은 판정 대상 문장을 인용할 때 붙이는 이름이다. 인용이 없는 축은 비운다.
export const RUN_VERDICT_FACETS = {
  // 저녁 회고 KPT 의 문제 칸 — 지어낸 것인지 사람이 가른다(2026-09-18-evening-retro-kpt-design.md §3-2).
  retro_problem: {
    heading: '🌙 저녁 회고 판정',
    label: '문제 칸',
    quoteLabel: '문제 칸',
    verdicts: {
      REAL: '실제로 아쉬웠던 것',
      FABRICATED: '지어낸 것',
    },
  },
  overall: {
    heading: '🌙 저녁 회고 판정',
    label: '회고 전체',
    verdicts: {
      GOOD: '👍 쓸모 있음',
      BAD: '👎 헛다리',
    },
  },
  // PO 대행의 "먼저 이것부터" — "이미 알던 것" 은 틀림과 따로 센다. 틀리진 않았지만 가치가 없는
  // 제안이라, 합치면 "맞았음 비율" 이 그 둘을 구분하지 못한다(설계 §3-2).
  po_first_action: {
    heading: '🎯 PO 대행 판정',
    label: '먼저 이것부터',
    quoteLabel: '먼저 이것부터',
    verdicts: {
      GOOD: '👍 맞았음',
      KNOWN: '이미 알던 것',
      BAD: '👎 틀림',
    },
  },
  // 아침 계획은 하루를 보낸 뒤에야 판단할 수 있어 저녁 스레드에서 묻는다(설계 §3-3).
  pm_plan: {
    heading: '🗓️ 오늘 아침 계획 판정',
    label: '오늘 계획',
    verdicts: {
      GOOD: '👍 쓸모 있었음',
      BAD: '👎 헛다리',
    },
  },
} as const satisfies Record<
  string,
  {
    heading: string;
    label: string;
    quoteLabel?: string;
    verdicts: Record<string, string>;
  }
>;

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

export const getRunVerdictHeading = (facets: RunVerdictFacet[]): string =>
  facets.length > 0 ? RUN_VERDICT_FACETS[facets[0]].heading : '판정';

// 인용 이름은 그 이름을 가진 첫 축에서 읽는다 — 저녁 회고는 문제 칸이 빈 날 축 ① 이 빠지므로
// 축 순서에 기대지 않는다.
export const getRunVerdictQuoteLabel = (
  facets: RunVerdictFacet[],
): string | undefined => {
  for (const facet of facets) {
    const definition = RUN_VERDICT_FACETS[facet];
    if ('quoteLabel' in definition) {
      return definition.quoteLabel;
    }
  }
  return undefined;
};

// 축마다 값 이름이 다르지만 품질 집계는 좋음/나쁨 두 칸으로 센다(설계 §6).
// "이미 알던 것"(KNOWN)은 틀리지도 맞지도 않아 어느 칸에도 넣지 않는다 — 판정 건수에만 든다.
const POSITIVE_VERDICTS: ReadonlySet<string> = new Set(['GOOD', 'REAL']);
const NEGATIVE_VERDICTS: ReadonlySet<string> = new Set(['BAD', 'FABRICATED']);

export type RunVerdictPolarity = 'good' | 'bad' | 'neutral';

export const getRunVerdictPolarity = (verdict: string): RunVerdictPolarity => {
  if (POSITIVE_VERDICTS.has(verdict)) {
    return 'good';
  }
  if (NEGATIVE_VERDICTS.has(verdict)) {
    return 'bad';
  }
  return 'neutral';
};
