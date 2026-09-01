import { ReplayBacktestResult } from '../application/replay-backtest.usecase';

// 값이 없는 지표는 0 이나 NaN 대신 자리표시를 쓴다. 0 으로 찍으면 "쟀는데 0" 과
// "재지 못했다" 가 구분되지 않아 성적을 잘못 읽는다.
const NO_VALUE = '—';

const percent = (value: string | null): string =>
  value === null ? NO_VALUE : `${(Number(value) * 100).toFixed(2)}%`;

const won = (value: string | null): string =>
  value === null ? NO_VALUE : `${Number(value).toLocaleString('ko-KR')}원`;

const days = (value: string | null): string =>
  value === null ? NO_VALUE : `${Number(value).toFixed(0)}일`;

export const formatBacktestResult = (result: ReplayBacktestResult): string => {
  const lines: string[] = [];

  // 불변식이 깨진 성적은 규칙의 성적이 아니라 버그의 성적이다. 숫자보다 먼저 보여준다.
  if (result.invariantViolations.length > 0) {
    lines.push('❌ 불변식 위반 — 아래 성적은 신뢰할 수 없다');
    for (const violation of result.invariantViolations) {
      lines.push(`   ${violation}`);
    }
    lines.push('');
  }

  lines.push(
    `기간 ${result.from} ~ ${result.to} (${result.tradeDateCount} 거래일) · 전략 ${result.strategy}`,
  );
  lines.push('─'.repeat(60));

  const expirationText = Object.entries(result.metrics.expirationsByReason)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(', ');
  lines.push(
    `주문 ${result.orderCount}건 · 체결 ${result.filledCount}건 · 만료 ${result.expiredCount}건` +
      (expirationText === '' ? '' : ` (${expirationText})`),
  );

  for (const score of result.scores) {
    lines.push(
      `승률 ${percent(score.hitRate)}  평균수익률 ${percent(score.meanReturnRate)}  ` +
        `중앙값 ${percent(score.medianReturnRate)}  최대손실 ${percent(score.maximumLoss)}`,
    );
    lines.push(
      `종결 ${score.closedCount}건 · 보유중 ${score.openCount}건 · 평균보유 ${days(score.averageHoldingDays)}`,
    );
    if (score.anomalyCount > 0) {
      // 유형을 함께 찍는다. 건수만 있으면 수량 불일치인지 상태 이상인지 몰라
      // 이 성적을 믿어도 되는지 판단할 수 없다.
      const typeText = Object.entries(result.anomaliesByType)
        .map(([type, count]) => `${type} ${count}`)
        .join(', ');
      lines.push(
        `⚠ 원장 이상 ${score.anomalyCount}건` +
          (typeText === '' ? '' : ` (${typeText})`),
      );
    }
  }
  if (result.scores.length === 0) {
    lines.push(
      `승률 ${NO_VALUE}  평균수익률 ${NO_VALUE}  — 종결된 추천이 없다`,
    );
  }

  lines.push(
    `코스피 대비 초과수익 ${percent(result.meanExcessReturnRate)}` +
      (result.benchmarkUnavailableCount > 0
        ? ` (벤치마크 종가 없음 ${result.benchmarkUnavailableCount}건 제외)`
        : ''),
  );
  lines.push(
    `최종 평가액 ${won(result.finalTotalValue)} (${percent(result.finalReturnRate)}) · 현금 ${won(result.finalCashBalance)}`,
  );
  // 운영 규칙일 때는 찍지 않는다. 기본값을 매번 알리면 실제로 다른 조건으로 돌린 회차가
  // 눈에 안 띈다 — 비운영 조건일 때만 결과에 남긴다.
  if (result.volatilityEstimator !== 'CLOSE_TO_CLOSE') {
    lines.push(
      `⚠ 변동성 추정량 ${result.volatilityEstimator} — 운영 규칙(종가→종가)이 아니다`,
    );
  }
  if (result.exitBand === null) {
    lines.push(
      '청산 밴드 없음 — 보유일수 청산만 (--take-profit/--stop-loss 미지정)',
    );
  } else {
    lines.push(
      `청산 밴드 +${result.exitBand.takeProfitPercent}%/${result.exitBand.stopLossPercent}% · ` +
        // 체결 수가 아니라 주문 생성 수다. 만료(시가 없음)된 주문도 포함된다.
        `익절 매도 주문 ${result.exitBandSellCounts.takeProfit}건 · ` +
        `손절 매도 주문 ${result.exitBandSellCounts.stopLoss}건`,
    );
    // 종가 밴드와 한 줄에 합치지 않는다. 이쪽은 주문이 아니라 그날 체결까지 끝난 건수라
    // 성격이 다르고, 0 건이면 "장중에 손절선을 뚫은 날이 없었다" 는 사실 자체가 정보다.
    lines.push(
      `장중 손절 체결 ${result.intradayStopSellCount}건 (저가로 판정 · min(시가, 손절선)으로 체결)`,
    );
  }
  // 0 건도 적는다. 줄이 없으면 "섞이지 않았다" 와 "세지 않았다" 가 구분되지 않는다.
  // 값이 있으면 그 종목의 신고가 위치가 부풀려진 채 순위에 올랐다는 뜻이다.
  lines.push(
    `고가 결측 종가대체 후보 ${result.highFallback.candidateCount}건` +
      ` · ${result.highFallback.tickerCount}종목 (신고가 위치가 부풀려짐)`,
  );
  // 0 건도 적는다. 줄이 없으면 "폐지가 없던 구간" 과 "폐지를 안 본 구간" 이 구분되지 않는다.
  lines.push(
    `보유 중 상장폐지 청산 ${result.delistedLiquidation.count}건` +
      ` · 청산 대금 ${won(result.delistedLiquidation.proceeds)}` +
      ` (회수율 ${result.delistingRecoveryRate})`,
  );

  if (result.metrics.weightExceededCount > 0) {
    lines.push(
      `⚠ 목표비중 초과 편입 ${result.metrics.weightExceededCount}건 ` +
        `(최대 ${result.metrics.maximumWeightPercent.toFixed(1)}%)`,
    );
  }
  if (result.metrics.burstFillDayCount > 0) {
    lines.push(
      `⚠ 한 거래일 동시 체결 ${result.metrics.burstFillDayCount}회 ` +
        `(최대 ${result.metrics.maximumFillsInOneDay}종목)`,
    );
  }
  if (result.missingOpenCount > 0) {
    lines.push(
      `⚠ 시가 없는 거래일로 만료된 주문 ${result.missingOpenCount}건 — 재수집이 필요하다`,
    );
  }

  return lines.join('\n');
};
