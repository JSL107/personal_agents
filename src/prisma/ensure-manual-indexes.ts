import { MANUAL_INDEX_STATEMENTS } from './manual-index.sql';

// PrismaClient·PrismaService 둘 다 받기 위한 최소 표면. 스크립트는 AppModule 없이 PrismaClient 를 쓴다.
export interface RawSqlExecutor {
  $executeRawUnsafe(sql: string): Promise<unknown>;
  $queryRawUnsafe<T = unknown>(sql: string): Promise<T>;
}

export type ManualIndexState = 'kept' | 'created' | 'rebuilt' | 'failed';

export interface ManualIndexOutcome {
  // 확장 생성처럼 인덱스가 아닌 구문은 SQL 첫 줄을 이름 대신 쓴다.
  name: string;
  state: ManualIndexState;
  reason?: string;
}

const MANUAL_INDEX_NAMES = new Set(
  MANUAL_INDEX_STATEMENTS.flatMap(({ indexName }) => {
    return indexName ? [indexName] : [];
  }),
);

interface IndexValidityRow {
  indexname: string;
  valid: boolean;
}

// 인덱스 이름별 사용 가능 여부. 목록에 없으면 존재하지 않는 것이다.
// pg_indexes 만 보면 안 되는 이유 — CREATE INDEX CONCURRENTLY 가 중간에 실패하면 이름은 남고
// indisvalid=false 인 인덱스가 생긴다. 그러면 IF NOT EXISTS 가 생성을 건너뛰고, 이름 검사도
// 통과해 "유지" 로 보이지만 PostgreSQL 은 그 인덱스를 쿼리에 쓰지 않는다.
const readIndexValidity = async (
  executor: RawSqlExecutor,
): Promise<Map<string, boolean>> => {
  const rows = await executor.$queryRawUnsafe<IndexValidityRow[]>(
    `SELECT c.relname AS indexname, i.indisvalid AS valid
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'`,
  );
  return new Map(rows.map((row) => [row.indexname, row.valid]));
};

const toReason = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

// 수동 인덱스를 멱등하게 맞춘다 — 없으면 만들고, 쓸 수 없는(invalid) 것은 지우고 다시 만든다.
// 구문마다 따로 실패를 받는다. 한 try 로 묶으면 pgvector 가 없는 DB 에서 확장 생성 실패가
// 뒤의 부분 유니크 인덱스(전략 파라미터 단일 활성 불변식)까지 막는다.
export const ensureManualIndexes = async (
  executor: RawSqlExecutor,
): Promise<ManualIndexOutcome[]> => {
  const before = await readIndexValidity(executor);
  const outcomes: ManualIndexOutcome[] = [];

  for (const { indexName, sql } of MANUAL_INDEX_STATEMENTS) {
    const name = indexName ?? sql.split('\n')[0].trim();
    const rebuild = indexName !== null && before.get(indexName) === false;
    try {
      if (rebuild) {
        // ⚠️ SECURITY: indexName 은 MANUAL_INDEX_STATEMENTS 의 상수다 — 외부 입력이 아니다.
        await executor.$executeRawUnsafe(
          `DROP INDEX CONCURRENTLY IF EXISTS ${indexName}`,
        );
      }
      await executor.$executeRawUnsafe(sql);
    } catch (error: unknown) {
      outcomes.push({ name, state: 'failed', reason: toReason(error) });
      continue;
    }
    if (indexName === null) {
      outcomes.push({ name, state: 'kept' });
      continue;
    }
    outcomes.push({
      name,
      state: rebuild ? 'rebuilt' : before.has(indexName) ? 'kept' : 'created',
    });
  }

  // 생성 구문이 오류 없이 끝나도 결과가 invalid 일 수 있어(CONCURRENTLY) 마지막에 다시 본다.
  const after = await readIndexValidity(executor);
  return outcomes.map((outcome) => {
    if (outcome.state === 'failed') {
      return outcome;
    }
    if (!MANUAL_INDEX_NAMES.has(outcome.name)) {
      return outcome;
    }
    const valid = after.get(outcome.name);
    if (valid !== true) {
      return {
        name: outcome.name,
        state: 'failed',
        reason: valid === false ? '인덱스가 invalid 상태다' : '인덱스가 없다',
      };
    }
    return outcome;
  });
};
