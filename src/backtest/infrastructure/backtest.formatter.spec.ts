import { ReplayBacktestResult } from '../application/replay-backtest.usecase';
import { formatBacktestResult } from './backtest.formatter';

const result: ReplayBacktestResult = {
  strategy: 'LONG_TERM',
  from: '2026-01-02',
  to: '2026-08-14',
  tradeDateCount: 152,
  orderCount: 34,
  filledCount: 31,
  expiredCount: 3,
  missingOpenCount: 0,
  finalCashBalance: '2159419',
  finalTotalValue: '10412880',
  finalReturnRate: '0.041288',
  delistedLiquidation: { count: 0, proceeds: '0' },
  delistingRecoveryRate: 1,
  scores: [
    {
      strategy: 'LONG_TERM',
      recommendationCount: 34,
      closedCount: 24,
      openCount: 7,
      expiredCount: 3,
      hitCount: 14,
      hitRate: '0.5833',
      meanReturnRate: '0.024',
      medianReturnRate: '0.011',
      maximumLoss: '-0.113',
      averageHoldingDays: '21',
      anomalyCount: 0,
      realizedPnlMismatchCount: 0,
    },
  ],
  meanExcessReturnRate: '0.037',
  benchmarkUnavailableCount: 0,
  exitBand: null,
  volatilityEstimator: 'CLOSE_TO_CLOSE' as const,
  exitBandSellCounts: { takeProfit: 0, stopLoss: 0 },
  intradayStopSellCount: 2,
  intradayStopMargin: { meanPercent: -2.04, gapDownCount: 1 },
  highFallback: { candidateCount: 0, tickerCount: 0 },
  anomaliesByType: {},
  metrics: {
    weightExceededCount: 4,
    maximumWeightPercent: 26.3,
    expirationsByReason: { '현금 부족': 2, '종목 시장 구분 없음': 1 },
    burstFillDayCount: 2,
    maximumFillsInOneDay: 6,
  },
  invariantViolations: [],
};

