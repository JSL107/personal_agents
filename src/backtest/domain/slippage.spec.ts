import { applySlippage } from './slippage';

describe('applySlippage', () => {
  it('0 이면 체결가를 그대로 둔다', () => {
    expect(applySlippage(10_000, 'BUY', 0)).toBe(10_000);
    expect(applySlippage(10_000, 'SELL', 0)).toBe(10_000);
  });

  it('매수는 비싸게, 매도는 싸게 민다', () => {
    expect(applySlippage(10_000, 'BUY', 0.5)).toBeCloseTo(10_050, 6);
    expect(applySlippage(10_000, 'SELL', 0.5)).toBeCloseTo(9_950, 6);
  });

  // 방향이 한쪽으로만 걸리면 왕복 비용이 절반으로 잡혀 임계값이 두 배로 부풀려진다.
  it('왕복이면 두 배로 물린다', () => {
    const bought = applySlippage(10_000, 'BUY', 1);
    const sold = applySlippage(10_000, 'SELL', 1);
    expect((sold / bought - 1) * 100).toBeCloseTo(-1.98, 2);
  });
});
