import { DecimalValue } from '../../../market-data/domain/market-data.type';
import { DEFAULT_HORIZON_DAYS, scoreAlert } from './alert-outcome';

const decimal = (value: number): DecimalValue => ({
  toNumber: () => value,
  toString: () => value.toString(),
});

describe('scoreAlert', () => {
  it('기본 horizon은 5거래일이다', () => {
    expect(DEFAULT_HORIZON_DAYS).toBe(5);
  });

  it('발화가보다 horizon가가 10% 높으면 +10%를 반환한다', () => {
    expect(scoreAlert(decimal(100), decimal(110))).toEqual({ returnPct: 10 });
  });

  it('발화가보다 horizon가가 10% 낮으면 -10%를 반환한다', () => {
    expect(scoreAlert(decimal(100), decimal(90))).toEqual({ returnPct: -10 });
  });

  it('발화가와 horizon가가 같으면 0%를 반환한다', () => {
    expect(scoreAlert(decimal(100), decimal(100))).toEqual({ returnPct: 0 });
  });

  it('발화가가 0이면 분모가 0이므로 null을 반환한다', () => {
    expect(scoreAlert(decimal(0), decimal(100))).toBeNull();
  });
});