describe('formatBacktestResult', () => {
  it('청산 밴드를 쓰지 않은 회차를 항상 명시한다', () => {
    const text = formatBacktestResult(result);

    expect(text).toContain(
      '청산 밴드 없음 — 보유일수 청산만 (--take-profit/--stop-loss 미지정)',
    );
  });

  // 건수만 찍으면 수량 불일치인지 상태 이상인지 몰라 이 성적을 믿어도 되는지 판단할 수 없다.
  it('원장 이상은 유형별 건수까지 적는다', () => {
    const resultWithAnomalies: ReplayBacktestResult = {
      ...result,
      scores: [{ ...result.scores[0], anomalyCount: 11 }],
      anomaliesByType: { QUANTITY_MISMATCH: 9, MULTIPLE_BUY_TRADES: 2 },
    };

    const text = formatBacktestResult(resultWithAnomalies);

    expect(text).toContain(
      '⚠ 원장 이상 11건 (QUANTITY_MISMATCH 9, MULTIPLE_BUY_TRADES 2)',
    );
  });

  it('청산 밴드 값과 사유별 매도 주문 건수를 표시한다', () => {
    const resultWithExitBand: ReplayBacktestResult = {
      ...result,
      exitBand: { takeProfitPercent: 2, stopLossPercent: -0.2 },
      exitBandSellCounts: { takeProfit: 12, stopLoss: 30 },
    };
    const text = formatBacktestResult(resultWithExitBand);

    expect(text).toContain(
      '청산 밴드 +2%/-0.2% · 익절 매도 주문 12건 · 손절 매도 주문 30건',
    );
  });

  // 좁은 밴드를 쓸지 판단하는 근거가 이 한 줄이다. 여유폭이 0 에 가까우면 "하루 중 한 틱
  // 스쳐" 발동한 것이라 그 가격에 팔렸을지 의심스럽다 — 찍지 않으면 판단할 재료가 없다.
  it('장중 손절이 얼마나 여유 있게 발동했는지 함께 적는다', () => {
    const text = formatBacktestResult({
      ...result,
      exitBand: { takeProfitPercent: 10, stopLossPercent: -5 },
      intradayStopSellCount: 40,
      intradayStopMargin: { meanPercent: -2.04, gapDownCount: 7 },
    });

    expect(text).toContain('장중 손절 체결 40건');
    expect(text).toContain(
      '저가가 손절선보다 평균 -2.04%p 아래 · 갭하락으로 시가 체결 7건',
    );
  });

  it('장중 손절이 0건이면 여유폭 줄을 만들지 않는다', () => {
    // 분모가 0 인 평균을 0 으로 찍으면 "여유 없이 발동했다" 로 읽힌다.
    const text = formatBacktestResult({
      ...result,
      exitBand: { takeProfitPercent: 10, stopLossPercent: -5 },
      intradayStopSellCount: 0,
      intradayStopMargin: { meanPercent: null, gapDownCount: 0 },
    });

    expect(text).toContain('장중 손절 체결 0건');
    expect(text).not.toContain('저가가 손절선보다');
  });

  // 두 조건의 성적을 섞어 읽는 것을 막는 유일한 표식이다. 운영 규칙일 때 조용한 것도
  // 함께 확인한다 — 매번 찍으면 다른 조건으로 돌린 회차가 눈에 띄지 않는다.
  it('운영 규칙이 아닌 변동성 추정량으로 돌리면 결과에 표시한다', () => {
    const text = formatBacktestResult({
      ...result,
      volatilityEstimator: 'PARKINSON',
    });

    expect(text).toContain('⚠ 변동성 추정량 PARKINSON');
  });

  it('운영 규칙인 종가→종가로 돌리면 추정량을 표시하지 않는다', () => {
    expect(formatBacktestResult(result)).not.toContain('변동성 추정량');
  });

  it('기간·승률·비중 초과 경고를 담는다', () => {
    const text = formatBacktestResult(result);

    expect(text).toContain('2026-01-02 ~ 2026-08-14');
    expect(text).toContain('152 거래일');
    expect(text).toContain('58.33%');
    expect(text).toContain('코스피 대비 초과수익 3.70%');
    expect(text).toContain('목표비중 초과 편입 4건');
    expect(text).toContain('최대 26.3%');
  });

  it('만료 사유를 사유별로 나눠 보여준다', () => {
    const text = formatBacktestResult(result);

    expect(text).toContain('현금 부족 2');
    expect(text).toContain('종목 시장 구분 없음 1');
  });

  it('불변식 위반이 있으면 경고를 앞세운다', () => {
    const text = formatBacktestResult({
      ...result,
      invariantViolations: ['현금 잔액 불일치: 원장 기준 1원, 실제 2원'],
    });

    expect(text).toContain('불변식 위반');
    expect(text).toContain('현금 잔액 불일치');
    // 성적보다 먼저 나와야 읽는 사람이 숫자를 믿기 전에 경고를 본다.
    expect(text.indexOf('불변식 위반')).toBeLessThan(text.indexOf('승률'));
  });

  it('시가 없는 거래일이 있으면 재수집을 안내한다', () => {
    const text = formatBacktestResult({ ...result, missingOpenCount: 12 });

    expect(text).toContain('시가 없는 거래일');
    expect(text).toContain('12건');
  });

  it('값이 없는 지표는 숫자 대신 자리표시를 쓴다', () => {
    const text = formatBacktestResult({
      ...result,
      finalTotalValue: null,
      finalReturnRate: null,
      meanExcessReturnRate: null,
      scores: [],
    });

    expect(text).toContain('—');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('null');
  });

  it('경고가 없으면 경고 줄을 넣지 않는다', () => {
    const text = formatBacktestResult({
      ...result,
      missingOpenCount: 0,
      metrics: {
        weightExceededCount: 0,
        maximumWeightPercent: 0,
        expirationsByReason: {},
        burstFillDayCount: 0,
        maximumFillsInOneDay: 0,
      },
    });

    expect(text).not.toContain('⚠');
  });
});
