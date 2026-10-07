import {
  EvalWriteBlockedException,
  isPrismaWriteOperation,
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
});
