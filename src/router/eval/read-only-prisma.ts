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
      if (isPrismaWriteOperation(operation)) {
        return Promise.reject(new EvalWriteBlockedException(model, operation));
      }
      return query(args);
    },
  },
};
