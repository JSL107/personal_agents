import { mapTossHoldingsResponse } from './toss-holdings.mapper';

const KOREAN_HOLDING = {
  symbol: '005930',
  name: '삼성전자',
  marketCountry: 'KR',
  currency: 'KRW',
  quantity: '100',
  lastPrice: '72000',
  averagePurchasePrice: '65000',
  marketValue: {
    purchaseAmount: '6500000',
    amount: '7200000',
    amountAfterCost: '7050000',
  },
  profitLoss: { amount: '700000', rate: '0.1077' },
  dailyProfitLoss: { amount: '100000', rate: '0.0141' },
  cost: { commission: '14400', tax: '135600' },
};

describe('mapTossHoldingsResponse', () => {
  it('정상 응답을 보유 종목으로 변환한다', () => {
    const result = mapTossHoldingsResponse({
      result: { items: [KOREAN_HOLDING] },
    });

    expect(result).toHaveLength(1);
    expect(result?.[0]).toMatchObject({
      symbol: '005930',
      name: '삼성전자',
      marketCountry: 'KR',
      currency: 'KRW',
    });
    expect(result?.[0].quantity.toString()).toBe('100');
    expect(result?.[0].lastPrice.toString()).toBe('72000');
    expect(result?.[0].averagePurchasePrice.toString()).toBe('65000');
  });

  it('필수 필드가 누락된 항목이 있으면 null 을 반환한다', () => {
    const { averagePurchasePrice, ...holdingWithoutAveragePrice } =
      KOREAN_HOLDING;

    const result = mapTossHoldingsResponse({
      result: { items: [holdingWithoutAveragePrice] },
    });

    expect(averagePurchasePrice).toBe('65000');
    expect(result).toBeNull();
  });

  it('유한한 Decimal이 아닌 수치 문자열이 있으면 null 을 반환한다', () => {
    const result = mapTossHoldingsResponse({
      result: {
        items: [{ ...KOREAN_HOLDING, quantity: 'Infinity' }],
      },
    });

    expect(result).toBeNull();
  });

  it('items 가 비어 있으면 빈 배열을 반환한다', () => {
    const result = mapTossHoldingsResponse({ result: { items: [] } });

    expect(result).toEqual([]);
  });

  it('응답이 객체가 아니면 null 을 반환한다', () => {
    expect(mapTossHoldingsResponse('invalid')).toBeNull();
  });

  it('미국 종목의 시장과 통화를 그대로 변환한다', () => {
    const result = mapTossHoldingsResponse({
      result: {
        items: [
          {
            ...KOREAN_HOLDING,
            symbol: 'AAPL',
            name: 'Apple',
            marketCountry: 'US',
            currency: 'USD',
            quantity: '1.25',
            lastPrice: '225.31',
            averagePurchasePrice: '190.125',
          },
        ],
      },
    });

    expect(result?.[0]).toMatchObject({
      symbol: 'AAPL',
      name: 'Apple',
      marketCountry: 'US',
      currency: 'USD',
    });
    expect(result?.[0].quantity.toString()).toBe('1.25');
    expect(result?.[0].lastPrice.toString()).toBe('225.31');
    expect(result?.[0].averagePurchasePrice.toString()).toBe('190.125');
  });
});
