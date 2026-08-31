import { BuildScreeningScorecardResult } from '../application/build-screening-scorecard.usecase';
import {
  SCORECARD_TOP_RANK_LIMIT,
  ScreeningScorecardArm,
  ScreeningScorecardExtreme,
  ScreeningScorecardHorizon,
  ScreeningScorecardStrategy,
} from '../domain/screening-scorecard';

// 이 수를 밑돌면 격차를 추세로 읽지 말라고 카드에 적는다. 설계 문서 §안전장치의
// 최소 표본과 같은 값이다 — 3~4건으로 낸 비율은 근거처럼 쓰이면서 사실상 추측이다.
const TREND_MINIMUM_SAMPLE = 10;

// 표시 자리수. 판정(toDisplayGap)도 이 값을 써야 표와 결론이 갈리지 않는다.
const PERCENT_FRACTION_DIGITS = 2;

const formatPercent = (value: number | null, unit = '%'): string => {
  if (value === null) {
    return '-';
  }
  const rounded = value.toFixed(PERCENT_FRACTION_DIGITS);
  // 부호도 반올림한 값에서 정한다. 원값으로 정하면 부동소수 잔여가 `+0.00%p` 를 만들어,
  // 동률이라고 판정한 결론과 표가 어긋난다.
  return `${Number(rounded) > 0 ? '+' : ''}${rounded}${unit}`;
};

const formatRank = (value: number | null): string =>
  value === null ? '-' : value.toFixed(1);

const formatArm = (label: string, arm: ScreeningScorecardArm): string => {
  if (arm.count === 0) {
    return `  ${label} 0건 — 해당 없음`;
  }
  return (
    `  ${label} ${arm.count}건` +
    ` · 평균 ${formatPercent(arm.meanReturnPct)}` +
    ` · 중앙값 ${formatPercent(arm.medianReturnPct)}` +
    ` · 이익 ${arm.winCount}/${arm.count}`
  );
};

// 규칙이 바뀐 구간을 걸친 표본은 그 사실이 드러나야 한다. 버전 하나로 뭉뚱그리면
// 옛 규칙의 성적으로 새 규칙을 논하게 된다 (paper-score.formatter 와 같은 규율).
const formatRuleVersions = (ruleVersions: number[]): string => {
  if (ruleVersions.length === 0) {
    return '규칙 -';
  }
  if (ruleVersions.length === 1) {
    return `규칙 v${ruleVersions[0]}`;
  }
  return `규칙 v${ruleVersions.join('·v')} 혼합`;
};

const formatStrategy = (strategy: ScreeningScorecardStrategy): string[] => {
  const lines = [
    `*${strategy.strategy}* (${formatRuleVersions(strategy.ruleVersions)})`,
    formatArm('산 것   ', strategy.bought),
    formatArm('안 산 것', strategy.notBought),
  ];
  const gap =
    strategy.gapPct === null
      ? '  격차 - — 한쪽에 표본이 없어 비교 대상이 없음'
      : `  격차 ${formatPercent(strategy.gapPct, '%p')} (산 것 평균 − 안 산 것 평균)`;
  lines.push(gap);
  // 순위 축. 모델이 고른 것이 순위 상위 구간보다 나았는지를 이 줄에서만 볼 수 있다.
  lines.push(
    `  상위 1~${SCORECARD_TOP_RANK_LIMIT}위 평균 ${formatPercent(strategy.topRankMeanReturnPct)}` +
      ` (${strategy.topRankCount}건)` +
      ` · 산 것 평균순위 ${formatRank(strategy.boughtMeanRank)}`,
  );
  return lines;
};

// 표에 적히는 값과 같은 자리에서 부호를 본다. 원값으로 판정하면 부동소수 잔여
// (`0.1 + 0.2` 류) 때문에 표에 `0.00%p` 가 적힌 채 결론만 "나았다" 로 갈린다.
const toDisplayGap = (strategy: ScreeningScorecardStrategy): number =>
  Number((strategy.gapPct as number).toFixed(PERCENT_FRACTION_DIGITS));

// 격차의 부호에서만 결론을 만든다. 문장을 따로 쓰면 표와 어긋날 수 있다.
const formatVerdict = (
  strategies: ScreeningScorecardStrategy[],
): string | null => {
  const comparable = strategies.filter((strategy) => strategy.gapPct !== null);
  if (comparable.length === 0) {
    return '고른 것이 나았나 → 비교할 표본이 없음';
  }
  // 비교 불가 전략을 빼고 세면서 "전 전략" 이라 적으면, 격차가 `-` 인 전략이 표에 있는데
  // 결론은 전부를 말하는 것처럼 읽힌다. 셈의 모집단을 문구에 그대로 적는다.
  const scope =
    comparable.length === strategies.length
      ? '전 전략'
      : `비교 가능한 ${comparable.length}/${strategies.length}개 전략`;
  const better = comparable.filter((strategy) => toDisplayGap(strategy) > 0);
  const worse = comparable.filter((strategy) => toDisplayGap(strategy) < 0);
  if (better.length === comparable.length) {
    return `고른 것이 안 고른 것보다 나았나 → ${scope} 그렇다`;
  }
  // 전부 나빴을 때만 "아니다" 다. 격차가 0 인 전략을 여기 넣으면 표에 `0.00%p` 가 적힌
  // 채 결론은 "아니다" 가 되어 둘이 어긋난다.
  if (worse.length === comparable.length) {
    return `고른 것이 안 고른 것보다 나았나 → ${scope} 아니다`;
  }
  const label =
    better.length === 0
      ? '나은 쪽 없음(나머지는 동률)'
      : `나은 쪽 ${better.map((strategy) => strategy.strategy).join('·')}`;
  // 전부를 보고 있으면 모집단을 덧붙이지 않는다 — `갈림(전 전략)` 은 군더더기다.
  const scopeSuffix =
    comparable.length === strategies.length ? '' : `(${scope})`;
  return `고른 것이 안 고른 것보다 나았나 → 갈림${scopeSuffix}: ${label}`;
};

