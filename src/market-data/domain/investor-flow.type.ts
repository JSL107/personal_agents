export interface InvestorFlowRow {
  tradeDate: Date;
  foreignNetBuy: bigint;
  institutionNetBuy: bigint;
  flowVolume: bigint;
}

export interface InvestorFlowPriceTarget {
  tickerId: number;
  oldestTradeDate: string;
  hasFlow: boolean;
}
