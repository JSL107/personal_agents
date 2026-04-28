import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
      // PM-3': agent_run.output 텍스트에 GIN 인덱스 생성 (tsvector 변환 후 FTS 쿼리 가속).
      // CONCURRENTLY 는 트랜잭션 밖에서만 가능. IF NOT EXISTS 로 멱등성 보장.
      await this.$executeRawUnsafe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_run_output_fts
         ON agent_run USING GIN (to_tsvector('simple', COALESCE(output::text, '')))`,
      );
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
