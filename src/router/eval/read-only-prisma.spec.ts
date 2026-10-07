import {
  EvalWriteBlockedException,
  isPrismaWriteOperation,
  isRawWriteQuery,
  readOnlyPrismaExtension,
} from './read-only-prisma';

describe('readOnlyPrismaExtension', () => {
  const allOperations = readOnlyPrismaExtension.query.$allOperations;

  it.each([
    'findMany',
    'findFirst',
    'findUnique',
    'count',
    'aggregate',
    'groupBy',
    '$queryRaw',
  ])('읽기 %s 는 그대로 통과한다', async (operation) => {
    const query = jest.fn().mockResolvedValue(['row']);
    await expect(
      allOperations({ model: 'AgentRun', operation, args: { a: 1 }, query }),
    ).resolves.toEqual(['row']);
    expect(query).toHaveBeenCalledWith({ a: 1 });
  });

  it.each([
    'create',
    'createMany',
    'update',
    'updateMany',
    'upsert',
    'delete',
    'deleteMany',
    '$executeRaw',
    '$executeRawUnsafe',
  ])('쓰기 %s 는 쿼리를 보내지 않고 막는다', async (operation) => {
    const query = jest.fn();
    await expect(
      allOperations({ model: 'AgentRun', operation, args: {}, query }),
    ).rejects.toBeInstanceOf(EvalWriteBlockedException);
    expect(query).not.toHaveBeenCalled();
  });

  it('쓰기 판정 목록과 차단이 같은 기준을 쓴다', () => {
    expect(isPrismaWriteOperation('create')).toBe(true);
    expect(isPrismaWriteOperation('findMany')).toBe(false);
  });

  it.each([
    [
      '$queryRaw',
      { strings: ['INSERT INTO agent_run (id) VALUES (', ') RETURNING id'] },
    ],
    ['$queryRaw', { sql: 'UPDATE agent_run SET status = $1' }],
    ['$queryRawUnsafe', ['DELETE FROM agent_run WHERE id = 1']],
    [
      '$queryRawUnsafe',
      'with x as (insert into t values (1) returning *) select * from x',
    ],
    ['$queryRaw', { sql: 'SELECT * FROM agent_run FOR UPDATE' }],
  ])('읽기 API 로 보낸 쓰기 SQL(%s)도 막는다', async (operation, args) => {
    const query = jest.fn();
    await expect(
      allOperations({ operation, args, query }),
    ).rejects.toBeInstanceOf(EvalWriteBlockedException);
    expect(query).not.toHaveBeenCalled();
  });

  it('식별자에 쓰기 낱말이 섞인 읽기 SQL 은 통과한다', () => {
    expect(
      isRawWriteQuery('$queryRaw', {
        sql: 'SELECT updated_at, created_by FROM episodic_memory ORDER BY embedding <=> $1 LIMIT 5',
      }),
    ).toBe(false);
  });
});
