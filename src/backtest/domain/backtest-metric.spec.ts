import { summarizeBacktestMetrics } from './backtest-metric';

const emptyInput = {
  fills: [],
  expirations: [],
  targetWeightPercent: 20,
  maximumPositions: 3,
};

describe('summarizeBacktestMetrics', () => {
  it('목표 비중을 넘겨 체결된 건수와 최댓값을 센다', () => {
    const summary = summarizeBacktestMetrics({
      ...emptyInput,
      fills: [
        {
          tradeDate: '2026-08-14',
          filledAmount: 2600000,
          accountValuation: 10000000,
        },
        {
          tradeDate: '2026-08-14',
          filledAmount: 1900000,
          accountValuation: 10000000,
        },
      ],
    });

    expect(summary.weightExceededCount).toBe(1);
    expect(summary.maximumWeightPercent).toBeCloseTo(26, 5);
  });

  it('만료 사유별로 집계한다', () => {
    const summary = summarizeBacktestMetrics({
      ...emptyInput,
      expirations: [
        { tradeDate: '2026-08-14', statusReason: '현금 부족' },
        { tradeDate: '2026-08-14', statusReason: '현금 부족' },
        { tradeDate: '2026-08-17', statusReason: '보유 수량 없음' },
      ],
    });

    expect(summary.expirationsByReason).toEqual({
      '현금 부족': 2,
      '보유 수량 없음': 1,
    });
  });

  it('한 거래일에 최대 종목수를 넘겨 체결된 날을 센다', () => {
    const fill = (tradeDate: string) => ({
      tradeDate,
      filledAmount: 100,
      accountValuation: 10000000,
    });
    const summary = summarizeBacktestMetrics({
      ...emptyInput,
      fills: [
        fill('2026-08-17'),
        fill('2026-08-17'),
        fill('2026-08-17'),
        fill('2026-08-17'),
        fill('2026-08-18'),
      ],
    });

    expect(summary.burstFillDayCount).toBe(1);
    expect(summary.maximumFillsInOneDay).toBe(4);
  });

  it('체결이 없으면 모든 지표가 0 이다', () => {
    const summary = summarizeBacktestMetrics(emptyInput);

    expect(summary).toEqual({
      weightExceededCount: 0,
      maximumWeightPercent: 0,
      expirationsByReason: {},
      burstFillDayCount: 0,
      maximumFillsInOneDay: 0,
    });
  });

  // 평가액이 0 이하이면 비중이 무한대가 되어 지표가 통째로 망가진다.
  // 계좌가 비었을 때(첫 매수 직전 등) 실제로 발생할 수 있는 값이라 입구에서 걸러야 한다.
  it('평가액이 0 이하인 체결은 비중 계산에서 제외한다', () => {
    const summary = summarizeBacktestMetrics({
      ...emptyInput,
      fills: [
        { tradeDate: '2026-08-14', filledAmount: 100, accountValuation: 0 },
        {
          tradeDate: '2026-08-14',
          filledAmount: 100,
          accountValuation: -1000,
        },
      ],
    });

    expect(summary.weightExceededCount).toBe(0);
    expect(summary.maximumWeightPercent).toBe(0);
    expect(Number.isFinite(summary.maximumWeightPercent)).toBe(true);
  });

  it('목표 비중과 정확히 같으면 초과로 세지 않는다', () => {
    const summary = summarizeBacktestMetrics({
      ...emptyInput,
      fills: [
        {
          tradeDate: '2026-08-14',
          filledAmount: 2000000,
          accountValuation: 10000000,
        },
      ],
    });

    expect(summary.weightExceededCount).toBe(0);
    expect(summary.maximumWeightPercent).toBeCloseTo(20, 5);
  });
});
