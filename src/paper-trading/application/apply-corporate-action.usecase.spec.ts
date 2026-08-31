import { Prisma } from '@prisma/client';

import { PaperTradingPrismaRepository } from '../infrastructure/paper-trading.prisma.repository';
import { ApplyCorporateActionUsecase } from './apply-corporate-action.usecase';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

describe('ApplyCorporateActionUsecase', () => {
  it('배당 dry-run에서 권리 수량·세전·세금·순입금을 계산하고 평단을 건드리지 않는다', async () => {
    const repository = {
      findTickerByCode: jest.fn().mockResolvedValue({ id: 178 }),
      findAccountByName: jest.fn().mockResolvedValue({
        id: 5,
        seedAmount: decimal('10000000'),
        cashBalance: decimal('775952'),
      }),
      findPosition: jest.fn().mockResolvedValue({
        id: 71,
        accountId: 5,
        tickerId: 178,
        quantity: decimal('743'),
        avgPrice: decimal('2335'),
      }),
      findQuantityAtDate: jest.fn().mockResolvedValue(decimal('182')),
      applyCorporateActionAtomically: jest.fn(),
    };
    const usecase = new ApplyCorporateActionUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({
      accountName: 'LONG_TERM',
      tickerCode: '417310',
      kind: 'DIVIDEND',
      exDate: new Date('2026-08-28T00:00:00.000Z'),
      payDate: new Date('2026-11-27T00:00:00.000Z'),
      perShareAmount: '8640',
      note: '특별배당',
      dryRun: true,
    });

    expect(result.accounts).toEqual([
      {
        accountName: 'LONG_TERM',
        tickerCode: '417310',
        kind: 'DIVIDEND',
        dryRun: true,
        eligibleQuantity: '182',
        grossAmount: '1572480',
        taxAmount: '242161',
        cashDelta: '1330319',
        quantityDelta: '0',
        avgPriceAfter: null,
        cashBalance: '2106271',
        corporateActionId: null,
      },
    ]);
    expect(repository.applyCorporateActionAtomically).not.toHaveBeenCalled();
  });

  it('배당 apply는 계좌 잠금 repository에 계산 callback과 근거를 넘긴다', async () => {
    const applyCorporateActionAtomically = jest.fn(async (input) => {
      const mutation = input.decide({
        account: {
          id: 5,
          seedAmount: decimal('10000000'),
          cashBalance: decimal('775952'),
        },
        position: null,
      });
      return { corporateActionId: 41, ...mutation };
    });
    const repository = {
      findTickerByCode: jest.fn().mockResolvedValue({ id: 178 }),
      findAccountByName: jest.fn().mockResolvedValue({
        id: 5,
        seedAmount: decimal('10000000'),
        cashBalance: decimal('775952'),
      }),
      findPosition: jest.fn().mockResolvedValue(null),
      findQuantityAtDate: jest.fn().mockResolvedValue(decimal('182')),
      applyCorporateActionAtomically,
    };
    const usecase = new ApplyCorporateActionUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({
      accountName: 'LONG_TERM',
      tickerCode: '417310',
      kind: 'DIVIDEND',
      exDate: new Date('2026-08-28T00:00:00.000Z'),
      perShareAmount: '8640',
      dryRun: false,
    });

    expect(result.accounts[0]).toEqual(
      expect.objectContaining({
        corporateActionId: 41,
        cashDelta: '1330319',
        avgPriceAfter: null,
      }),
    );
    expect(applyCorporateActionAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 5,
        tickerId: 178,
        kind: 'DIVIDEND',
        perShareAmount: '8640',
      }),
    );
  });
});

describe('ApplyCorporateActionUsecase 수동 권리 수량 가드', () => {
  // 권리 수량을 손으로 주면 계좌별 자동 계산을 건너뛴다. 계좌를 안 고르면 그 수량이
  // 종목을 들고 있지도 않은 계좌에까지 입금되어 성적표가 조용히 부풀려진다.
  it('권리 수량을 지정하면서 계좌를 지정하지 않으면 거부한다', async () => {
    const repository = {
      findTickerByCode: jest.fn(),
      findAllAccounts: jest.fn(),
      applyCorporateActionAtomically: jest.fn(),
    };
    const usecase = new ApplyCorporateActionUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    await expect(
      usecase.execute({
        tickerCode: '417310',
        kind: 'DIVIDEND',
        exDate: new Date('2026-08-28T00:00:00.000Z'),
        perShareAmount: '8640',
        eligibleQuantity: '182',
        dryRun: true,
      }),
    ).rejects.toThrow('--account 로 대상 계좌를 함께 지정해야 합니다');
    // 계좌를 훑기도 전에 막아야 한다 — 훑은 뒤 막으면 종목 조회가 먼저 나가 실패 지점이 흐려진다.
    expect(repository.findTickerByCode).not.toHaveBeenCalled();
    expect(repository.applyCorporateActionAtomically).not.toHaveBeenCalled();
  });
});

