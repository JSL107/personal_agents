/**
 * 파라미터 탐색기의 순수 계산부 — 구간을 창으로 자르고, 후보 격자를 만들고, 창별 성적을
 * 순위로 종합하고, walk-forward 로 표본 밖 판정을 낸다. 재생 자체는 여기서 부르지 않는다.
 *
 * 왜 walk-forward 인가: 표본 밖 구간을 한 번만 여는 절차는 루프가 매주 도는 순간 무너진다.
 * 매주 같은 시험지로 채점하면 몇 주 만에 그 구간에 맞춰진 값이 뽑힌다. 창을 시간순으로
 * 미끄러뜨려 앞선 창들로 값을 고르고 그 다음 창에서만 성적을 보면, 창이 하나 늘 때마다
 * 표본 밖 판정이 하나 늘고 같은 창을 두 번 쓰지 않아 닳을 자원이 없다.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export interface SearchWindow {
  // 1부터. 표에서 창을 가리키는 이름이라 0 부터 세면 사람이 읽을 때 한 칸씩 어긋난다.
  index: number;
  from: string;
  to: string;
}

const parseDateText = (dateText: string): [number, number, number] => {
  if (!DATE_PATTERN.test(dateText)) {
    throw new Error(
      `날짜는 YYYY-MM-DD 형식이어야 합니다. 받은 값: ${dateText}`,
    );
  }
  const [year, month, day] = dateText.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  // 형식만 맞으면 2026-02-30 이 통과하고 JS Date 가 3월로 조용히 넘긴다.
  if (parsed.toISOString().slice(0, 10) !== dateText) {
    throw new Error(`실제 존재하는 날짜여야 합니다. 받은 값: ${dateText}`);
  }
  return [year, month - 1, day];
};

const toDateText = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * 개월을 더한다. `setUTCMonth` 에 그냥 맡기면 1월 31일 + 1개월이 3월 3일이 되어 없는 날짜를
 * 만들어낸다. 목표 달의 말일로 눌러 그 경로를 막는다.
 */
