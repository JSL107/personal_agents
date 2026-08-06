import { Inject, Injectable } from '@nestjs/common';

import {
  BROKER_HOLDINGS_PORT,
  BrokerHoldingsPort,
} from '../../../market-data/domain/port/broker-holdings.port';
import {
  detectHoldingChanges,
  HoldingChange,
  HoldingPosition,
} from '../domain/holding-change';
import { StockMonitorRepository } from '../infrastructure/stock-monitor.repository';

export interface SyncHoldingsResult {
  synced: number;
  zeroed: number;
  // 0 건도 그대로 담는다. 변화 없음이 결과에 나타나지 않으면 감지가 도는지 알 수 없다.
  changes: HoldingChange[];
}

@Injectable()
export class SyncHoldingsUsecase {
  constructor(
    @Inject(BROKER_HOLDINGS_PORT)
    private readonly brokerHoldings: BrokerHoldingsPort,
    private readonly repository: StockMonitorRepository,
  ) {}

  // 매매 판정은 이 안에서만 가능하다. 잔고는 같은 effectiveDate 행을 덮어쓰므로 동기화가
  // 끝나면 직전 값이 사라진다 — 나중에 밖에서 두 줄을 비교할 방법이 없다.
  async execute(): Promise<SyncHoldingsResult> {
    const holdings = await this.brokerHoldings.fetchHoldings();
    const currentHoldings = await this.repository.findCurrentBrokerHoldings();
    const effectiveDate = new Date();
    effectiveDate.setUTCHours(0, 0, 0, 0);

    const syncedTickerIds = new Set<number>();
    const positions: HoldingPosition[] = [];
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
      positions.push({
        tickerId,
        tickerName: holding.name,
        symbol: holding.symbol,
        quantity: holding.quantity,
        avgPrice: holding.averagePurchasePrice,
        currency: holding.currency,
      });
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

    // 스냅샷을 먼저 갱신하고 사건을 적재한다. 순서를 뒤집으면 중간 실패 때 스냅샷에 반영되지
    // 않은 매매가 사건으로 남아 이력이 사실과 어긋나고, 다음 실행이 같은 사건을 다시 적재한다.
    // 대신 적재 자체가 실패하면 그 실행분 사건은 복구되지 않는다 — 이 usecase 는 트랜잭션 없이
    // 종목별로 개별 커밋하는 구조라(호출부 withSyncWarning 주석 참조) 둘을 하나로 묶을 수 없다.
    // 그 경우 예외가 호출부로 올라가 "잔고 동기화 실패" 경고로 화면에 드러난다.
    const changes = detectHoldingChanges(currentHoldings, positions);
    await this.repository.recordHoldingChanges(
      changes.map((change) => ({
        tickerId: change.tickerId,
        kind: change.kind,
        previousQuantity: change.previousQuantity,
        quantity: change.quantity,
        previousAvgPrice: change.previousAvgPrice,
        avgPrice: change.avgPrice,
        currency: change.currency,
        effectiveDate,
      })),
    );

    return { synced: holdings.length, zeroed, changes };
  }
}
