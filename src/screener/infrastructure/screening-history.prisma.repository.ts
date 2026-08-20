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
  universeCount: number;
  evaluatedCount: number;
  staleCount: number;
  passedCount: number;
  items: ScreeningRunItemInput[];
}

export interface SavedScreeningRun {
  runId: number;
  recordedCount: number;
}

@Injectable()
export class ScreeningHistoryPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 같은 기준일을 다시 돌리면 항목까지 통째로 갈아 끼운다. 남겨 두면 상한을 줄여 다시
  // 돌린 회차에 옛 항목이 섞여, 그날 무엇을 보여줬는지가 실제와 달라진다.
  async saveScreeningRun(
    input: SaveScreeningRunInput,
  ): Promise<SavedScreeningRun> {
    const header = {
      ruleVersion: input.ruleVersion,
      universeCount: input.universeCount,
      evaluatedCount: input.evaluatedCount,
      staleCount: input.staleCount,
      passedCount: input.passedCount,
    };
    return await this.prisma.$transaction(async (transaction) => {
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
      return { runId: run.id, recordedCount: input.items.length };
    });
  }
}
