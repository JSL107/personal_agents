import { Prisma } from '@prisma/client';

import { PaperTradingRepository } from '../infrastructure/paper-trading.repository';
import { GetPaperTradingStatusUsecase } from './get-paper-trading-status.usecase';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

const createFixture = (accountExists = true) => {
  const repository = {
    findAccountByName: jest.fn().mockResolvedValue(
      accountExists
        ? {
            id: 11,
            seedAmount: decimal('10000000'),
            cashBalance: decimal('7999500'),
          }
        : null,
    ),
    findPositionsWithTicker: jest.fn().mockResolvedValue([
      {
        id: 31,
        accountId: 11,
        tickerId: 21,
        quantity: decimal('10'),
        avgPrice: decimal('200050'),
        ticker: {
          code: '005930',
          name: '삼성전자',
          tossSymbol: '005930',
        },
      },
    ]),
    findRecentSnapshots: jest.fn().mockResolvedValue([
      {
        id: 41,
        tradeDate: new Date('2026-08-11T00:00:00.000Z'),
        totalValue: decimal('10010000'),
        returnRate: decimal('0.001'),
      },
    ]),
    // executeAll 경로 — 각 테스트가 필요한 계좌 목록으로 덮어쓴다.
    findAllAccounts: jest.fn().mockResolvedValue([]),
  };
  return {
    repository,
    usecase: new GetPaperTradingStatusUsecase(
      repository as unknown as PaperTradingRepository,
    ),
  };
};

describe('GetPaperTradingStatusUsecase', () => {
  it('계좌, 보유 포지션, 최근 스냅샷을 출력 가능한 값으로 반환한다', async () => {
    const { repository, usecase } = createFixture();

    const result = await usecase.execute({
      accountName: 'DEFAULT',
      snapshotLimit: 10,
    });

    expect(result).toEqual({
      account: {
        name: 'DEFAULT',
        seedAmount: '10000000',
        cashBalance: '7999500',
      },
      positions: [
        {
          tickerCode: '005930',
          tickerName: '삼성전자',
          quantity: '10',
          avgPrice: '200050',
        },
      ],
      snapshots: [
        {
          tradeDate: '2026-08-11',
          totalValue: '10010000',
          returnRate: '0.001',
        },
      ],
    });
    expect(repository.findAccountByName).toHaveBeenCalledWith('DEFAULT');
    expect(repository.findPositionsWithTicker).toHaveBeenCalledWith(11);
    expect(repository.findRecentSnapshots).toHaveBeenCalledWith(11, 10);
  });

  it('계좌가 없으면 한국어 오류로 거부한다', async () => {
    const { usecase } = createFixture(false);

    await expect(
      usecase.execute({ accountName: 'DEFAULT', snapshotLimit: 10 }),
    ).rejects.toThrow('가상 매매 계좌를 찾을 수 없습니다: DEFAULT');
  });

  // executeAll — 계좌 이름은 전략명으로 열리므로(PAPER_RECOMMEND 의 findOrOpenAccount)
  // 조회 쪽이 이름을 들고 있으면 전략이 늘 때 조용히 빠진다.
  it('executeAll 은 열려 있는 계좌를 전부 훑고 각 계좌 이름을 결과에 싣는다', async () => {
    const { repository, usecase } = createFixture();
    repository.findAllAccounts = jest.fn().mockResolvedValue([
      {
        id: 11,
        name: 'LONG_TERM',
        seedAmount: decimal('10000000'),
        cashBalance: decimal('7999500'),
      },
      {
        id: 12,
        name: 'SWING',
        seedAmount: decimal('10000000'),
        cashBalance: decimal('10000000'),
      },
    ]);

    const results = await usecase.executeAll({ snapshotLimit: 5 });

    expect(results).toHaveLength(2);
    expect(results.map((result) => result.account.name)).toEqual([
      'LONG_TERM',
      'SWING',
    ]);
    // 이름으로 되짚어 조회하면 안 된다 — 목록에서 받은 id 를 그대로 쓴다.
    expect(repository.findAccountByName).not.toHaveBeenCalled();
    expect(repository.findPositionsWithTicker).toHaveBeenCalledWith(11);
    expect(repository.findPositionsWithTicker).toHaveBeenCalledWith(12);
    expect(repository.findRecentSnapshots).toHaveBeenCalledWith(11, 5);
    expect(repository.findRecentSnapshots).toHaveBeenCalledWith(12, 5);
  });

  it('executeAll 은 계좌가 없으면 빈 배열을 반환한다 (throw 하지 않음)', async () => {
    const { usecase, repository } = createFixture();
    repository.findAllAccounts = jest.fn().mockResolvedValue([]);

    await expect(usecase.executeAll({ snapshotLimit: 5 })).resolves.toEqual([]);
  });
});
