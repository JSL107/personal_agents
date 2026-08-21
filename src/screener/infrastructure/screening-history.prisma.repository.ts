import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const ITEM_WRITE_CHUNK_SIZE = 200;

export interface ScreeningRunItemInput {
  tickerId: number;
  rank: number;
  score: number;
  // 레포 관례상 Json 컬럼 입력은 unknown 으로 받고 저장 직전에 좁힌다
  // (paper_order.indicatorSnapshot 과 같은 형태).
  indicatorSnapshot: unknown;
}

export interface SaveScreeningRunInput {
  strategy: string;
  asOf: Date;
  ruleVersion: number;
  // 이 회차를 만든 추천 실행. CLI 로 사람이 확인차 돌린 회차는 null 이다.
  agentRunId: number | null;
  universeCount: number;
  evaluatedCount: number;
  staleCount: number;
  passedCount: number;
  items: ScreeningRunItemInput[];
}

export type SaveScreeningRunOutcome =
  | { saved: true; runId: number; recordedCount: number }
  // 운영 회차가 이미 있어 남기지 않은 경우. 조용히 성공으로 돌리면 호출자가
  // "남았다" 로 오해하므로 이유와 기존 회차를 함께 돌려준다.
  | { saved: false; reason: 'OPERATIONAL_RUN_EXISTS'; runId: number };

export interface UnscoredScreeningItem {
  itemId: number;
  tickerId: number;
}

export interface UnscoredScreeningRun {
  runId: number;
  strategy: string;
  asOf: Date;
  items: UnscoredScreeningItem[];
}

export interface ScreeningOutcomeBarRow {
  tickerId: number;
  tradeDate: Date;
  open: Prisma.Decimal | null;
  close: Prisma.Decimal;
}

export interface SaveScreeningItemOutcomeInput {
  itemId: number;
  horizonDays: number;
  entryTradeDate: Date;
  entryPrice: string;
  horizonTradeDate: Date;
  horizonPrice: string;
  returnPct: string;
}

// 조회 상한을 달력으로 두지 않는다. 지평은 저장된 봉의 수로 세는데 달력으로 자르면
// 스크리닝 직후 오래 거래정지됐다 재개된 종목이 봉을 다 채우고도 잘려 나가, 영영
// 미도래로 남는다. 미채점 회차만 조회하므로 범위를 열어 두어도 회차당 종목 수만큼이다.

