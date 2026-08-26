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
      // ⚠️ SECURITY: $executeRawUnsafe 는 Prisma 의 SQL 인젝션 방어를 우회한다. 본 호출의 SQL 은
      //   변수 보간이 전혀 없는 hardcoded 상수 문자열이므로 안전. 향후 이 SQL 에 어떤 형태로든 사용자/
      //   런타임 값을 끼워 넣어야 한다면 반드시 Prisma.sql 태그 템플릿(`$executeRaw(Prisma.sql\`...\`)`)
      //   으로 전환해 parameterized query 로 만들 것. (V3 mid-progress audit B4 M-4)
      await this.$executeRawUnsafe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_run_output_fts
         ON agent_run USING GIN (to_tsvector('simple', COALESCE(output::text, '')))`,
      );
      // Episodic Memory — pgvector extension + HNSW 코사인 인덱스(멱등). spec 2026-06-18.
      // 운영 DB 가 pgvector 이미지가 아니면 CREATE EXTENSION 이 실패 → catch 로 swallow(메모리 기능만 비활성).
      await this.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
      await this.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS idx_episodic_memory_embedding
         ON episodic_memory USING hnsw (embedding vector_cosine_ops)`,
      );
      // StrategyParameter — (전략, 이름) 당 활성 행은 하나라는 불변식을 DB 가 지키게 한다.
      // Prisma 스키마는 부분 유니크 인덱스를 표현하지 못해 `@@unique([strategy, name, version])`
      // 까지만 걸리고, 그것으로는 v1 과 v2 가 동시에 활성인 상태를 막지 못한다. 값을 바꾸는
      // 경로(구 행 supersede + 신 행 activate)가 한 트랜잭션이 아니면 정확히 그 자리에서
      // 두 값이 동시에 활성이 되고, 읽는 쪽은 둘 중 하나를 골라 조용히 다른 값으로 돈다.
      await this.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_parameter_active
         ON strategy_parameter (strategy, name)
         WHERE activated_at IS NOT NULL AND superseded_at IS NULL`,
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
