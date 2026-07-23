import { DecimalValue } from './market-data.type';

export interface BrokerHolding {
  symbol: string;
  name: string;
  marketCountry: string;
  currency: string;
  quantity: DecimalValue;
  averagePurchasePrice: DecimalValue;
  lastPrice: DecimalValue;
}
