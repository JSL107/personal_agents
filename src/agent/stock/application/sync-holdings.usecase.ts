import { Inject, Injectable } from '@nestjs/common';

import {
  BROKER_HOLDINGS_PORT,
  BrokerHoldingsPort,
} from '../../../market-data/domain/port/broker-holdings.port';
import {
  buildHoldingChangeFingerprint,
  detectHoldingChanges,
  HoldingChange,
  HoldingPosition,
} from '../domain/holding-change';
import { StockMonitorPrismaRepository } from '../infrastructure/stock-monitor.prisma.repository';

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
    private readonly repository: StockMonitorPrismaRepository,
  ) {}

  // 매매 판정은 이 안에서만 가능하다. 잔고는 같은 effectiveDate 행을 덮어쓰므로 동기화가
  // 끝나면 직전 값이 사라진다 — 나중에 밖에서 두 줄을 비교할 방법이 없다.
  async execute(): Promise<SyncHoldingsResult> {
    const holdings = await this.brokerHoldings.fetchHoldings();
    const currentHoldings = await this.repository.findCurrentBrokerHoldings();
    const effectiveDate = new Date();
    effectiveDate.setUTCHours(0, 0, 0, 0);

    // 종목 등록만 먼저 한다. 사건도 스냅샷도 tickerId 를 참조하므로 이건 어느 쪽보다 앞이어야 한다.
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
      positions.push({
        tickerId,
        tickerName: holding.name,
        symbol: holding.symbol,
        quantity: holding.quantity,
        avgPrice: holding.averagePurchasePrice,
        currency: holding.currency,
      });
    }

    // 사건을 스냅샷 갱신보다 **먼저** 적재한다.
    //
    // 이 usecase 는 트랜잭션 없이 종목별로 개별 커밋한다(호출부 withSyncWarning 주석 참조).
    // 스냅샷을 먼저 갱신하면 그 뒤 적재가 실패했을 때 사건이 영구히 사라진다 — 스냅샷은 이미
    // 새 잔고라서 재실행이 "변화 없음"으로 판정하기 때문이다. 경고가 화면에 떠도 유실된 사건은
    // 돌아오지 않는다.
    //
    // 순서를 뒤집으면 스냅샷 갱신이 중간에 실패해도 사건은 이미 남아 있고, 재실행은 아직 갱신되지
    // 않은 종목의 같은 변화를 다시 계산해 스냅샷을 따라잡는다. 그때 사건이 두 번 쌓이지 않는 것은
    // fingerprint 유니크가 보장한다(그 지문이 없으면 이 순서는 중복을 부른다).
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
        fingerprint: buildHoldingChangeFingerprint({ change, effectiveDate }),
      })),
    );

    const syncedTickerIds = new Set<number>();
    for (const position of positions) {
      syncedTickerIds.add(position.tickerId);
      await this.repository.upsertHolding({
        tickerId: position.tickerId,
        effectiveDate,
        quantity: position.quantity.toString(),
        avgPrice: position.avgPrice.toString(),
        currency: position.currency,
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

    return { synced: holdings.length, zeroed, changes };
  }
}
