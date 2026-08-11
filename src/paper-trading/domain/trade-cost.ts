import { MoneyValue } from '../../market-data/domain/market-data.type';
import { PaperMarket, TradeCost, TradeCostInput } from './paper-account.type';

interface CostSchedule {
  effectiveFrom: string;
  brokerageFeeRate: string;
  transactionTaxRate: Record<PaperMarket, string>;
}

// 토스증권 국내주식 위탁수수료 0.015%는 공식 고지로 확정하지 못한 기본값이다.
// 확정된 값이 달라지면 이 상수만 바꾼다.
const TOSS_BROKERAGE_FEE_RATE = '0.00015';
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
