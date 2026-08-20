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
}
