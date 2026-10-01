// Prisma 스키마 문법으로 표현할 수 없어 손으로 만드는 인덱스. `prisma db push` 는 스키마에 없는
// 이 인덱스들을 drift 로 보고 지울 수 있으므로 두 곳이 같은 목록으로 되살린다 —
// 앱 부팅(`PrismaService.onModuleInit`)과 push 직후(`scripts/restore-manual-indexes.ts`)가
// 둘 다 `ensure-manual-indexes.ts` 를 거친다.
// 목록을 한 곳에 두는 이유는 한쪽만 고치면 다른 쪽이 옛 인덱스를 되살리기 때문이다.
//
// ⚠️ SECURITY: `$executeRawUnsafe` 로 실행된다. 변수 보간이 전혀 없는 상수 문자열이라 안전하다.
//   런타임 값을 끼워 넣어야 한다면 Prisma.sql 태그 템플릿으로 바꿀 것. (V3 mid-progress audit B4 M-4)

export interface ManualIndexStatement {
  // 되살렸는지 대조할 인덱스 이름. 확장(extension) 생성처럼 인덱스가 아닌 구문은 null.
  indexName: string | null;
  sql: string;
}

export const MANUAL_INDEX_STATEMENTS: readonly ManualIndexStatement[] = [
  // PM-3': agent_run.output 텍스트에 GIN 인덱스 (tsvector 변환 후 FTS 쿼리 가속).
  // CONCURRENTLY 는 트랜잭션 밖에서만 가능. IF NOT EXISTS 로 멱등성 보장.
  {
    indexName: 'idx_agent_run_output_fts',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_run_output_fts
         ON agent_run USING GIN (to_tsvector('simple', COALESCE(output::text, '')))`,
  },
  // Episodic Memory — pgvector extension + HNSW 코사인 인덱스(멱등). spec 2026-06-18.
  // 운영 DB 가 pgvector 이미지가 아니면 CREATE EXTENSION 이 실패한다 — 구문마다 따로 실패를 받으므로
  // 메모리 기능만 비활성되고 아래 전략 파라미터 인덱스는 그대로 만들어진다.
  { indexName: null, sql: `CREATE EXTENSION IF NOT EXISTS vector` },
  {
    indexName: 'idx_episodic_memory_embedding',
    sql: `CREATE INDEX IF NOT EXISTS idx_episodic_memory_embedding
         ON episodic_memory USING hnsw (embedding vector_cosine_ops)`,
  },
  // StrategyParameter — (전략, 이름) 당 활성 행은 하나라는 불변식을 DB 가 지키게 한다.
  // Prisma 스키마는 부분 유니크 인덱스를 표현하지 못해 `@@unique([strategy, name, version])`
  // 까지만 걸리고, 그것으로는 v1 과 v2 가 동시에 활성인 상태를 막지 못한다. 값을 바꾸는
  // 경로(구 행 supersede + 신 행 activate)가 한 트랜잭션이 아니면 정확히 그 자리에서
  // 두 값이 동시에 활성이 되고, 읽는 쪽은 둘 중 하나를 골라 조용히 다른 값으로 돈다.
  {
    indexName: 'idx_strategy_parameter_active',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_parameter_active
         ON strategy_parameter (strategy, name)
         WHERE activated_at IS NOT NULL AND superseded_at IS NULL`,
  },
];
