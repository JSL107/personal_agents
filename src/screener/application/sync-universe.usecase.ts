import { Injectable, Logger } from '@nestjs/common';

import { KrxDelistingClient } from '../../market-data/infrastructure/krx/krx-delisting.client';
import { KrxListingClient } from '../../market-data/infrastructure/krx/krx-listing.client';
import { MarketDataPrismaRepository } from '../../market-data/infrastructure/market-data.prisma.repository';

export interface DelistingHistoryApplied {
  applied: number;
}

export interface DelistingHistoryFailureAudit {
  error: string;
}

export interface SyncUniverseResult {
  fetched: number;
  upserted: number;
  delisted: number;
  // 성공 0건과 실패를 같은 숫자로 뭉개지 않는다. KIND 가 계속 실패해도 `applied: 0` 으로만
  // 보이면 사유가 비어 가는 것을 아무도 눈치채지 못한다.
  delistingHistory: DelistingHistoryApplied | DelistingHistoryFailureAudit;
}

@Injectable()
export class SyncUniverseUsecase {
  private readonly logger = new Logger(SyncUniverseUsecase.name);

  constructor(
    private readonly krxListingClient: KrxListingClient,
    private readonly krxDelistingClient: KrxDelistingClient,
    private readonly repository: MarketDataPrismaRepository,
  ) {}

  async execute(): Promise<SyncUniverseResult> {
    const listings = await this.krxListingClient.fetchListings();
    const upserted = await this.repository.upsertUniverseTickers(listings);
    const asOf = new Date();
    asOf.setUTCHours(0, 0, 0, 0);
    const delisted = await this.repository.markDelistedExcept(
      listings.map((listing) => listing.code),
      asOf,
    );
    if (delisted < 0) {
      throw new Error(
        `유니버스 상장폐지 안전 하한 발동 — 활성 종목 ${listings.length}건`,
      );
    }

    return {
      fetched: listings.length,
      upserted,
      delisted,
      delistingHistory: await this.applyDelistingHistory(),
    };
  }

  // 폐지 사유는 청산가를 정하는 유일한 근거이고, 위 마킹이 찍는 날짜는 실제 폐지일이 아니라
  // 이 동기화가 돈 날이다. 둘 다 KIND 상장폐지 현황으로 교정한다.
  // 실패해도 흐름을 끊지 않는다 — 사유가 비는 것은 다음 회차가 메우지만, 유니버스 갱신이
  // 멈추면 그날의 스크리닝이 통째로 죽는다. 대신 실패를 결과에 남겨 원장에서 보이게 한다.
  private async applyDelistingHistory(): Promise<
    DelistingHistoryApplied | DelistingHistoryFailureAudit
  > {
    try {
      const delistings = await this.krxDelistingClient.fetchDelistings();
      const applied = await this.repository.applyDelistingHistory(delistings);
      return { applied };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `상장폐지 이력 반영 실패 — 유니버스 갱신은 유지한다: ${message}`,
      );
      return { error: message };
    }
  }
}
