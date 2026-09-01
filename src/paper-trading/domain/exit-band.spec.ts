import {
  decideExitBandOrders,
  decideIntradayStopOrders,
  DEFAULT_EXIT_BAND,
  describeExitBandReason,
  describeIntradayStopReason,
  resolveIntradayStopFillPrice,
  summarizeExitBandUsage,
} from './exit-band';

const candidate = (
  overrides: Partial<{
    tickerId: number;
    tickerCode: string;
    quantity: string;
    returnRate: string;
    isStale: boolean;
  }> = {},
) => ({
  tickerId: 1,
  tickerCode: '005930',
  quantity: '10',
  returnRate: '0',
  isStale: false,
  ...overrides,
});

const intradayStopCandidate = (
  overrides: Partial<{
    tickerId: number;
    tickerCode: string;
    quantity: string;
    returnRatePercent: number;
    price: string;
  }> = {},
) => ({
  tickerId: 1,
  tickerCode: '008930',
  quantity: '32',
  returnRatePercent: -5,
  price: '46100',
  ...overrides,
});

describe('decideIntradayStopOrders', () => {
  // `<=`가 `<`로 바뀌면 정확히 손절선에 닿은 보유 종목이 청산되지 않는다.
  it('정확히 -5%이면 장중 손절 대상으로 정리한다', () => {
    const decisions = decideIntradayStopOrders([intradayStopCandidate()]);

    expect(decisions).toEqual([
      {
        tickerId: 1,
        tickerCode: '008930',
        quantity: '32',
        returnRatePercent: -5,
        price: '46100',
      },
    ]);
  });

  it.each([
    ['0', -6],
    ['-1', -6],
    ['NaN', -6],
    ['1', Number.NaN],
    ['1', Number.POSITIVE_INFINITY],
  ])(
    '수량 또는 손익률이 유효하지 않으면 제외한다: quantity=%s, returnRatePercent=%s',
    (quantity, returnRatePercent) => {
      const decisions = decideIntradayStopOrders([
        intradayStopCandidate({ quantity, returnRatePercent }),
      ]);

      expect(decisions).toEqual([]);
    },
  );

  it('익절 구간은 장중 청산하지 않는다', () => {
    const decisions = decideIntradayStopOrders([
      intradayStopCandidate({ returnRatePercent: 20 }),
    ]);

    expect(decisions).toEqual([]);
  });
});

describe('describeIntradayStopReason', () => {
  it('판정가를 포함한 장중 손절 사유를 남긴다', () => {
    const reason = describeIntradayStopReason(
      intradayStopCandidate({ returnRatePercent: -18.28 }),
    );

    expect(reason).toBe(
      '장중 손절 밴드 이탈: 평가 손익률 -18.28% (기준 -5% 이하, 판정가 46100원)',
    );
  });
});

describe('decideExitBandOrders', () => {
  it('익절 기준 이상이면 TAKE_PROFIT 으로 정리한다', () => {
    const decisions = decideExitBandOrders([candidate({ returnRate: '10' })]);

    expect(decisions).toEqual([
      {
        tickerId: 1,
        tickerCode: '005930',
        quantity: '10',
        reason: 'TAKE_PROFIT',
        returnRatePercent: 10,
      },
    ]);
  });

  it('손절 기준 이하면 STOP_LOSS 로 정리한다', () => {
    const decisions = decideExitBandOrders([candidate({ returnRate: '-5' })]);

    expect(decisions[0].reason).toBe('STOP_LOSS');
  });

  // 경계값은 양쪽 다 포함이다. 여기가 배타로 바뀌면 정확히 기준선에 붙은 종목이
  // 매일 판정만 받고 영원히 안 팔린다.
  it('밴드 안(-4.99% ~ 9.99%)이면 아무 주문도 만들지 않는다', () => {
    const decisions = decideExitBandOrders([
      candidate({ returnRate: '9.99' }),
      candidate({ tickerId: 2, returnRate: '-4.99' }),
      candidate({ tickerId: 3, returnRate: '0' }),
    ]);

    expect(decisions).toEqual([]);
  });

  it('시세가 낡은 종목은 밴드를 넘겨도 판정에서 뺀다', () => {
    const decisions = decideExitBandOrders([
      candidate({ returnRate: '-9', isStale: true }),
    ]);

    expect(decisions).toEqual([]);
  });

  it('수량이 없거나 손익률이 숫자가 아니면 건너뛴다', () => {
    const decisions = decideExitBandOrders([
      candidate({ quantity: '0', returnRate: '19' }),
      candidate({ tickerId: 2, returnRate: 'NaN' }),
    ]);

    expect(decisions).toEqual([]);
  });

  it('임계값을 바꾸면 그 기준으로 판정한다', () => {
    const decisions = decideExitBandOrders([candidate({ returnRate: '3' })], {
      takeProfitPercent: 5,
      stopLossPercent: -1,
    });

    expect(decisions).toEqual([]);
  });
});

describe('describeExitBandReason', () => {
  it('사유 문구에 실제 손익률과 기준을 함께 남긴다', () => {
    const reason = describeExitBandReason(
      {
        tickerId: 1,
        tickerCode: '005930',
        quantity: '10',
        reason: 'STOP_LOSS',
        returnRatePercent: -6.35,
      },
      DEFAULT_EXIT_BAND,
    );

    expect(reason).toBe('손절 밴드 이탈: 평가 손익률 -6.35% (기준 -5% 이하)');
  });
});

