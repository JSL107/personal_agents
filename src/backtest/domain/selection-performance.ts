import { Interval, RecommendationPromptInputs } from './selection-consistency';

/**
 * 모델 선정 대 점수 상위 규칙의 사후 성과 비교 (2026-10-06 설계, 측정 전 등록).
 *
 * 같은 회차에서 모델이 실제로 산 k 종목과 규칙이 샀을 k 종목(미보유 후보 점수 상위 k)의
 * 사후 수익률을 짝지어 비교한다. 진입가가 양쪽 다 다음 거래일 시가이고 종목 수가 같아
 * 그날 장세와 거래 비용이 함께 상쇄된다. 판정 문턱은 수익률을 보기 전에 정했다 —
 * 결과를 보고 바꾸면 이 측정의 의미가 사라진다.
 */

// 블록이 이보다 적으면 부트스트랩 구간 자체를 믿을 수 없어 판정하지 않는다.
export const PERFORMANCE_MINIMUM_BLOCKS = 8;

// 동등 마진(%p). 왕복 비용과 실측 슬리피지 손익분기(편도 15~20bp)를 합친 정도로, 이보다
// 작은 차이는 어느 쪽을 택해도 실익이 없다. 지평이 길면 수익률 분산이 커져 두 배로 둔다.
export const EQUIVALENCE_MARGIN_PCT: Readonly<Record<number, number>> = {
  5: 0.5,
  20: 1.0,
};

// 블록 길이(주)는 지평 이상이어야 한다. 20거래일 창은 4주 동안 겹쳐 주 단위로 자르면
// 이웃 블록이 같은 가격 경로를 공유해 구간이 좁게 나온다.
export const PERFORMANCE_BLOCK_WEEKS: Readonly<Record<number, number>> = {
  5: 1,
  20: 4,
};

// 블록 경계의 기준 월요일 — 성적이 처음 채점된 회차(2026-08-20)가 속한 ISO 주.
const BLOCK_ANCHOR_MONDAY = Date.UTC(2026, 7, 17);
const DAY_MS = 86_400_000;

export const performanceBlockKey = (
  strategy: string,
  asOf: Date,
  weeks: number,
): string => {
  const day = Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate(),
  );
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  const monday = day - weekday * DAY_MS;
  const index = Math.floor(
    (monday - BLOCK_ANCHOR_MONDAY) / (7 * weeks * DAY_MS),
  );
  return `${strategy}:${weeks}w:${index}`;
};

/**
 * 규칙이 샀을 k 종목 — 프롬프트의 보유 종목과 결정 시점 대기 매수 종목을 뺀 후보 중 점수
 * 상위 k. 운영은 대기 주문 종목을 프롬프트에 그대로 싣고 모델 답 뒤에 걸러내므로
 * (`PENDING_ORDER_EXISTS`), 빼지 않으면 규칙이 운영에서는 살 수 없는 종목을 고른다.
 * 후보는 프롬프트에 점수 내림차순으로 실려 있으므로 동점은 실린 순서로 가른다. 적격 후보가
 * k 보다 적으면 같은 크기로 짝을 지을 수 없어 null.
 */
export const ruleCounterfactualPicks = (
  inputs: RecommendationPromptInputs,
  k: number,
  pendingBuyCodes: ReadonlySet<string> = new Set<string>(),
): string[] | null => {
  const heldCodes = new Set(inputs.positions.map((position) => position.code));
  const eligible = inputs.candidates
    .filter(
      (candidate) =>
        !heldCodes.has(candidate.code) && !pendingBuyCodes.has(candidate.code),
    )
    .map((candidate) => candidate.code);
  return eligible.length < k ? null : eligible.slice(0, k);
};

export interface PairedGap {
  // 모델 평균 − 규칙 평균 (%p). 두 쪽이 같이 고른 종목은 양쪽에 같이 들어가 상쇄된다.
  gapPct: number;
  overlapCount: number;
  // 서로 다르게 고른 종목끼리의 평균 차 (%p). 완전히 같으면 null — 서술용이다.
  disagreementGapPct: number | null;
}

/**
 * 회차 하나의 짝 차이. 한 종목이라도 성적이 없으면 null — 빠진 종목을 버리고 평균을 내면
 * 두 쪽의 종목 수가 달라져 짝이 깨진다.
 */
export const pairedGap = ({
  modelCodes,
  ruleCodes,
  returnByCode,
}: {
  modelCodes: string[];
  ruleCodes: string[];
  returnByCode: ReadonlyMap<string, number>;
}): PairedGap | null => {
  if (modelCodes.length === 0 || modelCodes.length !== ruleCodes.length) {
    return null;
  }
  if ([...modelCodes, ...ruleCodes].some((code) => !returnByCode.has(code))) {
    return null;
  }
  const returnOf = (code: string): number => returnByCode.get(code) as number;
  const ruleSet = new Set(ruleCodes);
  const modelSet = new Set(modelCodes);
  const modelOnly = modelCodes.filter((code) => !ruleSet.has(code));
  const ruleOnly = ruleCodes.filter((code) => !modelSet.has(code));
  return {
    gapPct: meanOf(modelCodes.map(returnOf)) - meanOf(ruleCodes.map(returnOf)),
    overlapCount: modelCodes.length - modelOnly.length,
    disagreementGapPct:
      modelOnly.length === 0
        ? null
        : meanOf(modelOnly.map(returnOf)) - meanOf(ruleOnly.map(returnOf)),
  };
};

const meanOf = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

export type PerformanceVerdict =
  | 'INSUFFICIENT'
  | 'MODEL_BETTER'
  | 'RULE_BETTER'
  | 'EQUIVALENT'
  | 'INCONCLUSIVE';

/** 사전 등록 판정표. 점추정이 아니라 95% 구간 경계로 가른다. */
export const decidePerformanceVerdict = (
  interval: Interval | null,
  marginPct: number,
): PerformanceVerdict => {
  if (interval === null || interval.blocks < PERFORMANCE_MINIMUM_BLOCKS) {
    return 'INSUFFICIENT';
  }
  if (interval.lower > 0) {
    return 'MODEL_BETTER';
  }
  if (interval.upper < 0) {
    return 'RULE_BETTER';
  }
  if (interval.lower >= -marginPct && interval.upper <= marginPct) {
    return 'EQUIVALENT';
  }
  return 'INCONCLUSIVE';
};

export type PerformanceAction = 'DESIGN_RULE_MIGRATION' | 'KEEP_MODEL' | 'HOLD';

/**
 * 두 지평을 합친 행동. 성과가 같으면 재현성(#736 ① 0.48)이 남은 판단을 정하므로
 * EQUIVALENT 는 규칙 쪽이다. 한 지평이라도 모델이 낫다면 옮기지 않는다.
 */
export const decidePerformanceAction = (
  verdicts: PerformanceVerdict[],
): PerformanceAction => {
  if (verdicts.includes('MODEL_BETTER')) {
    return 'KEEP_MODEL';
  }
  if (
    verdicts.length > 0 &&
    verdicts.every(
      (verdict) => verdict === 'RULE_BETTER' || verdict === 'EQUIVALENT',
    )
  ) {
    return 'DESIGN_RULE_MIGRATION';
  }
  return 'HOLD';
};
