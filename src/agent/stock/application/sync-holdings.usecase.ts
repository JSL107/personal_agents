import { Inject, Injectable } from '@nestjs/common';

import {
  BROKER_HOLDINGS_PORT,
  BrokerHoldingsPort,
} from '../../../market-data/domain/port/broker-holdings.port';
import { StockMonitorRepository } from '../infrastructure/stock-monitor.repository';

export interface SyncHoldingsResult {
  synced: number;
  zeroed: number;
}

@Injectable()
export class SyncHoldingsUsecase {
  constructor(
    @Inject(BROKER_HOLDINGS_PORT)
    private readonly brokerHoldings: BrokerHoldingsPort,
    private readonly repository: StockMonitorRepository,
  ) {}

  async execute(): Promise<SyncHoldingsResult> {
    const holdings = await this.brokerHoldings.fetchHoldings();
    const currentHoldings = await this.repository.findCurrentBrokerHoldings();
    const effectiveDate = new Date();
    effectiveDate.setUTCHours(0, 0, 0, 0);

    const syncedTickerIds = new Set<number>();
    for (const holding of holdings) {
      const tickerId = await this.repository.upsertTickerFromBroker({
        code: holding.symbol,
        market: holding.marketCountry,
        marketCountry: holding.marketCountry,
        tossSymbol: holding.symbol,
        name: holding.name,
        currency: holding.currency,
      });
      syncedTickerIds.add(tickerId);
      await this.repository.upsertHolding({
        tickerId,
        effectiveDate,
        quantity: holding.quantity.toString(),
        avgPrice: holding.averagePurchasePrice.toString(),
        currency: holding.currency,
      });
    }

    let zeroed = 0;
    for (const currentHolding of currentHoldings) {
      if (syncedTickerIds.has(currentHolding.tickerId)) {
        continue;
      }
      await this.repository.upsertHolding({
        tickerId: currentHolding.tickerId,
        effectiveDate,
        quantity: '0',
        avgPrice: currentHolding.avgPrice.toString(),
        currency: currentHolding.currency,
      });
      zeroed += 1;
    }

    return { synced: holdings.length, zeroed };
  }
}