describe('ApplyCorporateActionUsecase 수량 조정', () => {
  const splitRepository = (overrides: Record<string, unknown> = {}) => ({
    findTickerByCode: jest.fn().mockResolvedValue({ id: 178 }),
    findAccountByName: jest.fn().mockResolvedValue({
      id: 5,
      seedAmount: decimal('10000000'),
      cashBalance: decimal('775952'),
    }),
    findPosition: jest.fn().mockResolvedValue({
      id: 71,
      accountId: 5,
      tickerId: 178,
      quantity: decimal('100'),
      avgPrice: decimal('10000'),
    }),
    findQuantityAtDate: jest.fn().mockResolvedValue(decimal('100')),
    applyCorporateActionAtomically: jest
      .fn()
      .mockImplementation(
        async (input: { decide: (state: unknown) => unknown }) => ({
          corporateActionId: 42,
          ...(input.decide({
            account: { cashBalance: decimal('775952') },
            position: { quantity: decimal('100'), avgPrice: decimal('10000') },
          }) as Record<string, unknown>),
        }),
      ),
    ...overrides,
  });

  it('2:1 분할은 수량을 배로 늘리고 평단을 절반으로 낮춘다', async () => {
    const repository = splitRepository();
    const usecase = new ApplyCorporateActionUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({
      accountName: 'LONG_TERM',
      tickerCode: '417310',
      kind: 'SPLIT',
      exDate: new Date('2026-09-10T00:00:00.000Z'),
      quantityRatio: '2',
      dryRun: false,
    });

    expect(result.accounts[0]).toEqual(
      expect.objectContaining({
        quantityDelta: '100',
        avgPriceAfter: '5000',
        cashDelta: '0',
      }),
    );
    // 재실행이 수량을 또 늘리지 못하도록, 중복 키의 재료는 계산 결과가 아니라 명령 입력이어야 한다.
    expect(repository.applyCorporateActionAtomically).toHaveBeenCalledWith(
      expect.objectContaining({ quantityRatio: '2' }),
    );
  });

  // 권리락일 뒤에 매매가 있으면 현재 수량에 권리와 무관한 주식이 섞여 있다. 그대로 조정하면
  // 나중에 산 주식까지 쪼개고 그 사이 판 주식은 빠뜨려 수량·평단이 함께 망가진다.
  it('권리락일 이후 매매가 있으면 소급 적용을 거부한다', async () => {
    const repository = splitRepository({
      findQuantityAtDate: jest.fn().mockResolvedValue(decimal('80')),
    });
    const usecase = new ApplyCorporateActionUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    await expect(
      usecase.execute({
        accountName: 'LONG_TERM',
        tickerCode: '417310',
        kind: 'SPLIT',
        exDate: new Date('2026-09-10T00:00:00.000Z'),
        quantityRatio: '2',
        dryRun: true,
      }),
    ).rejects.toThrow('권리일 수량 80주, 현재 100주');
    expect(repository.applyCorporateActionAtomically).not.toHaveBeenCalled();
  });

  // 배당은 현금만 더하므로 권리락일 이후 매매가 있어도 소급이 안전하다. 실제 이번 건이
  // 그 경우다 — 8/28 배당락 뒤 8/31에 743주를 다시 샀는데도 182주분만 정확히 들어왔다.
  it('배당은 권리락일 이후 매매가 있어도 소급 적용한다', async () => {
    const repository = splitRepository({
      findQuantityAtDate: jest.fn().mockResolvedValue(decimal('182')),
      findPosition: jest.fn().mockResolvedValue({
        id: 71,
        accountId: 5,
        tickerId: 178,
        quantity: decimal('743'),
        avgPrice: decimal('2335'),
      }),
    });
    const usecase = new ApplyCorporateActionUsecase(
      repository as unknown as PaperTradingPrismaRepository,
    );

    const result = await usecase.execute({
      accountName: 'LONG_TERM',
      tickerCode: '417310',
      kind: 'DIVIDEND',
      exDate: new Date('2026-08-28T00:00:00.000Z'),
      perShareAmount: '8640',
      dryRun: true,
    });

    expect(result.accounts[0]).toEqual(
      expect.objectContaining({
        eligibleQuantity: '182',
        cashDelta: '1330319',
        quantityDelta: '0',
      }),
    );
  });
});