export const addMonths = (dateText: string, months: number): string => {
  const [year, monthIndex, day] = parseDateText(dateText);
  const targetMonthStart = new Date(Date.UTC(year, monthIndex + months, 1));
  const lastDay = new Date(
    Date.UTC(
      targetMonthStart.getUTCFullYear(),
      targetMonthStart.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  return toDateText(
    new Date(
      Date.UTC(
        targetMonthStart.getUTCFullYear(),
        targetMonthStart.getUTCMonth(),
        Math.min(day, lastDay),
      ),
    ),
  );
};

const minusOneDay = (dateText: string): string => {
  const [year, monthIndex, day] = parseDateText(dateText);
  return toDateText(new Date(Date.UTC(year, monthIndex, day - 1)));
};

/**
 * 구간을 창으로 자른다. 마지막 창은 `to` 에서 잘리는데, 창 길이의 절반도 안 남으면 버린다 —
 * 표본이 반토막인 창을 다른 창과 같은 한 표로 세면 순위 종합이 그 창에 흔들린다.
 */
export const buildSearchWindows = (input: {
  from: string;
  to: string;
  windowMonths: number;
  stepMonths: number;
}): SearchWindow[] => {
  if (input.windowMonths <= 0 || input.stepMonths <= 0) {
    throw new Error('창 크기와 이동 폭은 1개월 이상이어야 합니다.');
  }
  if (input.from > input.to) {
    throw new Error(
      `--from 이 --to 보다 늦습니다 (${input.from} > ${input.to}).`,
    );
  }
  const windows: SearchWindow[] = [];
  let start = input.from;
  while (start <= input.to) {
    const fullEnd = minusOneDay(addMonths(start, input.windowMonths));
    const end = fullEnd <= input.to ? fullEnd : input.to;
    const minimumEnd = minusOneDay(
      addMonths(start, Math.ceil(input.windowMonths / 2)),
    );
    if (end < minimumEnd) {
      break;
    }
    windows.push({ index: windows.length + 1, from: start, to: end });
    start = addMonths(start, input.stepMonths);
  }
  return windows;
};

/**
 * 한 번의 재생이 쓰는 파라미터 한 벌. 밴드 두 값이 `null` 이면 무밴드 대조군이다 —
 * 백테스트에서 `exitBand: null` 은 미지정이 아니라 "보유일수로만 청산" 이라는 스위치다.
 */
export interface ParameterCombination {
  takeProfitPercent: number | null;
  stopLossPercent: number | null;
  minimumTurnover60: number;
  maximumWeightPercent: number;
}

/**
 * 라벨은 표시용이지만 **값과 일대일이어야 한다** — 리포트가 라벨로 조합을 집계하므로,
 * 서로 다른 값이 같은 라벨을 받으면 표에서 두 행이 겹친다. 억 단위 두 자리로 반올림하면
 * 3.001억과 3.002억이 둘 다 `3.00억` 이 되므로, 반올림이 값을 잃으면 원 단위로 적는다.
 */
export const formatTurnoverLabel = (value: number): string => {
  const billion = value / 100_000_000;
  if (Number.isInteger(billion)) {
    return `${billion}억`;
  }
  const rounded = Number(billion.toFixed(2));
  if (rounded * 100_000_000 === value) {
    return `${rounded}억`;
  }
  return `${value}원`;
};

/**
 * 중복 제거에 쓰는 키. **표시용 라벨이 아니라 값으로 가른다** — 라벨은 사람이 읽으라고
 * 반올림·축약이 들어갈 수 있고, 그때 서로 다른 후보가 같은 키를 받으면 격자가 후보를
 * 조용히 하나 삼킨다. 사용자가 준 후보 수와 실제로 도는 수가 갈리는데 아무 신호가 없다.
 */
const combinationKeyOf = (combination: ParameterCombination): string =>
  [
    combination.takeProfitPercent,
    combination.stopLossPercent,
    combination.minimumTurnover60,
    combination.maximumWeightPercent,
  ].join('|');

export const formatCombinationLabel = (
  combination: ParameterCombination,
): string => {
  const band =
    combination.takeProfitPercent === null ||
    combination.stopLossPercent === null
      ? '무밴드'
      : `+${combination.takeProfitPercent}/${combination.stopLossPercent}`;
  return (
    `${band} · ${formatTurnoverLabel(combination.minimumTurnover60)} · ` +
    `${combination.maximumWeightPercent}%`
  );
};

export interface ParameterGridInput {
  takeProfitPercents: number[];
  stopLossPercents: number[];
  minimumTurnover60s: number[];
  maximumWeightPercents: number[];
  includeBandless: boolean;
  baseline: ParameterCombination;
}

/**
 * 축들의 전수 조합. 축 하나만 훑고 싶으면 나머지 축에 값을 하나씩만 주면 되므로 모드가
 * 따로 필요 없다.
 *
 * 현행값을 맨 앞에 강제로 넣는다 — 격자에 없으면 비교 기준이 사라져 walk-forward 판정
 * 자체가 성립하지 않는다.
 */
export const buildParameterGrid = (
  input: ParameterGridInput,
): ParameterCombination[] => {
  const combinations: ParameterCombination[] = [];
  const seen = new Set<string>();
  const push = (combination: ParameterCombination): void => {
    const key = combinationKeyOf(combination);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    combinations.push(combination);
  };
  push(input.baseline);
  for (const minimumTurnover60 of input.minimumTurnover60s) {
    for (const maximumWeightPercent of input.maximumWeightPercents) {
      if (input.includeBandless) {
        push({
          takeProfitPercent: null,
          stopLossPercent: null,
          minimumTurnover60,
          maximumWeightPercent,
        });
      }
      for (const takeProfitPercent of input.takeProfitPercents) {
        for (const stopLossPercent of input.stopLossPercents) {
          push({
            takeProfitPercent,
            stopLossPercent,
            minimumTurnover60,
            maximumWeightPercent,
          });
        }
      }
    }
  }
  return combinations;
};

/**
 * 한 창에서 한 조합이 낸 성적. 초과수익만으로 순위를 매기되 나머지도 들고 다닌다 —
 * 2026-08-25 재측정이 "초과수익 하나로 순위를 매기면 최대손실이 훨씬 작은 조합을 못 본다"
 * 는 한계를 스스로 적었다.
 */
export interface WindowOutcome {
  windowIndex: number;
  label: string;
  excessReturnPercent: number | null;
  finalReturnPercent: number | null;
  maximumLossPercent: number | null;
  hitRatePercent: number | null;
  closedCount: number;
  filledCount: number;
}

/**
 * 창 안에서 초과수익 내림차순으로 순위를 매긴다. 값이 없는 조합은 맨 뒤로 민다 — 없는
 * 것을 0 으로 치면 전 조합이 마이너스인 창에서 1위가 된다. 동점은 같은 순위를 준다.
 */
export const rankWithinWindow = (
  outcomes: WindowOutcome[],
): Map<string, number> => {
  const sorted = [...outcomes].sort((left, right) => {
    if (
      left.excessReturnPercent === null &&
      right.excessReturnPercent === null
    ) {
      return left.label.localeCompare(right.label);
    }
    if (left.excessReturnPercent === null) {
      return 1;
    }
    if (right.excessReturnPercent === null) {
      return -1;
    }
    return (
      right.excessReturnPercent - left.excessReturnPercent ||
      left.label.localeCompare(right.label)
    );
  });
  const ranks = new Map<string, number>();
  let previousValue: number | null = null;
  let previousRank = 0;
  sorted.forEach((outcome, index) => {
    // 값이 없는 조합끼리도 동점이다. `null` 을 동점에서 빼면 라벨 알파벳 순이 순위가 되어,
    // 아무것도 재지 못한 조합들 사이에 **이름으로 매긴 서열**이 생기고 그 서열이 순위
    // 평균을 타고 walk-forward 후보 선택까지 개입한다.
    const isTie = index > 0 && outcome.excessReturnPercent === previousValue;
    const rank = isTie ? previousRank : index + 1;
    ranks.set(outcome.label, rank);
    previousValue = outcome.excessReturnPercent;
    previousRank = rank;
  });
  return ranks;
};

const meanOf = (values: number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const medianOf = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export interface CombinationSummary {
  label: string;
  ranks: number[];
  meanRank: number | null;
  medianRank: number | null;
  meanExcessReturnPercent: number | null;
  meanFinalReturnPercent: number | null;
  worstMaximumLossPercent: number | null;
  // 같은 창에서 현행값보다 초과수익이 높았던 창의 수 / 양쪽 다 값이 있던 창의 수.
  winCount: number;
  comparableCount: number;
  closedCountTotal: number;
}

const collect = (values: Array<number | null>): number[] =>
  values.filter((value): value is number => value !== null);

/**
 * 창 전체를 종합한다. 순위 평균이 주 지표이고 중앙값을 함께 낸다 — 순위 평균은 한 창의
 * 극단 순위에 끌려가고, 중앙값은 그 창을 무시한다. 둘이 갈리면 그 사실 자체가 정보다.
 */
export const summarizeCombinations = (input: {
  outcomes: WindowOutcome[];
  baselineLabel: string;
}): CombinationSummary[] => {
  const byWindow = new Map<number, WindowOutcome[]>();
  for (const outcome of input.outcomes) {
    const bucket = byWindow.get(outcome.windowIndex) ?? [];
    bucket.push(outcome);
    byWindow.set(outcome.windowIndex, bucket);
  }
  const ranksByWindow = new Map<number, Map<string, number>>();
  const baselineByWindow = new Map<number, number | null>();
  for (const [windowIndex, bucket] of byWindow) {
    ranksByWindow.set(windowIndex, rankWithinWindow(bucket));
    baselineByWindow.set(
      windowIndex,
      bucket.find((outcome) => outcome.label === input.baselineLabel)
        ?.excessReturnPercent ?? null,
    );
  }

  const byLabel = new Map<string, WindowOutcome[]>();
  for (const outcome of input.outcomes) {
    const bucket = byLabel.get(outcome.label) ?? [];
    bucket.push(outcome);
    byLabel.set(outcome.label, bucket);
  }

  const summaries: CombinationSummary[] = [];
  for (const [label, bucket] of byLabel) {
    const sorted = [...bucket].sort(
      (left, right) => left.windowIndex - right.windowIndex,
    );
    const ranks = sorted.map(
      (outcome) => ranksByWindow.get(outcome.windowIndex)?.get(label) as number,
    );
    let winCount = 0;
    let comparableCount = 0;
    for (const outcome of sorted) {
      const baseline = baselineByWindow.get(outcome.windowIndex) ?? null;
      if (baseline === null || outcome.excessReturnPercent === null) {
        continue;
      }
      comparableCount += 1;
      if (outcome.excessReturnPercent > baseline) {
        winCount += 1;
      }
    }
    const losses = collect(sorted.map((outcome) => outcome.maximumLossPercent));
    summaries.push({
      label,
      ranks,
      meanRank: meanOf(ranks),
      medianRank: medianOf(ranks),
      meanExcessReturnPercent: meanOf(
        collect(sorted.map((outcome) => outcome.excessReturnPercent)),
      ),
      meanFinalReturnPercent: meanOf(
        collect(sorted.map((outcome) => outcome.finalReturnPercent)),
      ),
      worstMaximumLossPercent: losses.length === 0 ? null : Math.min(...losses),
      winCount,
      comparableCount,
      closedCountTotal: sorted.reduce(
        (sum, outcome) => sum + outcome.closedCount,
        0,
      ),
    });
  }
  return summaries.sort(
    (left, right) =>
      (left.meanRank ?? Number.POSITIVE_INFINITY) -
        (right.meanRank ?? Number.POSITIVE_INFINITY) ||
      left.label.localeCompare(right.label),
  );
};

/**
 * 앞선 창들로 값을 고르고 그 다음 창에서만 성적을 본다. 훈련 창이 하나뿐이면 "그 창의 1위"
 * 라 우연을 거를 수 없어 두 창부터 판정한다.
 */
export const WALK_FORWARD_WARMUP_WINDOWS = 2;

export interface WalkForwardVerdict {
  windowIndex: number;
  trainedWindowCount: number;
  chosenLabel: string;
  chosenExcessReturnPercent: number | null;
  baselineExcessReturnPercent: number | null;
  // 탐색이 현행값을 그대로 고른 창과 초과수익이 없어 비교가 안 되는 창은 승패를 매기지 않는다.
  won: boolean | null;
}

export const evaluateWalkForward = (input: {
  outcomes: WindowOutcome[];
  baselineLabel: string;
  warmupWindows?: number;
}): WalkForwardVerdict[] => {
  const warmup = input.warmupWindows ?? WALK_FORWARD_WARMUP_WINDOWS;
  const windowIndexes = [
    ...new Set(input.outcomes.map((outcome) => outcome.windowIndex)),
  ].sort((left, right) => left - right);

  const verdicts: WalkForwardVerdict[] = [];
  for (let position = warmup; position < windowIndexes.length; position += 1) {
    const trainedIndexes = windowIndexes.slice(0, position);
    const targetIndex = windowIndexes[position];
    const trained = summarizeCombinations({
      outcomes: input.outcomes.filter((outcome) =>
        trainedIndexes.includes(outcome.windowIndex),
      ),
      baselineLabel: input.baselineLabel,
    });
    const chosen = trained.at(0);
    if (chosen === undefined) {
      continue;
    }
    const targetOutcomes = input.outcomes.filter(
      (outcome) => outcome.windowIndex === targetIndex,
    );
    const chosenExcess =
      targetOutcomes.find((outcome) => outcome.label === chosen.label)
        ?.excessReturnPercent ?? null;
    const baselineExcess =
      targetOutcomes.find((outcome) => outcome.label === input.baselineLabel)
        ?.excessReturnPercent ?? null;
    verdicts.push({
      windowIndex: targetIndex,
      trainedWindowCount: trainedIndexes.length,
      chosenLabel: chosen.label,
      chosenExcessReturnPercent: chosenExcess,
      baselineExcessReturnPercent: baselineExcess,
      won:
        chosen.label === input.baselineLabel ||
        chosenExcess === null ||
        baselineExcess === null
          ? null
          : chosenExcess > baselineExcess,
    });
  }
  return verdicts;
};
