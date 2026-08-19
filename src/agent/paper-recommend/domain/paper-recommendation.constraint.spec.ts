import { constrainPaperRecommendation } from './paper-recommendation.constraint';

describe('constrainPaperRecommendation', () => {
  const candidates = [
    { tickerId: 1, code: '000001', name: '첫째', close: 10_000 },
    { tickerId: 2, code: '000002', name: '둘째', close: 20_000 },
    { tickerId: 3, code: '000003', name: '셋째', close: 25_000 },
    { tickerId: 4, code: '000004', name: '넷째', close: 40_000 },
  ];

  it('앞의 세 매수만 채택하고 비중은 종목마다 상한값으로 배정한다', () => {
    const result = constrainPaperRecommendation({
      recommendation: {
        sells: [],
        buys: [
          { code: '000001', reason: '첫째' },
          { code: '000002', reason: '둘째' },
          { code: '000003', reason: '셋째' },
          { code: '000004', reason: '넷째' },
        ],
      },
      candidates,
      positions: [],
      cashBalance: 10_000_000,
      accountValuation: 10_000_000,
    });

    expect(result.buys).toEqual([
      expect.objectContaining({
        code: '000001',
        weightPercent: 20,
        quantity: 200,
      }),
      expect.objectContaining({
        code: '000002',
        weightPercent: 20,
        quantity: 100,
      }),
      expect.objectContaining({
        code: '000003',
        weightPercent: 20,
        quantity: 80,
      }),
    ]);
  });

  // 같은 추천을 두 번 넣으면 같은 수량이 나와야 백테스트 재생과 규칙 A/B 비교가 성립한다.
  it('같은 입력에 같은 수량을 내고 모델이 보낸 비중은 읽지 않는다', () => {
    const recommendation = {
      sells: [],
      buys: [{ code: '000001', reason: '첫째' }],
    };
    const input = {
      candidates,
      positions: [],
      cashBalance: 10_000_000,
      accountValuation: 10_000_000,
    };

    const first = constrainPaperRecommendation({ recommendation, ...input });
    const second = constrainPaperRecommendation({
      // 모델이 스키마를 어기고 비중을 덧붙여 보낸 상황. 수량이 흔들리면 안 된다.
      recommendation: {
        sells: [],
        buys: [{ code: '000001', weightPercent: 3, reason: '첫째' } as never],
      },
      ...input,
    });

    expect(first.buys).toEqual(second.buys);
    expect(first.buys[0]).toEqual(
      expect.objectContaining({ weightPercent: 20, quantity: 200 }),
    );
  });

  it('주입한 비중 상한을 그대로 매수 비중으로 쓴다', () => {
    const result = constrainPaperRecommendation({
      recommendation: { sells: [], buys: [{ code: '000001', reason: '첫째' }] },
      candidates,
      positions: [],
      cashBalance: 10_000_000,
      accountValuation: 10_000_000,
      maximumWeightPercent: 30,
    });

    expect(result.buys).toEqual([
      expect.objectContaining({ weightPercent: 30, quantity: 300 }),
    ]);
  });

  // 상한이 유일한 수량 입력이므로 숫자가 아닌 값이 그냥 통과하면 NaN 주문이 만들어진다.
  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
    '비중 상한이 %p 이면 매수를 만들지 않고 ZERO_WEIGHT로 기록한다',
    (maximumWeightPercent) => {
      const result = constrainPaperRecommendation({
        recommendation: {
          sells: [],
          buys: [{ code: '000001', reason: '첫째' }],
        },
        candidates,
        positions: [],
        cashBalance: 10_000_000,
        accountValuation: 10_000_000,
        maximumWeightPercent,
      });

      expect(result.buys).toEqual([]);
      expect(result.skipped).toEqual([
        { side: 'BUY', code: '000001', reason: 'ZERO_WEIGHT' },
      ]);
    },
  );

  it('보유 중이거나 후보에 없는 매수는 제거한다', () => {
    const result = constrainPaperRecommendation({
      recommendation: {
        sells: [],
        buys: [
          { code: '000001', reason: '보유 중' },
          { code: '999999', reason: '환각' },
          { code: '000002', reason: '후보' },
        ],
      },
      candidates,
      positions: [{ tickerId: 1, code: '000001', quantity: 7 }],
      cashBalance: 10_000_000,
      accountValuation: 10_000_000,
    });

    expect(result.buys).toEqual([
      expect.objectContaining({ code: '000002', quantity: 100 }),
    ]);
  });

  it('앞쪽의 무효한 및 0주 매수를 제거한 뒤 유효한 세 종목을 채택한다', () => {
    const result = constrainPaperRecommendation({
      recommendation: {
        sells: [],
        buys: [
          { code: '000001', reason: '보유 중' },
          { code: '999999', reason: '환각' },
          { code: '000005', reason: '0주' },
          { code: '000002', reason: '유효 1' },
          { code: '000003', reason: '유효 2' },
          { code: '000004', reason: '유효 3' },
          { code: '000006', reason: '상한 초과' },
        ],
      },
      candidates: [
        ...candidates,
        { tickerId: 5, code: '000005', name: '비싼', close: 1_000_000 },
        { tickerId: 6, code: '000006', name: '다섯째', close: 10_000 },
      ],
      positions: [{ tickerId: 1, code: '000001', quantity: 7 }],
      cashBalance: 600_000,
      accountValuation: 1_000_000,
    });

    expect(result.buys.map((buy) => buy.code)).toEqual([
      '000002',
      '000003',
      '000004',
    ]);
  });

  it('보유한 종목만 항상 보유 전량으로 매도한다', () => {
    const result = constrainPaperRecommendation({
      recommendation: {
        sells: [
          { code: '000001', reason: '정리' },
          { code: '999999', reason: '없는 종목' },
        ],
        buys: [],
      },
      candidates,
      positions: [{ tickerId: 1, code: '000001', quantity: 7 }],
      cashBalance: 10_000_000,
      accountValuation: 10_000_000,
    });

    expect(result.sells).toEqual([
      expect.objectContaining({ code: '000001', quantity: 7, reason: '정리' }),
    ]);
  });

  it('현금이 부족하면 앞선 매수부터 수량을 줄이고 0주는 생략한다', () => {
    const result = constrainPaperRecommendation({
      recommendation: {
        sells: [],
        buys: [
          { code: '000001', reason: '첫째' },
          { code: '000002', reason: '둘째' },
          { code: '000003', reason: '셋째' },
        ],
      },
      candidates,
      positions: [],
      cashBalance: 25_000,
      accountValuation: 10_000_000,
    });

    expect(result.buys).toEqual([
      expect.objectContaining({ code: '000001', quantity: 2 }),
    ]);
  });

  it('현금으로 한 주도 살 수 없으면 매수 주문을 만들지 않는다', () => {
    const result = constrainPaperRecommendation({
      recommendation: {
        sells: [],
        buys: [{ code: '000002', reason: '비쌈' }],
      },
      candidates,
      positions: [],
      cashBalance: 19_999,
      accountValuation: 10_000_000,
    });

    expect(result.buys).toEqual([]);
  });

  it('보유·후보 이탈·현금 부족 매수의 제외 사유를 기록한다', () => {
    const result = constrainPaperRecommendation({
      recommendation: {
        sells: [],
        buys: [
          { code: '000001', reason: '보유 중' },
          { code: '999999', reason: '후보 밖' },
          { code: '000002', reason: '현금 부족 1' },
          { code: '000003', reason: '현금 부족 2' },
        ],
      },
      candidates,
      positions: [{ tickerId: 1, code: '000001', quantity: 7 }],
      cashBalance: 1,
      accountValuation: 10_000_000,
    });

    expect(result.skipped).toEqual([
      { side: 'BUY', code: '000001', reason: 'ALREADY_HELD' },
      { side: 'BUY', code: '999999', reason: 'NOT_IN_CANDIDATES' },
      { side: 'BUY', code: '000002', reason: 'INSUFFICIENT_CASH' },
      { side: 'BUY', code: '000003', reason: 'INSUFFICIENT_CASH' },
    ]);
  });

  it('매수 상한 뒤 남은 추천을 모두 기록하고 기존 세 매수 결과는 바꾸지 않는다', () => {
    const result = constrainPaperRecommendation({
      recommendation: {
        sells: [],
        buys: [
          { code: '000001', reason: '첫째' },
          { code: '000002', reason: '둘째' },
          { code: '000003', reason: '셋째' },
          { code: '000004', reason: '넷째' },
          { code: '999999', reason: '다섯째' },
        ],
      },
      candidates,
      positions: [],
      cashBalance: 10_000_000,
      accountValuation: 10_000_000,
    });

    expect(result.buys).toEqual([
      expect.objectContaining({
        code: '000001',
        weightPercent: 20,
        quantity: 200,
        close: 10_000,
      }),
      expect.objectContaining({
        code: '000002',
        weightPercent: 20,
        quantity: 100,
        close: 20_000,
      }),
      expect.objectContaining({
        code: '000003',
        weightPercent: 20,
        quantity: 80,
        close: 25_000,
      }),
    ]);
    expect(result.skipped).toEqual([
      { side: 'BUY', code: '000004', reason: 'BUY_LIMIT_REACHED' },
      { side: 'BUY', code: '999999', reason: 'BUY_LIMIT_REACHED' },
    ]);
  });

  it('보유하지 않은 매도 추천의 제외 사유를 기록한다', () => {
    const result = constrainPaperRecommendation({
      recommendation: {
        sells: [
          { code: '000001', reason: '보유 종목' },
          { code: '999999', reason: '미보유 종목' },
        ],
        buys: [],
      },
      candidates,
      positions: [{ tickerId: 1, code: '000001', quantity: 7 }],
      cashBalance: 10_000_000,
      accountValuation: 10_000_000,
    });

    expect(result.sells).toEqual([
      expect.objectContaining({ code: '000001', quantity: 7 }),
    ]);
    expect(result.skipped).toEqual([
      { side: 'SELL', code: '999999', reason: 'NOT_HELD' },
    ]);
  });
});
