// 회차마다 "순위가 높은 종목이 실제로 더 올랐나" 를 순위 상관(Spearman, RankIC)으로 잰다.
//
// 산 것/안 산 것 격차(`screening-scorecard.ts`)는 모델 선택을 재고, 이 값은 그 앞단인
// 스크리너 점수 자체를 잰다. 순위 1위가 점수 최고이므로 점수 대신 순위의 역순을 쓴다.
//
// **보유 구간이 겹치는 회차는 표본에서 뺀다.** 회차는 매 거래일 생기고 지평은 5·20거래일이라,
// 이웃한 회차는 같은 등락을 4~19일 함께 본다. 그대로 평균하면 평균 자체는 치우치지 않지만
// 관측이 서로 독립이 아니어서 t 가 대략 √지평 배로 부풀고, 우연한 부호가 신호처럼 읽힌다
// (2026-10-21 전 회차로 잰 SWING 5거래일 RankIC −0.034 가 그 상태의 값이다). 겹침은 회차
// 순서가 아니라 실제 진입일·평가일로 판정한다 — 휴장일이 끼면 회차 수로 센 간격이 날짜와 어긋난다.
//
// 판단하지 않는다. 카드와 같이 사실만 센다.

// 이보다 종목이 적은 회차는 상관을 내지 않는다. 종목 3~4개의 순위 상관은 ±1 근처로 튀어
// 평균을 흔든다.
export const RANK_IC_MINIMUM_ITEMS = 5;

export interface RankIcRow {
  runId: number;
  rank: number;
  returnPct: number;
  entryTradeDate: Date;
  horizonTradeDate: Date;
  // 그 회차에 규칙 통과 종목이 전부 저장됐는가(저장 종목 수 = `passedCount`). 회차 단위 값이다.
  runFullyStored: boolean;
}

export interface ScreeningRankIcSummary {
  // 통과 전체가 저장되지 않아 뺀 회차 수(2026-09-04 이전은 프롬프트에 실린 20종목만 남았다).
  // 실린 것만 있는 회차는 상위 20위 안의 상관이고, 전체가 있는 회차는 통과 전체의 상관이라
  // 한 평균에 섞으면 서로 다른 모집단의 값이 합쳐진다.
  partialRunCount: number;
  // 상관을 내지 못한 회차를 사유별로 센다. 표본이 0 일 때 카드가 실제 사유를 적게 하려는 값이다.
  tooFewItemRunCount: number;
  undefinedRunCount: number;
  // 종목이 하한 이상이라 상관을 낸 회차 수.
  eligibleRunCount: number;
  // 그중 보유 구간이 서로 겹치지 않게 고른 회차 수. 아래 값은 모두 이 회차들로 낸다.
  sampledRunCount: number;
  meanIc: number | null;
  positiveRunCount: number;
  // 평균 ÷ (표준편차 ÷ √n). 표본 2개 미만이거나 표준편차가 0 이면 null 이다.
  tStatistic: number | null;
}

interface RunIc {
  ic: number;
  entryTime: number;
  horizonTime: number;
}

// 동률은 평균 순위로 준다. 수익률은 같은 값이 나올 수 있고, 동률에 임의 순서를 주면
// 입력 순서가 상관을 바꾼다.
const averageRanks = (values: number[]): number[] => {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const ranks = new Array<number>(values.length);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (
      end + 1 < order.length &&
      order[end + 1].value === order[start].value
    ) {
      end += 1;
    }
    const averageRank = (start + end) / 2 + 1;
    for (let position = start; position <= end; position += 1) {
      ranks[order[position].index] = averageRank;
    }
    start = end + 1;
  }
  return ranks;
};

const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

