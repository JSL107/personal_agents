import { MoneyValue } from '../../market-data/domain/market-data.type';

// 배당소득세 원천징수율 15.4% (소득세 14% + 지방소득세 1.4%). 증권사가 지급 시 떼고 넣는다.
// 공모리츠 분리과세 특례(9.9%)는 투자자가 따로 신청해야 적용되므로 기본값에 넣지 않는다.
export const DIVIDEND_WITHHOLDING_TAX_RATE = '0.154';

export interface DividendAmounts {
  gross: MoneyValue;
  tax: MoneyValue;
  net: MoneyValue;
}

// 원천징수는 원 단위 미만을 버린다. 금액은 국내 주식 배당의 일반적인 원 단위 범위에서
// 계산되므로, 도메인 계층이 Prisma에 의존하지 않도록 MoneyValue의 숫자 변환만 사용한다.
const floorWon = (value: MoneyValue): MoneyValue => {
  const wholeWon = value.toString().split('.')[0];
  return value.minus(value.minus(wholeWon));
};

export const calculateDividendAmounts = (input: {
  perShareAmount: MoneyValue;
  eligibleQuantity: MoneyValue;
}): DividendAmounts => {
  const gross = input.perShareAmount.times(input.eligibleQuantity);
  const tax = floorWon(gross.times(DIVIDEND_WITHHOLDING_TAX_RATE));

  return { gross, tax, net: gross.minus(tax) };
};
