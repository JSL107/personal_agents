import {
  constrainPaperRecommendation,
  MAXIMUM_WEIGHT_PERCENT,
} from '../../agent/paper-recommend/domain/paper-recommendation.constraint';
import { PaperRecommendation } from '../../agent/paper-recommend/domain/paper-recommendation.type';

/**
 * 모의투자 추천의 종목 선정 일치도 측정 (2026-10-06 설계 v3).
 *
 * 운영 추천이 남긴 프롬프트를 그대로 다시 물어, 같은 입력에 같은 주문이 나오는지(①)와
 * 점수 상위 규칙(`selectDeterministicRecommendation`)과 얼마나 겹치는지(④)를 잰다.
 * 판정 문턱은 측정 전에 정했다 — 결과를 보고 바꾸면 이 측정의 의미가 사라진다.
 */

// 판정 대상: 모델이 본 매수 가능 현금이 평가액의 18% 이상인 회차. 종목당 20% 배정에서
// 한 종목도 못 사는 회차는 "아무것도 안 산다" 가 저절로 맞아 일치도를 부풀린다.
export const HEADROOM_RATIO = 0.18;
export const CONSISTENCY_HIGH = 0.8;
export const CONSISTENCY_LOW = 0.5;
export const RULE_AGREEMENT_HIGH = 0.7;

export interface PromptPosition {
  code: string;
  quantity: number;
}

export interface PromptCandidate {
  code: string;
  name: string;
  score: number;
  close: number;
}

export interface RecommendationPromptInputs {
  purchasableCash: number;
  accountValuation: number;
  positions: PromptPosition[];
  // 프롬프트에 실린 순서 그대로(스크리너 점수 내림차순).
  candidates: PromptCandidate[];
}

// 2026-08-28 까지의 프롬프트는 업종 괄호가 없고 현금 줄이 `현금 잔액:` 이었다(배당 미수를
// 빼기 전). 어느 쪽이든 그 회차 모델이 본 현금이다.
const POSITION_LINE = /^(\S+) (.+?)(?: \[.*\])? \((\d+)주 보유\)$/u;
const CANDIDATE_LINE = /^(\S+) (.+?)(?: \[.*\])? \(screen score (-?[\d.]+)\)$/u;
const CASH_PREFIXES = ['매수 가능 현금: ', '현금 잔액: '];
const INDICATOR_PREFIX = '지표: ';
const EMPTY_SECTION = '없음';

/**
 * `buildPaperRecommendationPrompt` 가 만든 문자열에서 제약 함수 입력을 되살린다.
 * 형식이 어긋나면 지어내지 않고 던진다 — 틀린 현금으로 계산한 일치도는 없는 것보다 나쁘다.
 */
export const parseRecommendationPrompt = (
  prompt: string,
): RecommendationPromptInputs => {
  const lines = prompt.split('\n');
  const purchasableCash = readNumberLine(lines, CASH_PREFIXES);
  const accountValuation = readNumberLine(lines, ['계좌 평가액: ']);
  const positions: PromptPosition[] = [];
  const candidates: PromptCandidate[] = [];
  let section: 'NONE' | 'POSITIONS' | 'CANDIDATES' = 'NONE';

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '[보유 종목]') {
      section = 'POSITIONS';
      continue;
    }
    if (line === '[신규 후보]') {
      section = 'CANDIDATES';
      continue;
    }
    if (line === '') {
      section = 'NONE';
      continue;
    }
    if (
      section === 'NONE' ||
      line === EMPTY_SECTION ||
      line.startsWith(INDICATOR_PREFIX)
    ) {
      continue;
    }
    // 형식이 바뀐 줄을 건너뛰면 종목이 조용히 빠진다. 여기서 끊는다.
    const match = (
      section === 'POSITIONS' ? POSITION_LINE : CANDIDATE_LINE
    ).exec(line);
    if (!match) {
      throw new Error(
        `프롬프트 줄 형식을 알 수 없습니다: ${line.slice(0, 80)}`,
      );
    }
    if (section === 'POSITIONS') {
      positions.push({ code: match[1], quantity: Number(match[3]) });
    } else {
      candidates.push({
        code: match[1],
        name: match[2],
        score: Number(match[3]),
        close: readClose(lines[index + 1], match[1]),
      });
    }
  }
  return { purchasableCash, accountValuation, positions, candidates };
};

const readNumberLine = (lines: string[], prefixes: string[]): number => {
  for (const prefix of prefixes) {
    const found = lines.find((line) => line.startsWith(prefix));
    const value =
      found === undefined ? NaN : Number(found.slice(prefix.length));
    if (Number.isFinite(value)) {
      return value;
    }
  }
  throw new Error(`프롬프트에서 "${prefixes[0].trim()}" 값을 읽지 못했습니다.`);
};

