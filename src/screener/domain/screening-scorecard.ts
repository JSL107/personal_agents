// 회차의 통과 종목 사후 성적을 세 갈래로 세운다 — 프롬프트에 실려 산 것 / 실렸는데 안 산 것
// / 통과했지만 상한 밖이라 실리지 않은 것.
//
// 앞 둘이 모델 선택을 재는 축이고, 셋째는 상위 절단(순위 상한)이 나머지 통과분보다 나았는지를
// 재는 다른 축이다. 셋째를 "안 산 것" 에 합치면 모델이 본 적조차 없는 종목이 선택 실패로
// 집계되어 앞 축이 오염된다.
//
// 이 대조가 성립하는 이유는 진입 시점이 양쪽 다 기준일 다음 거래일 시가로 통일돼 있다는
// 것이다(`screening_item_outcome.entry_price` 주석). 같은 날 같은 출발선에 선 종목들이라
// 그 주의 장세는 양쪽에 똑같이 걸려 상쇄되고, 남는 차이가 종목 선택의 몫이다.
//
// 판단하지 않는다 — 값을 고치거나 규칙을 제안하는 것은 다음 단계다. 여기서는 사실만 센다.

// 순위 신호를 보는 구간. 원장에는 통과 전체가 남지만 이 축은 프롬프트에 실린 것 안에서만
// 센다 — 모델이 고른 순위와 견주는 값이라 모집단이 같아야 한다.
export const SCORECARD_TOP_RANK_LIMIT = 5;

export interface ScreeningScorecardRow {
  strategy: string;
  ruleVersion: number;
  rank: number;
  // 그날 프롬프트에 실렸는가. false 면 규칙은 통과했지만 모델이 본 적 없는 종목이다.
  presented: boolean;
  // 총수익률(%). 수수료·세금이 빠져 있다 — 대조군은 실제로 사지 않아 비용이 없으므로
  // 비용을 넣으면 산 쪽만 불리해져 비교가 기운다.
  returnPct: number;
  // 같은 전략·기준일로 매수 주문이 난 종목인가. 체결 여부가 아니라 "모델이 골랐나" 다.
  bought: boolean;
  tickerCode: string;
  tickerName: string;
}

export interface ScreeningScorecardArm {
  count: number;
  meanReturnPct: number | null;
  medianReturnPct: number | null;
  winCount: number;
}

export interface ScreeningScorecardExtreme {
  tickerCode: string;
  tickerName: string;
  rank: number;
  returnPct: number;
}

export interface ScreeningScorecardStrategy {
  strategy: string;
  // 이 표본에 섞인 규칙 버전들. 둘 이상이면 규칙이 바뀐 구간을 걸친 집계라는 뜻이다.
  ruleVersions: number[];
  bought: ScreeningScorecardArm;
  notBought: ScreeningScorecardArm;
  // 통과했지만 프롬프트에 실리지 않은 종목. 위 두 갈래와 같은 표에 섞지 않는다 — 모델이
  // 본 적이 없어 "안 샀다" 의 이유가 될 수 없다.
  notPresented: ScreeningScorecardArm;
  // 산 것 평균 − 안 산 것 평균 (%p). 어느 한쪽이 비면 null 이다.
  gapPct: number | null;
  // 보여준 것 전체 평균 − 상한 밖 평균 (%p). 순위 상한이 실제로 나은 종목을 골라냈는지를
  // 이 값이 답한다. 어느 한쪽이 비면 null 이다.
  cutoffGapPct: number | null;
  boughtMeanRank: number | null;
  topRankMeanReturnPct: number | null;
  topRankCount: number;
  // 안 산 것 중 최고 · 산 것 중 최악. 전략당 한 건씩이라 종목 수에 비례해 부풀지 않는다.
  bestMissed: ScreeningScorecardExtreme | null;
  worstBought: ScreeningScorecardExtreme | null;
}

export interface ScreeningScorecardHorizon {
  horizonDays: number;
  // 이 지평으로 채점된 전체 건수(상한 밖 포함).
  sampleCount: number;
  // 그중 프롬프트에 실린 건수. 산 것/안 산 것 비교의 실제 모집단이라, 전체와 나눠 적지
  // 않으면 상한 밖이 쌓일수록 헤더의 표본 수가 비교에 쓰인 수처럼 읽힌다.
  presentedSampleCount: number;
  // 이번 주에 새로 판정된 건수. 누적 표가 그대로인데도 이 값이 0 이 아니면 표본이 늘고 있다.
  newlyScoredCount: number;
  // 이 지평으로 아직 채점되지 않은 회차 수. 표본이 0 일 때 "고장" 과 "미도래" 를 가른다.
  pendingRunCount: number;
  strategies: ScreeningScorecardStrategy[];
}

