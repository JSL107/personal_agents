import {
  decideExitBandOrders,
  DEFAULT_EXIT_BAND,
  describeExitBandReason,
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

describe('decideExitBandOrders', () => {
  it('익절 기준 이상이면 TAKE_PROFIT 으로 정리한다', () => {
    const decisions = decideExitBandOrders([candidate({ returnRate: '2' })]);

    expect(decisions).toEqual([
      {
        tickerId: 1,
        tickerCode: '005930',
        quantity: '10',
        reason: 'TAKE_PROFIT',
        returnRatePercent: 2,
      },
    ]);
  });

  it('손절 기준 이하면 STOP_LOSS 로 정리한다', () => {
    const decisions = decideExitBandOrders([candidate({ returnRate: '-0.2' })]);

    expect(decisions[0].reason).toBe('STOP_LOSS');
  });

  // 경계값은 양쪽 다 포함이다. 여기가 배타로 바뀌면 정확히 기준선에 붙은 종목이
  // 매일 판정만 받고 영원히 안 팔린다.
  it('밴드 안(-0.19% ~ 1.99%)이면 아무 주문도 만들지 않는다', () => {
    const decisions = decideExitBandOrders([
      candidate({ returnRate: '1.99' }),
      candidate({ tickerId: 2, returnRate: '-0.19' }),
      candidate({ tickerId: 3, returnRate: '0' }),
    ]);

    expect(decisions).toEqual([]);
  });

  it('시세가 낡은 종목은 밴드를 넘겨도 판정에서 뺀다', () => {
    const decisions = decideExitBandOrders([
      candidate({ returnRate: '-5', isStale: true }),
    ]);

    expect(decisions).toEqual([]);
  });

  it('수량이 없거나 손익률이 숫자가 아니면 건너뛴다', () => {
    const decisions = decideExitBandOrders([
      candidate({ quantity: '0', returnRate: '9' }),
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
        returnRatePercent: -0.35,
      },
      DEFAULT_EXIT_BAND,
    );

    expect(reason).toBe('손절 밴드 이탈: 평가 손익률 -0.35% (기준 -0.2% 이하)');
  });
});