const readClose = (line: string | undefined, code: string): number => {
  if (line === undefined || !line.startsWith(INDICATOR_PREFIX)) {
    throw new Error(`후보 ${code} 의 지표 줄이 없습니다.`);
  }
  const indicators = JSON.parse(line.slice(INDICATOR_PREFIX.length)) as {
    close?: unknown;
  };
  if (typeof indicators.close !== 'number') {
    throw new Error(`후보 ${code} 의 지표에 close 가 없습니다.`);
  }
  return indicators.close;
};

export const hasBuyingHeadroom = (
  inputs: RecommendationPromptInputs,
): boolean =>
  inputs.purchasableCash >= inputs.accountValuation * HEADROOM_RATIO;

export interface ExecutedBuy {
  code: string;
  amount: number;
}

/**
 * 모델 답을 운영과 같은 제약 함수에 통과시켜 실제로 체결될 매수만 남긴다.
 * 제약 함수는 모델이 낸 순서대로 현금을 쓰므로 [A,B] 와 [B,A] 는 다른 주문이 될 수 있다 —
 * 원시 집합이 아니라 이 결과를 비교해야 "같은 주문이 나왔나" 를 잰다.
 */
export const executeBuys = ({
  recommendation,
  inputs,
  maximumWeightPercent = MAXIMUM_WEIGHT_PERCENT,
}: {
  recommendation: PaperRecommendation;
  inputs: RecommendationPromptInputs;
  maximumWeightPercent?: number;
}): ExecutedBuy[] => {
  // tickerId 는 주문 조립에만 쓰이고 어떤 종목·수량을 고르는지에는 관여하지 않는다.
  const constrained = constrainPaperRecommendation({
    recommendation,
    candidates: inputs.candidates.map((candidate, index) => ({
      tickerId: index,
      code: candidate.code,
      name: candidate.name,
      close: candidate.close,
    })),
    positions: inputs.positions.map((position, index) => ({
      tickerId: -1 - index,
      code: position.code,
      quantity: position.quantity,
    })),
    cashBalance: inputs.purchasableCash,
    accountValuation: inputs.accountValuation,
    maximumWeightPercent,
  });
  return constrained.buys.map((buy) => ({
    code: buy.code,
    amount: buy.quantity * buy.close,
  }));
};

// 파싱 실패는 null. 운영에서는 주문 0건이 되는 별개의 결과다.
export type ReplayAnswer = ExecutedBuy[] | null;

// 금액까지 키에 넣는다. 같은 종목이라도 배정액이 다르면 다른 주문이다 — 현금이 모자란 회차는
// 모델이 낸 순서에 따라 종목별 수량이 갈린다(`executeBuys` 주석).
const buyKey = (answer: ExecutedBuy[]): string =>
  answer
    .map((buy) => `${buy.code}:${buy.amount}`)
    .sort()
    .join(',');

/**
 * 회차 안 모든 쌍 중 체결 매수 집합이 같은 비율. 비교할 쌍이 없으면 null.
 * `failureAsAnswer` 가 false 면 파싱 실패를 빼고 센다(주지표), true 면 실패끼리를 같은
 * 답으로 센다(민감도).
 */
export const pairwiseAgreement = (
  answers: ReplayAnswer[],
  { failureAsAnswer = false }: { failureAsAnswer?: boolean } = {},
): number | null => {
  const keys = answers.flatMap((answer) => {
    if (answer !== null) {
      return [buyKey(answer)];
    }
    return failureAsAnswer ? ['<FAILED>'] : [];
  });
  let pairs = 0;
  let agreed = 0;
  for (let left = 0; left < keys.length; left += 1) {
    for (let right = left + 1; right < keys.length; right += 1) {
      pairs += 1;
      if (keys[left] === keys[right]) {
        agreed += 1;
      }
    }
  }
  return pairs === 0 ? null : agreed / pairs;
};

/** 회차 안에서 가장 많이 나온 답의 비율. 다수결 대안을 평가하는 재료다. */
export const modalFrequency = (answers: ReplayAnswer[]): number | null => {
  const keys = answers.flatMap((answer) =>
    answer === null ? [] : [buyKey(answer)],
  );
  if (keys.length === 0) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / keys.length;
};

/** 금액 가중 일치 Σmin/Σmax. 잔여 현금으로 산 소액 주문 하나의 차이를 작게 센다. */
export const amountWeightedAgreement = (
  left: ExecutedBuy[],
  right: ExecutedBuy[],
): number => {
  const amounts = new Map<string, [number, number]>();
  for (const buy of left) {
    amounts.set(buy.code, [buy.amount, 0]);
  }
  for (const buy of right) {
    const [leftAmount] = amounts.get(buy.code) ?? [0];
    amounts.set(buy.code, [leftAmount, buy.amount]);
  }
  let minimum = 0;
  let maximum = 0;
  for (const [leftAmount, rightAmount] of amounts.values()) {
    minimum += Math.min(leftAmount, rightAmount);
    maximum += Math.max(leftAmount, rightAmount);
  }
  return maximum === 0 ? 1 : minimum / maximum;
};