// 한쪽이 전부 같은 값이면 상관이 정의되지 않는다. 0 으로 두면 "순위가 수익과 무관했다" 로
// 읽혀, 실제로는 잴 수 없었다는 사실이 사라진다.
const pearson = (left: number[], right: number[]): number | null => {
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDeviation = left[index] - leftMean;
    const rightDeviation = right[index] - rightMean;
    covariance += leftDeviation * rightDeviation;
    leftVariance += leftDeviation * leftDeviation;
    rightVariance += rightDeviation * rightDeviation;
  }
  if (leftVariance === 0 || rightVariance === 0) {
    return null;
  }
  return covariance / Math.sqrt(leftVariance * rightVariance);
};

export const spearmanCorrelation = (
  left: number[],
  right: number[],
): number | null => pearson(averageRanks(left), averageRanks(right));

const toRunIc = (rows: RankIcRow[]): RunIc | 'TOO_FEW' | 'UNDEFINED' => {
  if (rows.length < RANK_IC_MINIMUM_ITEMS) {
    return 'TOO_FEW';
  }
  // 순위 1위가 점수 최고다. 역순으로 넣어야 +가 "순위가 맞았다" 가 된다.
  const ic = spearmanCorrelation(
    rows.map((row) => -row.rank),
    rows.map((row) => row.returnPct),
  );
  if (ic === null) {
    return 'UNDEFINED';
  }
  // 봉 수로 센 지평이라 종목마다 평가일이 다를 수 있다. 회차의 구간은 가장 이른 진입부터
  // 가장 늦은 평가까지로 넓게 잡는다 — 좁게 잡으면 겹친 회차가 표본에 들어온다.
  return {
    ic,
    entryTime: Math.min(...rows.map((row) => row.entryTradeDate.getTime())),
    horizonTime: Math.max(...rows.map((row) => row.horizonTradeDate.getTime())),
  };
};

// 최신 회차부터 거꾸로 고른다. 앞 회차는 평가일이 직전에 고른 회차의 진입일보다 **앞설 때만**
// 들어온다. 같은 날이면 그날 장중을 양쪽이 함께 보므로 뺀다. 최신부터 고르는 이유는 가장
// 최근의 완결 구간이 늘 표본에 들어가게 하려는 것이다.
const pickNonOverlapping = (runs: RunIc[]): RunIc[] => {
  const sorted = [...runs].sort(
    (left, right) => right.entryTime - left.entryTime,
  );
  const picked: RunIc[] = [];
  let boundary = Number.POSITIVE_INFINITY;
  for (const run of sorted) {
    if (run.horizonTime < boundary) {
      picked.push(run);
      boundary = run.entryTime;
    }
  }
  return picked;
};

const tStatisticOf = (values: number[]): number | null => {
  if (values.length < 2) {
    return null;
  }
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  if (variance === 0) {
    return null;
  }
  return average / Math.sqrt(variance / values.length);
};

export const summarizeRankIc = (rows: RankIcRow[]): ScreeningRankIcSummary => {
  const byRun = new Map<number, RankIcRow[]>();
  for (const row of rows) {
    const found = byRun.get(row.runId) ?? [];
    found.push(row);
    byRun.set(row.runId, found);
  }
  let partialRunCount = 0;
  let tooFewItemRunCount = 0;
  let undefinedRunCount = 0;
  const eligible: RunIc[] = [];
  for (const runRows of byRun.values()) {
    if (!runRows[0].runFullyStored) {
      partialRunCount += 1;
      continue;
    }
    const runIc = toRunIc(runRows);
    if (runIc === 'TOO_FEW') {
      tooFewItemRunCount += 1;
    } else if (runIc === 'UNDEFINED') {
      undefinedRunCount += 1;
    } else {
      eligible.push(runIc);
    }
  }
  const sampled = pickNonOverlapping(eligible).map((run) => run.ic);
  return {
    partialRunCount,
    tooFewItemRunCount,
    undefinedRunCount,
    eligibleRunCount: eligible.length,
    sampledRunCount: sampled.length,
    meanIc: sampled.length === 0 ? null : mean(sampled),
    positiveRunCount: sampled.filter((ic) => ic > 0).length,
    tStatistic: tStatisticOf(sampled),
  };
};
