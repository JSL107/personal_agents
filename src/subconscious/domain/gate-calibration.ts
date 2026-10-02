// 게이트 문턱 오프라인 보정 — shadow 원장 점수와 사람 판정(실행=양성, 무시=음성)을 비교하는 순수 함수.
// 같은 PR 이 여러 행으로 반복되므로(2026-10-02 실측: 73행이 고유 40개) 신뢰구간은 행이 아니라
// cluster(changeKey) 단위로 재표집한다. 행 단위로 뽑으면 구간이 실제보다 좁게 나온다.

export interface CalibrationItem {
  readonly cluster: string;
  readonly score: number;
  readonly label: boolean;
}

export interface AurocInterval {
  readonly low: number;
  readonly high: number;
}

export interface ThresholdRow {
  readonly threshold: number;
  readonly keptPositive: number;
  readonly totalPositive: number;
  readonly filteredNegative: number;
  readonly totalNegative: number;
}

// 양성 점수가 음성 점수보다 클 확률(동점 0.5). 한쪽 라벨이 없으면 정의되지 않아 null.
export const auroc = (items: readonly CalibrationItem[]): number | null => {
  const positives = items
    .filter((item) => item.label)
    .map((item) => item.score);
  const negatives = items
    .filter((item) => !item.label)
    .map((item) => item.score);
  if (positives.length === 0 || negatives.length === 0) {
    return null;
  }
  let wins = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive > negative) {
        wins += 1;
      } else if (positive === negative) {
        wins += 0.5;
      }
    }
  }
  return wins / (positives.length * negatives.length);
};

// 재현 가능한 [0, 1) 난수 — 같은 seed 면 같은 구간이 나와야 보정 결과를 비교할 수 있다.
export const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

export const clusteredBootstrapAuroc = (
  items: readonly CalibrationItem[],
  iterations: number,
  random: () => number,
): AurocInterval | null => {
  const clusters = new Map<string, CalibrationItem[]>();
  for (const item of items) {
    const group = clusters.get(item.cluster) ?? [];
    group.push(item);
    clusters.set(item.cluster, group);
  }
  const groups = [...clusters.values()];
  if (groups.length === 0 || auroc(items) === null) {
    return null;
  }

  const values: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const resampled: CalibrationItem[] = [];
    for (let draw = 0; draw < groups.length; draw += 1) {
      resampled.push(...groups[Math.floor(random() * groups.length)]);
    }
    const value = auroc(resampled);
    if (value !== null) {
      values.push(value);
    }
  }
  if (values.length === 0) {
    return null;
  }
  values.sort((left, right) => left - right);
  return {
    low: values[Math.floor(values.length * 0.025)],
    high: values[
      Math.min(values.length - 1, Math.floor(values.length * 0.975))
    ],
  };
};

// 문턱마다 "실행된 것을 몇 개 남기고, 무시된 것을 몇 개 거르나".
export const thresholdTable = (
  items: readonly CalibrationItem[],
  thresholds: readonly number[],
): ThresholdRow[] => {
  const positives = items.filter((item) => item.label);
  const negatives = items.filter((item) => !item.label);
  return thresholds.map((threshold) => ({
    threshold,
    keptPositive: positives.filter((item) => item.score >= threshold).length,
    totalPositive: positives.length,
    filteredNegative: negatives.filter((item) => item.score < threshold).length,
    totalNegative: negatives.length,
  }));
};
