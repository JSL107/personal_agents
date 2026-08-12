import { MoneyValue } from '../../market-data/domain/market-data.type';
import { PaperMarket, TradeCost, TradeCostInput } from './paper-account.type';

interface CostSchedule {
  effectiveFrom: string;
  brokerageFeeRate: string;
  transactionTaxRate: Record<PaperMarket, string>;
}

// 검색으로 확인된 토스 국내주식 위탁수수료는 KRX 0.015%, NXT 0.014%다.
// 현재는 거래소 구분 축이 없으므로 KRX 기준 단일 요율을 사용한다.
const TOSS_BROKERAGE_FEE_RATE = '0.00015';
// 유관기관 제비용 0.0036396%를 별도로 더하는지는 토스 공식 고지로 확인하지 못했다.
// 업계는 별도 부과가 일반적이지만 토스가 위탁수수료에 통합 표기했을 가능성도 있다.
// 통합 요율로 확인되면 이 값을 '0'으로 두고, 거래소 구분이 필요해지면 요율표에 축을 추가한다.
const AGENCY_FEE_RATE = '0.000036396';

const COST_SCHEDULES: CostSchedule[] = [
  {
    effectiveFrom: '1900-01-01',
    brokerageFeeRate: TOSS_BROKERAGE_FEE_RATE,
    transactionTaxRate: {
      // 2025-12-28까지 KOSPI는 농어촌특별세 0.15%, KOSDAQ은 거래세 0.15%다.
      KOSPI: '0.0015',
      KOSDAQ: '0.0015',
      KONEX: '0.001',
    },
  },
  {
    effectiveFrom: '2025-12-29',
    brokerageFeeRate: TOSS_BROKERAGE_FEE_RATE,
    transactionTaxRate: {
      // 총율은 같지만 KOSPI는 거래세 0.05% + 농특세 0.15%,
      // KOSDAQ은 농특세 없이 거래세 0.20%다.
      KOSPI: '0.002',
      KOSDAQ: '0.002',
      KONEX: '0.001',
    },
  },
];

const findCostSchedule = (tradeDate: Date): CostSchedule => {
  for (let index = COST_SCHEDULES.length - 1; index >= 0; index -= 1) {
    const schedule = COST_SCHEDULES[index];
    const effectiveTime = new Date(
      `${schedule.effectiveFrom}T00:00:00+09:00`,
    ).getTime();
    if (tradeDate.getTime() >= effectiveTime) {
      return schedule;
    }
  }
  return COST_SCHEDULES[0];
};

const floorWon = (value: MoneyValue): string => {
  if (value.comparedTo(1) < 0) {
    return '0';
  }
  const [wholeWon] = value.toString().split('.');
  return wholeWon;
};

export const calculateTradeCost = ({
  market,
  side,
  grossAmount,
  tradeDate,
}: TradeCostInput): TradeCost => {
  const schedule = findCostSchedule(tradeDate);
  const brokerageFee = grossAmount.times(schedule.brokerageFeeRate);
  const agencyFee = grossAmount.times(AGENCY_FEE_RATE);
  const fee = floorWon(brokerageFee.plus(agencyFee));
  const tax =
    side === 'SELL'
      ? floorWon(grossAmount.times(schedule.transactionTaxRate[market]))
      : '0';

  return { fee, tax };
};
