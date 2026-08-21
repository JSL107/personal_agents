import {
  RankedStock,
  selectDeterministicRecommendation,
} from './top-scored-selection';

const stock = (code: string, score: number): RankedStock => ({
  tickerId: Number(code),
  code,
  name: `종목${code}`,
  score,
});

describe('selectDeterministicRecommendation', () => {
  it('점수 상위에서 최대 종목수만큼 매수한다', () => {
    const result = selectDeterministicRecommendation({
      rankedStocks: [
        stock('000001', 90),
        stock('000002', 80),
        stock('000003', 70),
      ],
      heldPositions: [],
      maximumPositions: 2,
    });

    expect(result.buys.map((buy) => buy.code)).toEqual(['000001', '000002']);
    expect(result.sells).toEqual([]);
  });

  it('보유 중인 종목은 재매수하지 않는다', () => {
    const result = selectDeterministicRecommendation({
      rankedStocks: [stock('000001', 90), stock('000002', 80)],
      heldPositions: [{ code: '000001', holdingTradeDays: 3 }],
      maximumPositions: 2,
    });

    expect(result.buys.map((buy) => buy.code)).toEqual(['000002']);
  });

  it('빈 자리 수만큼만 매수한다', () => {
    const result = selectDeterministicRecommendation({
      rankedStocks: [stock('000002', 80), stock('000003', 70)],
      heldPositions: [{ code: '000001', holdingTradeDays: 1 }],
      maximumPositions: 2,
    });

    expect(result.buys.map((buy) => buy.code)).toEqual(['000002']);
  });

  it('보유일수가 청산 기준에 닿으면 매도한다', () => {
    const result = selectDeterministicRecommendation({
      rankedStocks: [stock('000001', 90)],
      heldPositions: [
        { code: '000001', holdingTradeDays: 60 },
        { code: '000009', holdingTradeDays: 59 },
      ],
      maximumPositions: 3,
      holdingTradeDays: 60,
    });

    expect(result.sells.map((sell) => sell.code)).toEqual(['000001']);
  });

  it('청산 기준을 주지 않으면 매도하지 않는다', () => {
    const result = selectDeterministicRecommendation({
      rankedStocks: [],
      heldPositions: [{ code: '000001', holdingTradeDays: 999 }],
      maximumPositions: 3,
    });

    expect(result.sells).toEqual([]);
  });

  // 대기 매수는 자리를 차지하지 않는다(설계 §7 연휴 누적). 다만 같은 종목을 겹쳐 사지는
  // 않으므로 후보에서만 빠지고, 그 자리는 다음 순위가 채운다.
  it('대기 매수 종목은 점수 1위여도 다시 매수하지 않고 다음 순위가 그 자리를 채운다', () => {
    const result = selectDeterministicRecommendation({
      rankedStocks: [stock('000001', 90), stock('000002', 80)],
      heldPositions: [],
      pendingBuyCodes: new Set(['000001']),
      maximumPositions: 2,
    });

    expect(result.buys.map((buy) => buy.code)).toEqual(['000002']);
  });

  // 청산으로 비는 자리는 같은 날 다시 채울 수 있어야 한다.
  // 그렇지 않으면 만기 청산 뒤 하루씩 자리가 비어 성적이 규칙이 아니라 타이밍에 좌우된다.
  it('청산 예정 종목의 자리는 그날 바로 채운다', () => {
    const result = selectDeterministicRecommendation({
      rankedStocks: [stock('000002', 80)],
      heldPositions: [{ code: '000001', holdingTradeDays: 60 }],
      maximumPositions: 1,
      holdingTradeDays: 60,
    });

    expect(result.sells.map((sell) => sell.code)).toEqual(['000001']);
    expect(result.buys.map((buy) => buy.code)).toEqual(['000002']);
  });

  it('같은 입력이면 항상 같은 출력이다', () => {
    const command = {
      rankedStocks: [stock('000001', 90), stock('000002', 80)],
      heldPositions: [],
      maximumPositions: 2,
    };

    const first = selectDeterministicRecommendation(command);
    const second = selectDeterministicRecommendation(command);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