@Injectable()
export class ScreeningHistoryPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 같은 기준일을 다시 돌리면 항목까지 통째로 갈아 끼운다. 남겨 두면 상한을 줄여 다시
  // 돌린 회차에 옛 항목이 섞여, 그날 무엇을 보여줬는지가 실제와 달라진다.
  async saveScreeningRun(
    input: SaveScreeningRunInput,
  ): Promise<SaveScreeningRunOutcome> {
    const header = {
      ruleVersion: input.ruleVersion,
      agentRunId: input.agentRunId,
      universeCount: input.universeCount,
      evaluatedCount: input.evaluatedCount,
      staleCount: input.staleCount,
      passedCount: input.passedCount,
    };
    return await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.screeningRun.findUnique({
        where: {
          strategy_asOf: { strategy: input.strategy, asOf: input.asOf },
        },
        select: { id: true, agentRunId: true },
      });
      // 운영 회차는 확인차 돌린 CLI 실행에 자리를 내주지 않는다. 상한이 다른 실행이
      // 항목을 갈아버리면 그날 모델에게 무엇을 보여줬는지가 비가역적으로 사라진다.
      // 운영이 운영을 덮어쓰는 것은 허용 — 같은 기준일 재실행은 정본 갱신이다.
      if (
        existing !== null &&
        existing.agentRunId !== null &&
        input.agentRunId === null
      ) {
        return {
          saved: false as const,
          reason: 'OPERATIONAL_RUN_EXISTS' as const,
          runId: existing.id,
        };
      }
      const run = await transaction.screeningRun.upsert({
        where: {
          strategy_asOf: { strategy: input.strategy, asOf: input.asOf },
        },
        create: { strategy: input.strategy, asOf: input.asOf, ...header },
        update: header,
        select: { id: true },
      });
      await transaction.screeningRunItem.deleteMany({
        where: { runId: run.id },
      });
      for (
        let offset = 0;
        offset < input.items.length;
        offset += ITEM_WRITE_CHUNK_SIZE
      ) {
        await transaction.screeningRunItem.createMany({
          data: input.items
            .slice(offset, offset + ITEM_WRITE_CHUNK_SIZE)
            .map((item) => ({
              runId: run.id,
              tickerId: item.tickerId,
              rank: item.rank,
              score: item.score,
              indicatorSnapshot:
                item.indicatorSnapshot as Prisma.InputJsonValue,
            })),
        });
      }
      return {
        saved: true as const,
        runId: run.id,
        recordedCount: input.items.length,
      };
    });
  }

  // 아직 그 지평으로 재지 않은 항목을 회차 단위로 묶어 낸다. 같은 회차는 기준일이 같아
  // 봉 조회를 한 번으로 묶을 수 있다.
  //
  // 실행이 성공한 회차만 대상이다. 회차는 모델 호출보다 먼저 확정되므로, 쿼터 소진처럼
  // 추천이 실패한 날은 회차만 남고 주문이 없다 — 그대로 채점하면 실린 종목 전부가
  // "보고도 안 샀다" 로 집계돼 대조군이 오염된다. CLI 로 확인차 돌린 회차(agentRunId 없음)도
  // 같은 이유로 제외된다.
  async findUnscoredRuns(horizonDays: number): Promise<UnscoredScreeningRun[]> {
    const items = await this.prisma.screeningRunItem.findMany({
      where: {
        outcomes: { none: { horizonDays } },
        run: { agentRun: { status: 'SUCCEEDED' } },
      },
      select: {
        id: true,
        tickerId: true,
        run: { select: { id: true, strategy: true, asOf: true } },
      },
      orderBy: [{ runId: 'asc' }, { rank: 'asc' }],
    });

    const runsById = new Map<number, UnscoredScreeningRun>();
    for (const item of items) {
      const found = runsById.get(item.run.id) ?? {
        runId: item.run.id,
        strategy: item.run.strategy,
        asOf: item.run.asOf,
        items: [],
      };
      found.items.push({ itemId: item.id, tickerId: item.tickerId });
      runsById.set(item.run.id, found);
    }
    return [...runsById.values()];
  }

  async findBarsAfter(
    tickerIds: number[],
    asOf: Date,
  ): Promise<ScreeningOutcomeBarRow[]> {
    if (tickerIds.length === 0) {
      return [];
    }
    return await this.prisma.dailyPrice.findMany({
      where: {
        tickerId: { in: tickerIds },
        tradeDate: { gt: asOf },
      },
      select: {
        tickerId: true,
        tradeDate: true,
        open: true,
        close: true,
      },
      orderBy: [{ tradeDate: 'asc' }, { id: 'asc' }],
    });
  }

  // 같은 (항목, 지평) 을 두 번 저장해도 안전하도록 upsert 로 둔다 — 한 회차 안에서
  // 재실행되거나 저장이 중간에 끊긴 경우를 위한 방어다.
  //
  // ⚠️ **이 update 분기는 평상시 채점 경로에서는 실행되지 않는다.** 채점 대상을
  // `outcomes: { none: { horizonDays } }` 로 뽑기 때문에 이미 저장된 항목은 다시 오지
  // 않는다. 즉 시세가 뒤늦게 보정돼도 저장된 성적은 그대로다. 소급 재채점이 필요해지면
  // 대상 조회부터 바꿔야 한다(가격 갱신 시각 비교 등) — 지금은 지원하지 않는다.
  async saveScreeningItemOutcomes(
    rows: SaveScreeningItemOutcomeInput[],
  ): Promise<number> {
    for (const row of rows) {
      await this.prisma.screeningItemOutcome.upsert({
        where: {
          itemId_horizonDays: {
            itemId: row.itemId,
            horizonDays: row.horizonDays,
          },
        },
        create: row,
        update: {
          entryTradeDate: row.entryTradeDate,
          entryPrice: row.entryPrice,
          horizonTradeDate: row.horizonTradeDate,
          horizonPrice: row.horizonPrice,
          returnPct: row.returnPct,
          evaluatedAt: new Date(),
        },
      });
    }
    return rows.length;
  }
}
