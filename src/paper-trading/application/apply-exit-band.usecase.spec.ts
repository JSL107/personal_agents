import { PaperTradingPrismaRepository } from '../infrastructure/paper-trading.prisma.repository';
import { ApplyExitBandUsecase } from './apply-exit-band.usecase';
import {
  EvaluateAccountResult,
  EvaluatedAccountEntry,
} from './evaluate-paper-account.usecase';

const evaluation = (
  overrides: Partial<EvaluateAccountResult> = {},
): EvaluateAccountResult => ({
  skipped: false,
  tradeDate: '2026-08-18',
  cashBalance: '4054273',
  positionValue: '6059930',
  totalValue: '10114203',
  returnRate: '1.142',
  benchmarkClose: null,
  positions: [],
  unpricedPositions: [],
  positionCount: 0,
  staleTickerCount: 0,
  invariantViolations: [],
  suspiciousJumps: [],
  ...overrides,
});

const position = (
  overrides: Partial<EvaluateAccountResult['positions'][number]> = {},
) => ({
  tickerId: 1976,
  tickerCode: '121440',
  tickerName: '골프존홀딩스',
  quantity: '293',
  avgPrice: '6821.2696',
  price: '7180',
  priceDate: '2026-08-18',
  marketValue: '2103740',
  unrealizedPnl: '105207',
  returnRate: '5.26',
  isStale: false,
  ...overrides,
});

const entry = (
  accountName: string,
  value: EvaluateAccountResult | null,
  failureReason: string | null = null,
): EvaluatedAccountEntry => ({
  accountName,
  evaluation: value,
  failureReason,
});

describe('ApplyExitBandUsecase', () => {
  const repository = {
    findAccountByName: jest.fn(),
    createExitBandOrders: jest.fn(),
  };
  const usecase = new ApplyExitBandUsecase(
    repository as unknown as PaperTradingPrismaRepository,
  );
  const executedAt = new Date('2026-08-18T08:40:00.000Z');

  beforeEach(() => {
    jest.resetAllMocks();
    repository.findAccountByName.mockResolvedValue({
      id: 5,
      seedAmount: '10000000',
      cashBalance: '4054273',
    });
    repository.createExitBandOrders.mockResolvedValue({
      created: 1,
      skippedByPendingSell: 0,
      skippedByNoPosition: 0,
    });
  });

  it('밴드를 넘긴 종목을 다음 날짜 시가 매도 주문으로 예약한다', async () => {
    const result = await usecase.execute({
      accounts: [entry('LONG_TERM', evaluation({ positions: [position()] }))],
      executedAt,
    });

    expect(result.createdCount).toBe(1);
    expect(repository.createExitBandOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 5,
        strategy: 'LONG_TERM',
        decidedAt: executedAt,
        dataAsOf: new Date('2026-08-18T00:00:00.000Z'),
        targetTradeDate: new Date('2026-08-19T00:00:00.000Z'),
        orders: [
          {
            tickerId: 1976,
            reason: '익절 밴드 도달: 평가 손익률 5.26% (기준 +2% 이상)',
          },
        ],
      }),
    );
  });

  // 스냅샷이 막힌 회차의 평가값은 불변식 위반이나 시세 결측을 안고 있다.
  // 그 값으로 판 주식은 되돌릴 수 없으므로 주문 경로 자체를 타면 안 된다.
  it('평가가 스킵된 계좌에는 매도를 걸지 않는다', async () => {
    const result = await usecase.execute({
      accounts: [
        entry(
          'SWING',
          evaluation({
            skipped: true,
            skipReason: '거래 원장과 계좌 상태의 불변식이 일치하지 않습니다.',
            positions: [position({ returnRate: '-9' })],
          }),
        ),
      ],
      executedAt,
    });

    expect(result.createdCount).toBe(0);
    expect(repository.createExitBandOrders).not.toHaveBeenCalled();
  });

  it('평가 자체가 실패한 계좌도 건너뛴다', async () => {
    const result = await usecase.execute({
      accounts: [entry('SWING', null, '시세 조회 실패')],
      executedAt,
    });

    expect(result.createdCount).toBe(0);
    expect(repository.createExitBandOrders).not.toHaveBeenCalled();
  });

  it('밴드 안에 있으면 계좌를 조회하지도 않는다', async () => {
    const result = await usecase.execute({
      accounts: [
        entry(
          'LONG_TERM',
          evaluation({ positions: [position({ returnRate: '1' })] }),
        ),
      ],
      executedAt,
    });

    expect(result.accounts).toEqual([]);
    expect(repository.findAccountByName).not.toHaveBeenCalled();
  });

  it('전략 계좌가 아니면 MANUAL 전략으로 남긴다', async () => {
    await usecase.execute({
      accounts: [entry('DEFAULT', evaluation({ positions: [position()] }))],
      executedAt,
    });

    expect(repository.createExitBandOrders).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'MANUAL' }),
    );
  });
});