// 표본이 작다는 사실을 격차 옆에 적는다. 적어 두지 않으면 2~3건으로 낸 격차가
// 추세처럼 읽힌다.
const formatSampleCaveat = (
  strategies: ScreeningScorecardStrategy[],
): string | null => {
  const thin = strategies.filter(
    (strategy) =>
      strategy.bought.count > 0 && strategy.bought.count < TREND_MINIMUM_SAMPLE,
  );
  if (thin.length === 0) {
    return null;
  }
  const detail = thin
    .map((strategy) => `${strategy.strategy} ${strategy.bought.count}건`)
    .join(' · ');
  return `산 것 표본이 ${TREND_MINIMUM_SAMPLE}건 미만입니다(${detail}) — 이 격차는 아직 추세가 아닙니다.`;
};

const formatHorizon = (horizon: ScreeningScorecardHorizon): string[] => {
  // 표본이 없는 지평도 빼지 않는다. 빼면 그 축이 카드에서 조용히 사라져, 아직 안 온
  // 것과 채점이 고장난 것을 가릴 수 없다.
  if (horizon.sampleCount === 0) {
    return [
      `*${horizon.horizonDays}거래일 지평* — 표본 없음` +
        ` (채점 대기 회차 ${horizon.pendingRunCount}건)`,
    ];
  }
  const lines = [
    `*${horizon.horizonDays}거래일 지평* — 표본 ${horizon.sampleCount}건` +
      ` · 최근 7일 신규 ${horizon.newlyScoredCount}건` +
      ` · 채점 대기 회차 ${horizon.pendingRunCount}건`,
  ];
  const verdict = formatVerdict(horizon.strategies);
  if (verdict !== null) {
    lines.push(verdict);
  }
  for (const strategy of horizon.strategies) {
    lines.push(...formatStrategy(strategy));
  }
  const caveat = formatSampleCaveat(horizon.strategies);
  if (caveat !== null) {
    lines.push(caveat);
  }
  return lines;
};

export const formatScreeningScorecard = (
  result: BuildScreeningScorecardResult,
): string => {
  const lines = [
    `*스크리닝 성적 카드 — ${result.asOf.toISOString().slice(0, 10)}*`,
    '같은 날 후보에 올랐지만 사지 않은 종목을 대조군으로 잡습니다. 진입이 양쪽 다 기준일 다음 거래일 시가라 그 주 장세는 상쇄되고, 남는 차이가 종목 선택의 몫입니다.',
  ];
  for (const horizon of result.horizons) {
    lines.push('');
    lines.push(...formatHorizon(horizon));
  }
  return lines.join('\n');
};

const formatExtreme = (
  strategy: string,
  extreme: ScreeningScorecardExtreme,
  poolCount: number,
): string =>
  `  ${strategy} ${extreme.tickerName}(${extreme.tickerCode})` +
  ` 순위 ${extreme.rank}위 ${formatPercent(extreme.returnPct)}` +
  ` — ${poolCount}건 중 1건`;

// 스레드 댓글로 나가는 상세. 지평·전략당 각 1건씩만 실으므로 종목 수가 늘어도 길이가
// 늘지 않는다. 절삭이 아니라는 것이 드러나게 분모(`N건 중 1건`)를 함께 적는다.
export const formatScreeningScorecardDetail = (
  result: BuildScreeningScorecardResult,
): string | null => {
  const missed: string[] = [];
  const worst: string[] = [];
  for (const horizon of result.horizons) {
    for (const strategy of horizon.strategies) {
      const label = `[${horizon.horizonDays}거래일]`;
      if (strategy.bestMissed !== null) {
        missed.push(
          formatExtreme(
            `${label} ${strategy.strategy}`,
            strategy.bestMissed,
            strategy.notBought.count,
          ),
        );
      }
      if (strategy.worstBought !== null) {
        worst.push(
          formatExtreme(
            `${label} ${strategy.strategy}`,
            strategy.worstBought,
            strategy.bought.count,
          ),
        );
      }
    }
  }
  if (missed.length === 0 && worst.length === 0) {
    return null;
  }
  const lines: string[] = [];
  if (missed.length > 0) {
    lines.push('*놓친 최고 — 후보에 있었지만 안 산 것*');
    lines.push(...missed);
  }
  if (worst.length > 0) {
    lines.push('*산 것 중 최악*');
    lines.push(...worst);
  }
  return lines.join('\n');
};
