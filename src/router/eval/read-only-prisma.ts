// eval 이 운영 DB 를 읽기만 하도록 Prisma 쿼리 단계에서 쓰기를 막는다.
//
// 쓰기 usecase 를 가짜로 바꾸는 것만으로는 부족하다 — 원장(AgentRun)·에피소드 기억·모델 호출
// 로그처럼 usecase 바깥에서 쓰는 경로가 있고, 빠뜨린 곳은 조용히 운영 데이터를 오염시킨다
// (에피소드 기억은 분류기 few-shot 으로 다시 읽힌다). 여기서 막으면 빠뜨린 경로가 예외로 드러난다.
const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  '$executeRaw',
  '$executeRawUnsafe',
  '$runCommandRaw',
]);

export class EvalWriteBlockedException extends Error {
  constructor(
    readonly model: string | undefined,
    readonly operation: string,
  ) {
    super(`eval 은 DB 에 쓰지 않는다 — ${model ?? '(raw)'}.${operation} 차단`);
    this.name = new.target.name;
  }
}

export const isPrismaWriteOperation = (operation: string): boolean =>
  WRITE_OPERATIONS.has(operation);

// $queryRaw 도 INSERT … RETURNING · UPDATE 를 보낼 수 있다 — 읽기 API 라는 이름만 믿지 않고
// SQL 본문에 쓰기·DDL 키워드가 있으면 막는다. "updated_at" 같은 식별자는 낱말 경계로 걸리지 않는다.
// "SELECT … FOR UPDATE" 도 잠금이라 함께 막힌다(eval 이 잠글 이유가 없다).
const RAW_QUERY_OPERATIONS: ReadonlySet<string> = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
]);
const WRITE_SQL =
  /\b(?:insert|update|delete|merge|upsert|truncate|create|alter|drop|grant|revoke|copy|call|vacuum|reindex|refresh)\b/i;

// 확장의 raw 연산 인자는 Prisma 버전마다 모양이 다르다(Sql 객체, [sql, ...values], 문자열).
// 모양을 모르면 직렬화해서 본다 — 막아야 할 것을 놓치는 쪽보다 과하게 막는 쪽이 낫다.
const rawSqlText = (args: unknown): string => {
  if (typeof args === 'string') {
    return args;
  }
  if (Array.isArray(args)) {
    return rawSqlText(args[0]);
  }
  if (args !== null && typeof args === 'object') {
    const candidate = args as { sql?: unknown; strings?: unknown };
    if (typeof candidate.sql === 'string') {
      return candidate.sql;
    }
    if (Array.isArray(candidate.strings)) {
      return candidate.strings.join(' ');
    }
  }
  return JSON.stringify(args) ?? '';
};

export const isRawWriteQuery = (operation: string, args: unknown): boolean =>
  RAW_QUERY_OPERATIONS.has(operation) && WRITE_SQL.test(rawSqlText(args));

interface AllOperationsParams {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}

// `prisma.$extends(readOnlyPrismaExtension)` 로 붙인다. 읽기는 그대로 통과시킨다.
export const readOnlyPrismaExtension = {
  query: {
    $allOperations({
      model,
      operation,
      args,
      query,
    }: AllOperationsParams): Promise<unknown> {
      if (
        isPrismaWriteOperation(operation) ||
        isRawWriteQuery(operation, args)
      ) {
        return Promise.reject(new EvalWriteBlockedException(model, operation));
      }
      return query(args);
    },
  },
};
