import { Prisma } from '@prisma/client';

import { ParameterSnapshot } from '../../param-tune/domain/param-tune.type';
import { PrismaService } from '../../prisma/prisma.service';
import { StrategyParameterSnapshotError } from '../domain/strategy-parameter.exception';
import { STRATEGY_PARAMETER_NAMES } from '../domain/strategy-parameter.type';
import { StrategyParameterPrismaRepository } from './strategy-parameter.prisma.repository';

const decimal = (value: number) => ({ toNumber: () => value });

describe('StrategyParameterPrismaRepository', () => {
  const strategyParameter = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
  };
  const $transaction = jest.fn();
  const repository = new StrategyParameterPrismaRepository({
    strategyParameter,
    $transaction,
  } as unknown as PrismaService);

  beforeEach(() => {
    jest.resetAllMocks();
    $transaction.mockImplementation(async (callback) =>
      callback({ strategyParameter }),
    );
  });

  const activeRows = (versions: number[] = [1, 1, 1, 1], idOffset = 10) =>
    STRATEGY_PARAMETER_NAMES.map((name, index) => ({
      id: idOffset + index,
      name,
      value: decimal(index + 1),
      version: versions[index],
    }));

  const snapshotOf = (rows: ReturnType<typeof activeRows>): ParameterSnapshot =>
    rows.map((row) => ({
      name: row.name,
      parameterId: row.id,
      version: row.version,
      value: row.value.toNumber(),
    }));

  describe('findActiveParameters', () => {
    it('활성 행만 조회한다', async () => {
      strategyParameter.findMany.mockResolvedValue([]);

      await repository.findActiveParameters('SWING');

      expect(strategyParameter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            strategy: 'SWING',
            activatedAt: { not: null },
            supersededAt: null,
          },
        }),
      );
    });

    it('Decimal 을 수로 바꿔 돌려준다', async () => {
      strategyParameter.findMany.mockResolvedValue([
        {
          name: 'MINIMUM_TURNOVER60',
          value: decimal(300_000_000),
          version: 2,
          reason: '근거',
        },
      ]);

      const active = await repository.findActiveParameters('SWING');

      expect(active).toEqual([
        {
          name: 'MINIMUM_TURNOVER60',
          value: 300_000_000,
          version: 2,
          reason: '근거',
        },
      ]);
    });

    // 이름을 코드에서 지운 뒤에도 행은 남는다. 그대로 흘려보내면 어디에도 쓰이지 않는
    // 값이 활성으로 보인다.
    it('코드가 모르는 이름은 버린다', async () => {
      strategyParameter.findMany.mockResolvedValue([
        {
          name: 'REMOVED_PARAMETER',
          value: decimal(1),
          version: 1,
          reason: '옛 축',
        },
      ]);

      expect(await repository.findActiveParameters('SWING')).toEqual([]);
    });

    // 같은 이름에 활성 행이 둘이면 쓰기 경로가 깨진 것이다. 그 상태에서도 판정이 회차마다
    // 흔들리지 않도록 높은 버전 하나로 고정한다.
    it('같은 이름이 둘이면 높은 버전만 쓴다', async () => {
      strategyParameter.findMany.mockResolvedValue([
        {
          name: 'MINIMUM_TURNOVER60',
          value: decimal(300_000_000),
          version: 5,
          reason: '새 값',
        },
        {
          name: 'MINIMUM_TURNOVER60',
          value: decimal(500_000_000),
          version: 4,
          reason: '옛 값',
        },
      ]);

      const active = await repository.findActiveParameters('SWING');

      expect(active).toHaveLength(1);
      expect(active[0].version).toBe(5);
    });
  });

  describe('seedMissingParameters', () => {
    // 씨앗을 다시 뿌려 사람이 승인한 값이 초기값으로 되돌아가면, 되돌린 사실조차 남지 않는다.
    it('활성 행이 있으면 건너뛴다', async () => {
      strategyParameter.findFirst.mockResolvedValue({ id: 7 });

      const outcome = await repository.seedMissingParameters([
        {
          strategy: 'SWING',
          name: 'MINIMUM_TURNOVER60',
          value: 500_000_000,
          reason: '근거',
        },
      ]);

      expect(strategyParameter.create).not.toHaveBeenCalled();
      expect(outcome.skipped).toEqual(['SWING.MINIMUM_TURNOVER60']);
      expect(outcome.inserted).toEqual([]);
    });

    // 되돌리기로 비활성이 된 행이 남아 있으면 version 1 은 unique 를 깬다.
    it('과거 행이 있으면 다음 버전으로 넣는다', async () => {
      strategyParameter.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ version: 3 });

      const outcome = await repository.seedMissingParameters([
        {
          strategy: 'SWING',
          name: 'MINIMUM_TURNOVER60',
          value: 500_000_000,
          reason: '근거',
        },
      ]);

      expect(strategyParameter.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 4,
            activatedAt: expect.any(Date),
            reason: '근거',
          }),
        }),
      );
      expect(outcome.inserted).toEqual(['SWING.MINIMUM_TURNOVER60']);
    });

    it('행이 하나도 없으면 버전 1 로 활성화해 넣는다', async () => {
      strategyParameter.findFirst.mockResolvedValue(null);

      await repository.seedMissingParameters([
        {
          strategy: 'LONG_TERM',
          name: 'MAXIMUM_WEIGHT_PERCENT',
          value: 20,
          reason: '근거',
        },
      ]);

      expect(strategyParameter.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 1, value: '20' }),
        }),
      );
    });
  });

  describe('findSnapshotStrict', () => {
    it('활성 행이 3개뿐이면 던진다', async () => {
      strategyParameter.findMany.mockResolvedValue(activeRows().slice(0, 3));

      await expect(repository.findSnapshotStrict('SWING')).rejects.toThrow(
        StrategyParameterSnapshotError,
      );
    });

    it('4개면 STRATEGY_PARAMETER_NAMES 순서로 돌려준다', async () => {
      strategyParameter.findMany.mockResolvedValue([...activeRows()].reverse());

      const snapshot = await repository.findSnapshotStrict('SWING');

      expect(snapshot.map((entry) => entry.name)).toEqual([
        ...STRATEGY_PARAMETER_NAMES,
      ]);
      expect(snapshot[0]).toEqual({
        name: 'EXIT_TAKE_PROFIT_PERCENT',
        parameterId: 10,
        version: 1,
        value: 1,
      });
    });

    it('조회 예외는 그대로 전파한다', async () => {
      strategyParameter.findMany.mockRejectedValue(new Error('db down'));

      await expect(repository.findSnapshotStrict('SWING')).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('activateNewVersion', () => {
    const input = (expectedSnapshot: ParameterSnapshot) => ({
      strategy: 'SWING' as const,
      name: 'EXIT_STOP_LOSS_PERCENT' as const,
      expectedSnapshot,
      value: -7,
      reason: '근거',
      agentRunId: 5,
    });

    it('스냅샷이 맞으면 내린 뒤 max+1 버전으로 만든다', async () => {
      const rows = activeRows();
      strategyParameter.findMany.mockResolvedValue(rows);
      strategyParameter.aggregate.mockResolvedValue({ _max: { version: 3 } });
      strategyParameter.create.mockResolvedValue({ id: 99, version: 4 });

      const result = await repository.activateNewVersion(
        input(snapshotOf(rows)),
      );

      expect(result).toEqual({
        kind: 'ACTIVATED',
        parameterId: 99,
        version: 4,
      });
      expect(strategyParameter.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: { supersededAt: expect.any(Date) },
      });
      expect(strategyParameter.update.mock.invocationCallOrder[0]).toBeLessThan(
        strategyParameter.create.mock.invocationCallOrder[0],
      );
      expect(strategyParameter.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            version: 4,
            value: '-7',
            agentRunId: 5,
            reason: '근거',
          }),
        }),
      );
      expect($transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    });

    it('다른 축의 version 이 다르면 쓰지 않고 CONFLICT', async () => {
      const expected = snapshotOf(activeRows());
      strategyParameter.findMany.mockResolvedValue(activeRows([1, 1, 2, 1]));

      const result = await repository.activateNewVersion(input(expected));

      expect(result.kind).toBe('CONFLICT');
      expect(strategyParameter.update).not.toHaveBeenCalled();
      expect(strategyParameter.create).not.toHaveBeenCalled();
    });

    // A→B→A: 값과 version 이 같아 보여도 행이 다르면 그사이 바뀐 것이다.
    it('값이 같아도 parameterId 가 다르면 CONFLICT', async () => {
      const expected = snapshotOf(activeRows());
      strategyParameter.findMany.mockResolvedValue(
        activeRows([1, 1, 1, 1], 20),
      );

      const result = await repository.activateNewVersion(input(expected));

      expect(result.kind).toBe('CONFLICT');
      expect(strategyParameter.create).not.toHaveBeenCalled();
    });

    it.each(['P2034', 'P2002'])(
      '트랜잭션이 %s 로 실패하면 CONFLICT',
      async (code) => {
        const rows = activeRows();
        strategyParameter.findMany.mockResolvedValue(rows);
        $transaction.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('conflict', {
            code,
            clientVersion: 'test',
          }),
        );

        const result = await repository.activateNewVersion(
          input(snapshotOf(rows)),
        );

        expect(result.kind).toBe('CONFLICT');
      },
    );

    it('다른 오류는 다시 던진다', async () => {
      $transaction.mockRejectedValue(new Error('boom'));

      await expect(repository.activateNewVersion(input([]))).rejects.toThrow(
        'boom',
      );
    });
  });
});