/**
 * ④ 규칙 일치 — 모델이 실제로 산 k 종목 중 "미보유 후보 점수 상위 k" 에 드는 비율.
 * 경계 점수와 동점이면 규칙이 어느 쪽을 골라도 됐으므로 일치로 센다.
 * k=0(모델 기권)은 null — 규칙은 기권하지 않으므로 기권 비율은 따로 센다.
 */
export const ruleAgreement = (
  executed: ExecutedBuy[],
  inputs: RecommendationPromptInputs,
): number | null => {
  const k = executed.length;
  if (k === 0) {
    return null;
  }
  const heldCodes = new Set(inputs.positions.map((position) => position.code));
  const eligible = inputs.candidates.filter(
    (candidate) => !heldCodes.has(candidate.code),
  );
  const boundary = eligible[Math.min(k, eligible.length) - 1]?.score;
  if (boundary === undefined) {
    return 0;
  }
  const scoreByCode = new Map(
    eligible.map((candidate) => [candidate.code, candidate.score]),
  );
  const matched = executed.filter((buy) => {
    const score = scoreByCode.get(buy.code);
    return score !== undefined && score >= boundary;
  }).length;
  return matched / k;
};

export interface BlockValue {
  block: string;
  value: number;
}

export interface Interval {
  mean: number;
  lower: number;
  upper: number;
  blocks: number;
  values: number;
}

/**
 * 블록 부트스트랩 95% 구간. 같은 계좌가 연속한 날 거의 같은 상태로 이어지므로 회차를
 * 독립으로 세면 구간이 좁게 나온다 — 전략×주 단위 블록을 통째로 재표집한다.
 * 결과가 실행마다 달라지면 판정이 흔들리므로 시드를 고정한다.
 */
export const blockBootstrapInterval = (
  values: BlockValue[],
  { iterations = 10_000, seed = 20_261_006 } = {},
): Interval | null => {
  if (values.length === 0) {
    return null;
  }
  const byBlock = new Map<string, number[]>();
  for (const { block, value } of values) {
    byBlock.set(block, [...(byBlock.get(block) ?? []), value]);
  }
  const blocks = [...byBlock.values()];
  const random = mulberry32(seed);
  const means: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    let count = 0;
    for (let draw = 0; draw < blocks.length; draw += 1) {
      const block = blocks[Math.floor(random() * blocks.length)];
      for (const value of block) {
        sum += value;
        count += 1;
      }
    }
    means.push(sum / count);
  }
  means.sort((left, right) => left - right);
  return {
    mean: values.reduce((sum, item) => sum + item.value, 0) / values.length,
    lower: means[Math.floor(iterations * 0.025)],
    upper: means[Math.ceil(iterations * 0.975) - 1],
    blocks: blocks.length,
    values: values.length,
  };
};

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
};

/** ISO 주(월요일 시작) — 블록 키에 쓴다. */
export const isoWeekKey = (date: Date): string => {
  const day = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const weekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

export type SelectionVerdict =
  | 'MIGRATE'
  | 'MIGRATE_STRONG'
  | 'JUDGE_BY_PERFORMANCE'
  | 'UNSTABLE_COMPARE_PERFORMANCE'
  | 'HOLD';

/**
 * 사전 등록 판정표. 점추정이 아니라 95% 구간 경계로 가른다 — 점추정 0.8 도 구간이
 * 0.65~0.95 면 세 칸에 걸쳐 있어 결과를 보고 해석을 고를 여지가 생긴다.
 * 이 실험만으로 "모델 유지" 결론은 나오지 않는다(그건 성과 비교의 몫이다).
 */
export const decideSelectionVerdict = ({
  consistency,
  rule,
}: {
  consistency: Interval;
  rule: Interval;
}): SelectionVerdict => {
  const ruleHigh = rule.lower >= RULE_AGREEMENT_HIGH;
  const ruleLow = rule.upper < RULE_AGREEMENT_HIGH;
  if (consistency.lower >= CONSISTENCY_HIGH) {
    if (ruleHigh) {
      return 'MIGRATE';
    }
    if (ruleLow) {
      return 'JUDGE_BY_PERFORMANCE';
    }
  }
  if (consistency.upper < CONSISTENCY_LOW) {
    if (ruleHigh) {
      return 'MIGRATE_STRONG';
    }
    if (ruleLow) {
      return 'UNSTABLE_COMPARE_PERFORMANCE';
    }
  }
  return 'HOLD';
};
