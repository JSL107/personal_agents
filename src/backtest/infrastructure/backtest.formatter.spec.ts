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
