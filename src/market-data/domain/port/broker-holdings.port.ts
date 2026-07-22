import { BrokerHolding } from '../broker-holdings.type';

export const BROKER_HOLDINGS_PORT = Symbol('BROKER_HOLDINGS_PORT');

export interface BrokerHoldingsPort {
  fetchHoldings(): Promise<BrokerHolding[]>;
}
