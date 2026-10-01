import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { ensureManualIndexes } from './ensure-manual-indexes';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    // $connect / GIN 인덱스 생성 모두 best-effort — Postgres 일시 장애가 앱 boot 를 막지 않게 한다 (codex P2).
    // Prisma 는 lazy connect 가 기본이라 첫 query 시점에 자동 연결되므로 onModuleInit 이 실패해도 query 는 동작.
    try {
      await this.$connect();
      // 스키마로 표현 못 하는 수동 인덱스를 멱등 재생성한다. 목록과 각 인덱스의 이유는
      // manual-index.sql.ts — `pnpm db:push` 직후 단계도 같은 함수를 쓴다.
      const outcomes = await ensureManualIndexes(this);
      for (const outcome of outcomes) {
        if (outcome.state === 'failed') {
          this.logger.warn(
            `수동 인덱스 준비 실패 — ${outcome.name}: ${outcome.reason}`,
          );
        }
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Prisma 부팅 setup 일부 실패 (lazy 재연결 후 query 시 정상 동작): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
