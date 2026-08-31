import { ResolveStrategyParametersUsecase } from '../../strategy-parameter/application/resolve-strategy-parameters.usecase';
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
  settledCash: '4054273',
  unsettledCash: '0',
  pendingDividendCash: '0',
  pendingDividendCount: 0,
  purchasableCash: '4054273',
  nextDividendPayDate: null,
  dividendNetTotal: '0',
  dividendCount: 0,
  positionValue: '6059930',
  totalValue: '10114203',
  returnRate: '1.142',
  realizedPnl: '0',
  unrealizedPnl: '114203',
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
  returnRate: '12.53',
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
  // 파라미터 조회는 여기서 대역이다. threshold 를 명시하지 않은 케이스가 활성 행을
  // 보러 가는지까지 이 대역으로 확인한다.
  const strategyParameters = {
    execute: jest.fn(),
  };
  const usecase = new ApplyExitBandUsecase(
    repository as unknown as PaperTradingPrismaRepository,
    strategyParameters as unknown as ResolveStrategyParametersUsecase,
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
      createdTickerIds: [1976],
      skippedByPendingSell: 0,
      skippedByNoPosition: 0,
    });
    // 기본은 활성 행이 코드 상수와 같은 상태. 값을 옮긴 것이지 바꾼 것이 아니다.
    strategyParameters.execute.mockResolvedValue({
      exitBand: { takeProfitPercent: 10, stopLossPercent: -5 },
      minimumTurnover60: 500_000_000,
      maximumWeightPercent: 20,
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
            reason: '익절 밴드 도달: 평가 손익률 12.53% (기준 +10% 이상)',
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
  // 금요일 장마감 평가가 토요일을 목표 거래일로 적으면, 체결은 월요일에 되더라도
  // 원장에는 장이 열리지 않는 날짜가 남아 판단·체결 시점을 재구성할 수 없다.
  it('금요일 실행은 목표 거래일로 다음 월요일을 적는다', async () => {
    await usecase.execute({
      accounts: [entry('LONG_TERM', evaluation({ positions: [position()] }))],
      executedAt: new Date('2026-08-14T08:40:00.000Z'),
    });

    expect(repository.createExitBandOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        targetTradeDate: new Date('2026-08-17T00:00:00.000Z'),
      }),
    );
  });

  it('실행 원장 id 를 주문에 실어 어떤 실행이 청산했는지 남긴다', async () => {
    await usecase.execute({
      accounts: [entry('LONG_TERM', evaluation({ positions: [position()] }))],
      executedAt,
      agentRunId: 71,
    });

    expect(repository.createExitBandOrders).toHaveBeenCalledWith(
      expect.objectContaining({ agentRunId: 71 }),
    );
  });

  // 판정 목록을 그대로 실으면 중복·보유 소멸로 걸러진 종목까지 "예약됨" 으로 적혀
  // 카드의 건수(created)와 상세(reasons)가 서로 어긋난다.
  it('실제로 저장된 종목만 예약 내역에 남긴다', async () => {
    repository.createExitBandOrders.mockResolvedValue({
      created: 1,
      createdTickerIds: [1976],
      skippedByPendingSell: 1,
      skippedByNoPosition: 0,
    });

    const result = await usecase.execute({
      accounts: [
        entry(
          'SWING',
          evaluation({
            positions: [
              position(),
              position({
                tickerId: 321,
                tickerCode: '181710',
                returnRate: '-9',
              }),
            ],
          }),
        ),
      ],
      executedAt,
    });

    expect(result.accounts[0].created).toBe(1);
    expect(result.accounts[0].reasons).toEqual([
      '121440 익절 밴드 도달: 평가 손익률 12.53% (기준 +10% 이상)',
    ]);
  });

  // 임계값은 기본값과 겹치지 않는 값으로 검증한다. 기본값과 같은 값을 넘기면 호출자 값이
  // 무시돼도 통과한다.
  it('호출자가 넘긴 임계값이 판정과 저장 사유에 모두 반영된다', async () => {
    const threshold = { takeProfitPercent: 20, stopLossPercent: -15 };

    await usecase.execute({
      accounts: [
        entry(
          'LONG_TERM',
          evaluation({ positions: [position({ returnRate: '12' })] }),
        ),
      ],
      executedAt,
      threshold,
    });
    expect(repository.createExitBandOrders).not.toHaveBeenCalled();

    await usecase.execute({
      accounts: [
        entry(
          'LONG_TERM',
          evaluation({ positions: [position({ returnRate: '-16' })] }),
        ),
      ],
      executedAt,
      threshold,
    });

    expect(repository.createExitBandOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        // 판정에 쓴 밴드가 주문에도 실려야 나중에 성적을 밴드별로 가를 수 있다.
        threshold,
        orders: [
          {
            tickerId: 1976,
            reason: '손절 밴드 이탈: 평가 손익률 -16.00% (기준 -15% 이하)',
          },
        ],
      }),
    );
  });

  // 배선이 살아 있는지는 "활성 행 값이 판정을 실제로 바꾸는가" 로만 증명된다. 코드 상수와
  // 같은 값으로 확인하면 조회 결과를 버려도 통과한다.
  it('threshold 를 안 주면 그 전략의 활성 행 값으로 판정한다', async () => {
    strategyParameters.execute.mockResolvedValue({
      exitBand: { takeProfitPercent: 30, stopLossPercent: -20 },
      minimumTurnover60: 500_000_000,
      maximumWeightPercent: 20,
    });

    // 12.53% 는 코드 상수(+10)로는 익절이지만 활성 행(+30)으로는 밴드 안이다.
    const result = await usecase.execute({
      accounts: [entry('SWING', evaluation({ positions: [position()] }))],
      executedAt,
    });

    expect(strategyParameters.execute).toHaveBeenCalledWith('SWING');
    expect(result.createdCount).toBe(0);
    expect(repository.createExitBandOrders).not.toHaveBeenCalled();
  });

  // 수동 계좌는 규칙이 연 계좌가 아니다. 전략 파라미터를 따라 움직이면 규칙을 바꿀 때마다
  // 손으로 만든 계좌의 청산 기준까지 조용히 끌려간다.
  it('수동 계좌는 파라미터를 조회하지 않고 코드 상수로 판정한다', async () => {
    strategyParameters.execute.mockResolvedValue({
      exitBand: { takeProfitPercent: 30, stopLossPercent: -20 },
      minimumTurnover60: 500_000_000,
      maximumWeightPercent: 20,
    });

    const result = await usecase.execute({
      accounts: [entry('DEFAULT', evaluation({ positions: [position()] }))],
      executedAt,
    });

    expect(strategyParameters.execute).not.toHaveBeenCalled();
    // 코드 상수 +10 기준이므로 12.53% 는 익절이다.
    expect(result.createdCount).toBe(1);
  });

  // 계좌가 여럿이어도 전략당 한 번만 읽어야 같은 회차가 같은 값을 쓴다.
  it('같은 전략의 계좌가 여럿이어도 파라미터는 한 번만 읽는다', async () => {
    await usecase.execute({
      accounts: [
        entry('SWING', evaluation({ positions: [position()] })),
        entry('SWING', evaluation({ positions: [position()] })),
      ],
      executedAt,
    });

    expect(strategyParameters.execute).toHaveBeenCalledTimes(1);
  });
});