const mean = (values: number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
};

const summarizeArm = (rows: ScreeningScorecardRow[]): ScreeningScorecardArm => {
  const returns = rows.map((row) => row.returnPct);
  return {
    count: rows.length,
    meanReturnPct: mean(returns),
    medianReturnPct: median(returns),
    winCount: returns.filter((value) => value > 0).length,
  };
};

const toExtreme = (
  row: ScreeningScorecardRow | undefined,
): ScreeningScorecardExtreme | null =>
  row === undefined
    ? null
    : {
        tickerCode: row.tickerCode,
        tickerName: row.tickerName,
        rank: row.rank,
        returnPct: row.returnPct,
      };

const bestOf = (
  rows: ScreeningScorecardRow[],
): ScreeningScorecardRow | undefined =>
  rows.reduce<ScreeningScorecardRow | undefined>(
    (found, row) =>
      found === undefined || row.returnPct > found.returnPct ? row : found,
    undefined,
  );

const worstOf = (
  rows: ScreeningScorecardRow[],
): ScreeningScorecardRow | undefined =>
  rows.reduce<ScreeningScorecardRow | undefined>(
    (found, row) =>
      found === undefined || row.returnPct < found.returnPct ? row : found,
    undefined,
  );

const summarizeStrategy = (
  strategy: string,
  rows: ScreeningScorecardRow[],
): ScreeningScorecardStrategy => {
  // 모델 선택을 재는 두 갈래의 모집단은 프롬프트에 실린 것뿐이다.
  const presented = rows.filter((row) => row.presented);
  const bought = presented.filter((row) => row.bought);
  const notBought = presented.filter((row) => !row.bought);
  const boughtArm = summarizeArm(bought);
  const notBoughtArm = summarizeArm(notBought);
  const presentedArm = summarizeArm(presented);
  const notPresentedArm = summarizeArm(rows.filter((row) => !row.presented));
  const topRank = presented.filter(
    (row) => row.rank <= SCORECARD_TOP_RANK_LIMIT,
  );
  return {
    strategy,
    ruleVersions: [...new Set(rows.map((row) => row.ruleVersion))].sort(
      (left, right) => left - right,
    ),
    bought: boughtArm,
    notBought: notBoughtArm,
    notPresented: notPresentedArm,
    // 한쪽이 비면 격차를 내지 않는다. 0 으로 두면 "차이가 없었다" 로 읽혀,
    // 실제로는 비교할 대상이 없었다는 사실이 사라진다.
    gapPct:
      boughtArm.meanReturnPct === null || notBoughtArm.meanReturnPct === null
        ? null
        : boughtArm.meanReturnPct - notBoughtArm.meanReturnPct,
    cutoffGapPct:
      presentedArm.meanReturnPct === null ||
      notPresentedArm.meanReturnPct === null
        ? null
        : presentedArm.meanReturnPct - notPresentedArm.meanReturnPct,
    boughtMeanRank: mean(bought.map((row) => row.rank)),
    topRankMeanReturnPct: mean(topRank.map((row) => row.returnPct)),
    topRankCount: topRank.length,
    bestMissed: toExtreme(bestOf(notBought)),
    worstBought: toExtreme(worstOf(bought)),
  };
};

export interface BuildScorecardHorizonInput {
  horizonDays: number;
  rows: ScreeningScorecardRow[];
  newlyScoredCount: number;
  pendingRunCount: number;
}

export const buildScorecardHorizon = ({
  horizonDays,
  rows,
  newlyScoredCount,
  pendingRunCount,
}: BuildScorecardHorizonInput): ScreeningScorecardHorizon => {
  const byStrategy = new Map<string, ScreeningScorecardRow[]>();
  for (const row of rows) {
    const found = byStrategy.get(row.strategy) ?? [];
    found.push(row);
    byStrategy.set(row.strategy, found);
  }
  return {
    horizonDays,
    sampleCount: rows.length,
    presentedSampleCount: rows.filter((row) => row.presented).length,
    newlyScoredCount,
    pendingRunCount,
    strategies: [...byStrategy.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([strategy, strategyRows]) =>
        summarizeStrategy(strategy, strategyRows),
      ),
  };
};