describe('summarizeExitBandUsage', () => {
  it('매도에 박힌 설정을 중복 없이 좁은 밴드부터 모은다', () => {
    const summary = summarizeExitBandUsage([
      { takeProfitPercent: '10', stopLossPercent: '-5' },
      { takeProfitPercent: '2', stopLossPercent: '-0.2' },
      { takeProfitPercent: '10', stopLossPercent: '-5' },
    ]);

    expect(summary).toEqual({
      bands: ['+2/-0.2', '+10/-5'],
      bandlessSellCount: 0,
    });
  });

  // 모델이 고른 매도는 밴드가 만든 것이 아니다. 이 건수를 세지 않으면 밴드 설정 하나로
  // 닫힌 표본처럼 읽힌다.
  it('밴드가 만들지 않은 매도는 건수로 따로 센다', () => {
    const summary = summarizeExitBandUsage([
      { takeProfitPercent: null, stopLossPercent: null },
      { takeProfitPercent: '10', stopLossPercent: null },
      { takeProfitPercent: '10', stopLossPercent: '-5' },
    ]);

    expect(summary).toEqual({ bands: ['+10/-5'], bandlessSellCount: 2 });
  });

  // 익절이 같으면 손절로 갈린다. 손절은 음수라 오름차순으로 세우면 넓은 밴드가 앞에 온다.
  it('익절이 같으면 손절이 얕은 쪽이 먼저 온다', () => {
    const summary = summarizeExitBandUsage([
      { takeProfitPercent: '2', stopLossPercent: '-5' },
      { takeProfitPercent: '2', stopLossPercent: '-0.2' },
    ]);

    expect(summary.bands).toEqual(['+2/-0.2', '+2/-5']);
  });

  // 정렬을 문자열로 하면 '+10' 이 '+2' 앞에 온다. 라벨은 문자열이지만 순서는 값이다.
  it('두 자리 익절이 한 자리 뒤에 온다', () => {
    const summary = summarizeExitBandUsage([
      { takeProfitPercent: '10', stopLossPercent: '-5' },
      { takeProfitPercent: '3', stopLossPercent: '-3' },
    ]);

    expect(summary.bands).toEqual(['+3/-3', '+10/-5']);
  });
});

// 기업행동 다음 거래일에는 장부(수량·평단)만 옛 기준으로 남아 손익률이 크게 벌어진다.
// 그날은 전일 대비 변동이 정상이라 가격 점프 판정에 걸리지 않으므로, 두 청산 경로가
// 공유하는 이 파일에서 막는다.
describe('장부 불일치 하한', () => {
  it('종가 밴드는 손익률이 -50%를 넘게 벌어지면 청산하지 않는다', () => {
    expect(decideExitBandOrders([candidate({ returnRate: '-78.4' })])).toEqual(
      [],
    );
  });

  it('장중 손절도 같은 폭이면 청산하지 않는다', () => {
    expect(
      decideIntradayStopOrders([
        intradayStopCandidate({ returnRatePercent: -78.4 }),
      ]),
    ).toEqual([]);
  });

  // 주식병합이면 주가가 뛴 채 장부 수량만 남아 익절이 나간다. 아래쪽만 막으면 그 경로가
  // 그대로 열려 있다.
  it('위쪽으로 벌어진 폭도 익절하지 않는다', () => {
    expect(decideExitBandOrders([candidate({ returnRate: '900' })])).toEqual(
      [],
    );
  });

  // 하한을 넘지 않는 큰 손실은 정상적인 손절 대상이다. 여기까지 막으면 진짜 급락을
  // 못 자른다.
  it('하한 안쪽의 손실은 그대로 청산한다', () => {
    const decisions = decideExitBandOrders([
      candidate({ returnRate: '-49.9' }),
    ]);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].reason).toBe('STOP_LOSS');
  });
});

describe('resolveIntradayStopFillPrice', () => {
  // 시가가 손절선 위면 장중에 손절선을 지나며 팔린다. 운영이 5분마다 재다 그 값을 만나는
  // 지점이고, 실운영 씨젠 2026-08-31(시가 35,100 · 손절선 33,350)이 이 경우였다.
  it('시가가 손절선보다 높으면 손절선으로 체결한다', () => {
    expect(
      resolveIntradayStopFillPrice({
        open: 35_100,
        averagePrice: 35_105.26,
        stopLossPercent: -5,
      }),
    ).toBeCloseTo(33_350, 0);
  });

  // 갭하락은 발동일의 24.2% 다. 그날은 손절선 가격이 장중에 존재한 적이 없으므로 그 값으로
  // 체결하면 실제로 불가능한 매도를 성적에 넣게 된다.
  it('시가가 이미 손절선 아래면 손절선이 아니라 시가로 체결한다', () => {
    expect(
      resolveIntradayStopFillPrice({
        open: 9_000,
        averagePrice: 10_000,
        stopLossPercent: -5,
      }),
    ).toBe(9_000);
  });

  // 저가는 후보가 아니다 — 이 함수는 저가를 입력으로 받지도 않는다. 그날 최저점에 팔았다는
  // 가정이 성적을 평균 3.35% 비관적으로 만드는 것을 실측으로 확인해 뺐다.
  it('저가가 아무리 낮아도 체결가는 시가와 손절선만으로 정해진다', () => {
    expect(
      resolveIntradayStopFillPrice({
        open: 10_200,
        averagePrice: 10_000,
        stopLossPercent: -5,
      }),
    ).toBe(9_500);
  });
});
