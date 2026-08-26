import { Prisma } from '@prisma/client';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { ModelProviderName } from '../../../model-router/domain/model-router.type';
import { OpenPaperAccountUsecase } from '../../../paper-trading/application/open-paper-account.usecase';
import { PaperTradingPrismaRepository } from '../../../paper-trading/infrastructure/paper-trading.prisma.repository';
import { ScreenUniverseUsecase } from '../../../screener/application/screen-universe.usecase';
import { ResolveStrategyParametersUsecase } from '../../../strategy-parameter/application/resolve-strategy-parameters.usecase';
import {
  GeneratePaperRecommendationUsecase,
  PaperRecommendationSuccess,
} from './generate-paper-recommendation.usecase';

const decidedAt = new Date('2026-08-13T07:00:00.000Z');

const indicators = {
  close: 10_000,
  ma5: 9_500,
  ma20: 9_000,
  ma60: 8_500,
  ma120: 8_000,
  isAligned: true,
  volumeSurge: 2,
  return1m: 5,
  return3m: 8,
  return6m: 12,
  high200Position: 0.95,
  volatility20: 15,
  turnover60: 800_000_000,
  barCount: 200,
};

describe('GeneratePaperRecommendationUsecase', () => {
  const screenUniverse = {
    execute: jest.fn(),
  } as unknown as jest.Mocked<ScreenUniverseUsecase>;
  const openPaperAccount = {
    execute: jest.fn(),
  } as unknown as jest.Mocked<OpenPaperAccountUsecase>;
  const repository = {
    findAccountByName: jest.fn(),
    findPositionsWithTicker: jest.fn(),
    findLatestValuation: jest.fn(),
    findLatestRecommendationScore: jest.fn(),
    saveRecommendationAtomically: jest.fn(),
  } as unknown as jest.Mocked<PaperTradingPrismaRepository>;
  const modelRouter = {
    route: jest.fn(),
  } as unknown as jest.Mocked<ModelRouterUsecase>;
  const agentRunService = {
    execute: jest.fn(),
  } as unknown as jest.Mocked<AgentRunService>;
  const strategyParameters = {
    execute: jest.fn(),
  } as unknown as jest.Mocked<ResolveStrategyParametersUsecase>;
  // 실제 시스템 프롬프트는 run 안의 갱신으로만 남으므로, 그 인자를 볼 수 있게 참조를 둔다.
  const updateInputSnapshot = jest.fn();

  let usecase: GeneratePaperRecommendationUsecase;

  beforeEach(() => {
    jest.resetAllMocks();
    usecase = new GeneratePaperRecommendationUsecase(
      screenUniverse,
      openPaperAccount,
      repository,
      modelRouter,
      agentRunService,
      strategyParameters,
    );
    // 활성 행이 코드 상수와 같은 상태가 기본이다 — 이 PR 은 값을 옮긴 것이지 바꾼 것이 아니다.
    strategyParameters.execute.mockResolvedValue({
      exitBand: { takeProfitPercent: 10, stopLossPercent: -5 },
      minimumTurnover60: 500_000_000,
      maximumWeightPercent: 20,
    });
    repository.findAccountByName.mockImplementation(async (accountName) => {
      const opened = openPaperAccount.execute.mock.calls.some(
        ([command]) => command.accountName === accountName,
      );
      return opened
        ? {
            id: 41,
            seedAmount: { toString: () => '10000000' } as never,
            cashBalance: { toString: () => '10000000' } as never,
          }
        : null;
    });
    openPaperAccount.execute.mockResolvedValue({
      accountId: 41,
      seedAmount: '10000000',
      cashBalance: '10000000',
    });
    repository.findPositionsWithTicker.mockResolvedValue([]);
    repository.findLatestValuation.mockResolvedValue(null);
    repository.findLatestRecommendationScore.mockResolvedValue(null);
    screenUniverse.execute.mockImplementation(async ({ strategy }) => ({
      strategy,
      ruleVersion: 2,
      universeCount: 2,
      evaluatedCount: 2,
      staleCount: 0,
      passedCount: 1,
      asOf: '2026-08-13',
      recordOutcome: null,
      includedIndicators: [],
      stocks: [
        {
          tickerId: 71,
          code: '000660',
          name: 'SK하이닉스',
          krxMarket: 'KOSPI',
          score: 98,
          indicators,
        },
      ],
    }));
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        sells: [],
        buys: [{ code: '000660', reason: '추세 우위' }],
      }),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });
    agentRunService.execute.mockImplementation(async (input) => {
      const execution = await input.run({
        agentRunId: 99,
        updateInputSnapshot,
      });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 99,
      };
    });
    repository.saveRecommendationAtomically.mockImplementation(
      async ({ decide }) =>
        decide({
          account: {
            id: 41,
            seedAmount: { toString: () => '10000000' } as never,
            cashBalance: { toString: () => '10000000' } as never,
          },
          positions: [],
          latestValuation: null,
          existingOrders: [],
        }).result,
    );
  });

  it('계좌가 없으면 전략별 1,000만원 계좌를 만든다', async () => {
    await usecase.execute({ decidedAt });

    expect(openPaperAccount.execute).toHaveBeenCalledTimes(2);
    expect(openPaperAccount.execute).toHaveBeenNthCalledWith(1, {
      accountName: 'LONG_TERM',
      seedAmount: '10000000',
      openedAt: decidedAt,
    });
    expect(openPaperAccount.execute).toHaveBeenNthCalledWith(2, {
      accountName: 'SWING',
      seedAmount: '10000000',
      openedAt: decidedAt,
    });
  });

  it('기존 전략 계좌를 재사용한다', async () => {
    repository.findAccountByName
      .mockResolvedValueOnce({
        id: 11,
        seedAmount: { toString: () => '10000000' } as never,
        cashBalance: { toString: () => '8000000' } as never,
      })
      .mockResolvedValueOnce({
        id: 12,
        seedAmount: { toString: () => '10000000' } as never,
        cashBalance: { toString: () => '7000000' } as never,
      });

    await usecase.execute({ decidedAt });

    expect(openPaperAccount.execute).not.toHaveBeenCalled();
    expect(repository.findPositionsWithTicker).toHaveBeenNthCalledWith(1, 11);
    expect(repository.findPositionsWithTicker).toHaveBeenNthCalledWith(2, 12);
  });

  it('전략마다 정확히 한 번 screen하고 LLM route 한다', async () => {
    await usecase.execute({ decidedAt });

    expect(screenUniverse.execute).toHaveBeenCalledTimes(2);
    // 운영 회차는 원장에 남는다 — record 가 빠지면 그날 무엇을 보여줬는지가 사라진다.
    expect(screenUniverse.execute).toHaveBeenNthCalledWith(1, {
      strategy: 'LONG_TERM',
      limit: 20,
      includeTickerIds: [],
      record: { agentRunId: expect.any(Number) },
      minimumTurnover60: 500_000_000,
    });
    expect(screenUniverse.execute).toHaveBeenNthCalledWith(2, {
      strategy: 'SWING',
      limit: 20,
      includeTickerIds: [],
      record: { agentRunId: expect.any(Number) },
      minimumTurnover60: 500_000_000,
    });
    expect(modelRouter.route).toHaveBeenCalledTimes(2);
  });

  it('prompt와 ruleVersion을 strategy AgentRun inputSnapshot에 남긴다', async () => {
    await usecase.execute({ decidedAt });

    // 초기 스냅샷은 파라미터를 해소하기 전이라 이 회차의 시스템 프롬프트를 아직 모른다.
    // prompt·ruleVersion 과 같은 자리이고, 실제 값은 run 안의 갱신으로 채워진다.
    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'PAPER_RECOMMEND',
        triggerType: TriggerType.AUTOPILOT_PAPER_RECOMMEND_CRON,
        inputSnapshot: expect.objectContaining({
          strategy: 'LONG_TERM',
          decidedAt: decidedAt.toISOString(),
          systemPrompt: null,
        }),
      }),
    );
    expect(updateInputSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: 'LONG_TERM',
        systemPrompt: expect.stringContaining('한국 주식 모의투자 추천'),
        ruleVersion: expect.any(Number),
      }),
    );
  });

  // `ruleVersion` 은 스크리너 규칙의 버전이라 파라미터를 바꿔도 움직이지 않는다. 값이
  // 바뀌기 시작하면 두 회차를 가를 축이 이 스냅샷뿐이므로, 실제로 쓴 값이 실려야 한다.
  it('그 회차가 쓴 파라미터를 입력 스냅샷에 남긴다', async () => {
    strategyParameters.execute.mockResolvedValue({
      exitBand: { takeProfitPercent: 30, stopLossPercent: -15 },
      minimumTurnover60: 300_000_000,
      maximumWeightPercent: 12.5,
    });

    await usecase.execute({ strategies: ['LONG_TERM'], decidedAt });

    expect(updateInputSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: {
          minimumTurnover60: 300_000_000,
          maximumWeightPercent: 12.5,
          exitTakeProfitPercent: 30,
          exitStopLossPercent: -15,
        },
      }),
    );
  });

  it('screen 실패도 AgentRun 내부에서 FAILED 처리되도록 run callback 안에서 실행한다', async () => {
    screenUniverse.execute.mockRejectedValueOnce(new Error('screen failed'));
    agentRunService.execute.mockImplementationOnce(async (input) => {
      expect(screenUniverse.execute).not.toHaveBeenCalled();
      await input.run({
        agentRunId: 99,
        updateInputSnapshot: jest.fn(),
      });
      throw new Error('unreachable');
    });

    const result = await usecase.execute({
      strategies: ['LONG_TERM'],
      decidedAt,
    });

    expect(result.failed).toEqual([
      { strategy: 'LONG_TERM', message: 'screen failed' },
    ]);
  });

  it('후보 밖 보유 종목도 includedIndicators 지표를 모델 prompt에 포함한다', async () => {
    repository.findAccountByName.mockResolvedValue({
      id: 41,
      seedAmount: { toString: () => '10000000' } as never,
      cashBalance: { toString: () => '7000000' } as never,
    });
    repository.findLatestValuation.mockResolvedValue({
      id: 2,
      tradeDate: decidedAt,
      totalValue: { toString: () => '9000000' } as never,
      returnRate: { toString: () => '-10' } as never,
    });
    repository.findPositionsWithTicker.mockResolvedValue([
      {
        id: 1,
        accountId: 41,
        tickerId: 81,
        quantity: { toString: () => '3' } as never,
        avgPrice: { toString: () => '50000' } as never,
        ticker: { code: '005930', name: '삼성전자', tossSymbol: '005930' },
      },
    ]);
    screenUniverse.execute.mockImplementation(async ({ strategy }) => ({
      strategy,
      ruleVersion: 2,
      universeCount: 2,
      evaluatedCount: 2,
      staleCount: 0,
      passedCount: 1,
      asOf: '2026-08-13',
      recordOutcome: null,
      includedIndicators: [
        {
          tickerId: 81,
          code: '005930',
          name: '삼성전자',
          indicators: { ...indicators, close: 70_000 },
        },
      ],
      stocks: [
        {
          tickerId: 71,
          code: '000660',
          name: 'SK하이닉스',
          krxMarket: 'KOSPI',
          score: 98,
          indicators,
        },
      ],
    }));

    await usecase.execute({ strategies: ['LONG_TERM'], decidedAt });

    const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(prompt).toContain(JSON.stringify({ ...indicators, close: 70_000 }));
    expect(prompt).toContain('현금 잔액: 7000000');
    expect(prompt).toContain('계좌 평가액: 9000000');
    expect(prompt).toContain('005930 삼성전자');
    expect(prompt).not.toContain('지표 없음');
    expect(screenUniverse.execute).toHaveBeenCalledWith({
      strategy: 'LONG_TERM',
      limit: 20,
      includeTickerIds: [81],
      record: { agentRunId: expect.any(Number) },
      minimumTurnover60: 500_000_000,
    });
  });

  it('후보 밖 보유 종목 매도 주문에 includedIndicators 근거를 저장한다', async () => {
    const heldIndicators = { ...indicators, close: 70_000 };
    repository.findAccountByName.mockResolvedValue({
      id: 41,
      seedAmount: { toString: () => '10000000' } as never,
      cashBalance: { toString: () => '7000000' } as never,
    });
    repository.findPositionsWithTicker.mockResolvedValue([
      {
        id: 1,
        accountId: 41,
        tickerId: 81,
        quantity: { toString: () => '3' } as never,
        avgPrice: { toString: () => '50000' } as never,
        ticker: { code: '005930', name: '삼성전자', tossSymbol: '005930' },
      },
    ]);
    screenUniverse.execute.mockResolvedValue({
      strategy: 'LONG_TERM',
      ruleVersion: 2,
      universeCount: 2,
      evaluatedCount: 2,
      staleCount: 0,
      passedCount: 1,
      asOf: '2026-08-13',
      recordOutcome: null,
      includedIndicators: [
        {
          tickerId: 81,
          code: '005930',
          name: '삼성전자',
          indicators: heldIndicators,
        },
      ],
      stocks: [
        {
          tickerId: 71,
          code: '000660',
          name: 'SK하이닉스',
          krxMarket: 'KOSPI',
          score: 98,
          indicators,
        },
      ],
    });
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        sells: [{ code: '005930', reason: '추세 훼손' }],
        buys: [],
      }),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });

    await usecase.execute({ strategies: ['LONG_TERM'], decidedAt });

    const decision =
      repository.saveRecommendationAtomically.mock.calls[0][0].decide({
        account: {
          id: 41,
          seedAmount: { toString: () => '10000000' } as never,
          cashBalance: { toString: () => '7000000' } as never,
        },
        positions: [
          {
            id: 1,
            accountId: 41,
            tickerId: 81,
            quantity: { toString: () => '3' } as never,
            avgPrice: { toString: () => '50000' } as never,
            ticker: {
              code: '005930',
              name: '삼성전자',
              tossSymbol: '005930',
            },
          },
        ],
        latestValuation: null,
        existingOrders: [],
      });

    expect(decision.orders).toEqual([
      expect.objectContaining({
        tickerId: 81,
        side: 'SELL',
        indicatorSnapshot: heldIndicators,
      }),
    ]);
  });

  it('PENDING 주문에 판단 근거와 다음 거래일을 저장한다', async () => {
    await usecase.execute({
      strategies: ['LONG_TERM'],
      decidedAt: new Date('2026-08-14T07:00:00.000Z'),
    });

    expect(repository.saveRecommendationAtomically).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 41,
        strategy: 'LONG_TERM',
        decidedAt: new Date('2026-08-14T07:00:00.000Z'),
        decide: expect.any(Function),
      }),
    );
    const decision =
      repository.saveRecommendationAtomically.mock.calls[0][0].decide({
        account: {
          id: 41,
          seedAmount: { toString: () => '10000000' } as never,
          cashBalance: { toString: () => '10000000' } as never,
        },
        positions: [],
        latestValuation: null,
        existingOrders: [],
      });
    expect(decision.orders).toEqual([
      {
        tickerId: 71,
        side: 'BUY',
        quantity: '200',
        strategy: 'LONG_TERM',
        reason: '추세 우위',
        decidedAt: new Date('2026-08-14T07:00:00.000Z'),
        dataAsOf: new Date('2026-08-13T00:00:00.000Z'),
        targetTradeDate: new Date('2026-08-17T00:00:00.000Z'),
        status: 'PENDING',
        indicatorSnapshot: indicators,
        ruleVersion: 2,
        agentRunId: 99,
      },
    ]);
  });

  it('잠금 후 상태로 주문·제외·계좌 상세를 성공 결과에 담는다', async () => {
    // 보유 종목 종가는 후보(stocks) 가 아니라 includedIndicators 로 온다 —
    // 매도 예상금액이 이 경로에서 계산되는지까지 고정한다.
    screenUniverse.execute.mockResolvedValue({
      strategy: 'LONG_TERM',
      ruleVersion: 2,
      universeCount: 2,
      evaluatedCount: 2,
      staleCount: 0,
      passedCount: 1,
      asOf: '2026-08-13',
      recordOutcome: null,
      includedIndicators: [
        {
          tickerId: 81,
          code: '005930',
          name: '삼성전자',
          indicators: { ...indicators, close: 70_000 },
        },
      ],
      stocks: [
        {
          tickerId: 71,
          code: '000660',
          name: 'SK하이닉스',
          krxMarket: 'KOSPI',
          score: 98,
          indicators,
        },
      ],
    });
    repository.findPositionsWithTicker.mockResolvedValue([
      {
        id: 1,
        accountId: 41,
        tickerId: 81,
        quantity: { toString: () => '3' } as never,
        avgPrice: { toString: () => '50000' } as never,
        ticker: { code: '005930', name: '삼성전자', tossSymbol: '005930' },
      },
    ]);
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        sells: [
          { code: '005930', reason: '추세 훼손' },
          { code: '999999', reason: '미보유' },
        ],
        buys: [
          { code: '000660', reason: '추세 우위' },
          { code: '005930', reason: '이미 보유' },
        ],
      }),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });
    repository.saveRecommendationAtomically.mockImplementation(
      async ({ decide }) =>
        decide({
          account: {
            id: 41,
            seedAmount: { toString: () => '10000000' } as never,
            cashBalance: { toString: () => '4050000' } as never,
          },
          positions: [
            {
              id: 1,
              accountId: 41,
              tickerId: 81,
              quantity: { toString: () => '3' } as never,
              avgPrice: { toString: () => '50000' } as never,
              ticker: {
                code: '005930',
                name: '삼성전자',
                tossSymbol: '005930',
              },
            },
          ],
          latestValuation: {
            id: 2,
            tradeDate: decidedAt,
            totalValue: { toString: () => '10120000' } as never,
            returnRate: { toString: () => '1.2' } as never,
          },
          existingOrders: [],
        }).result,
    );

    const result = await usecase.execute({
      strategies: ['LONG_TERM'],
      decidedAt,
    });

    expect(result.completed[0]).toEqual({
      strategy: 'LONG_TERM',
      accountId: 41,
      ordersCreated: 2,
      agentRunId: 99,
      dataAsOf: '2026-08-13',
      orders: [
        {
          side: 'SELL',
          code: '005930',
          name: '삼성전자',
          quantity: 3,
          estimatedAmount: 210_000,
          reason: '추세 훼손',
        },
        {
          side: 'BUY',
          code: '000660',
          name: 'SK하이닉스',
          quantity: 202,
          estimatedAmount: 2_020_000,
          reason: '추세 우위',
        },
      ],
      skipped: [
        {
          side: 'SELL',
          code: '999999',
          name: '999999',
          reason: 'NOT_HELD',
        },
        {
          side: 'BUY',
          code: '005930',
          name: '삼성전자',
          reason: 'ALREADY_HELD',
        },
      ],
      account: {
        cashBalance: 4_050_000,
        totalValue: 10_120_000,
        positionCount: 1,
        returnRate: 1.2,
      },
    });
  });

  it('수량 0인 매수는 주문으로 저장하지 않는다', async () => {
    repository.findLatestValuation.mockResolvedValue({
      id: 2,
      tradeDate: decidedAt,
      totalValue: { toString: () => '10000000' } as never,
      returnRate: { toString: () => '0' } as never,
    });
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        sells: [],
        buys: [{ code: '000660', reason: '추세 우위' }],
      }),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });
    repository.findAccountByName.mockResolvedValue({
      id: 41,
      seedAmount: { toString: () => '10000000' } as never,
      cashBalance: { toString: () => '1' } as never,
    });

    await usecase.execute({ strategies: ['LONG_TERM'], decidedAt });

    const decision =
      repository.saveRecommendationAtomically.mock.calls[0][0].decide({
        account: {
          id: 41,
          seedAmount: { toString: () => '10000000' } as never,
          cashBalance: { toString: () => '1' } as never,
        },
        positions: [],
        latestValuation: null,
        existingOrders: [],
      });
    expect(decision.orders).toEqual([]);
  });

  it('LLM 지연 뒤 locked state에서 pending cash와 BUY/SELL을 재검증한다', async () => {
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        sells: [
          { code: '005930', reason: '전량 매도' },
          { code: '000660', reason: '중복 매도' },
        ],
        buys: [
          { code: '000660', reason: '보유 예정' },
          { code: '035420', reason: '신규 매수' },
        ],
      }),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });
    screenUniverse.execute.mockResolvedValue({
      strategy: 'LONG_TERM',
      ruleVersion: 2,
      universeCount: 2,
      evaluatedCount: 2,
      staleCount: 0,
      passedCount: 2,
      asOf: '2026-08-13',
      recordOutcome: null,
      includedIndicators: [],
      stocks: [
        {
          tickerId: 71,
          code: '000660',
          name: 'SK하이닉스',
          krxMarket: 'KOSPI',
          score: 98,
          indicators,
        },
        {
          tickerId: 72,
          code: '035420',
          name: 'NAVER',
          krxMarket: 'KOSPI',
          score: 97,
          indicators,
        },
      ],
    });

    await usecase.execute({ strategies: ['LONG_TERM'], decidedAt });

    const decision =
      repository.saveRecommendationAtomically.mock.calls[0][0].decide({
        account: {
          id: 41,
          seedAmount: { toString: () => '10000000' } as never,
          cashBalance: { toString: () => '2500000' } as never,
        },
        positions: [
          {
            id: 1,
            accountId: 41,
            tickerId: 81,
            quantity: { toString: () => '7' } as never,
            avgPrice: { toString: () => '50000' } as never,
            ticker: { code: '005930', name: '삼성전자', tossSymbol: '005930' },
          },
        ],
        latestValuation: {
          id: 2,
          tradeDate: decidedAt,
          totalValue: { toString: () => '10000000' } as never,
          returnRate: { toString: () => '0' } as never,
        },
        existingOrders: [
          {
            tickerId: 71,
            side: 'BUY',
            quantity: { toString: () => '200' } as never,
            indicatorSnapshot: { close: 10000 },
          },
          {
            tickerId: 71,
            side: 'SELL',
            quantity: { toString: () => '1' } as never,
            indicatorSnapshot: indicators,
          },
        ],
      });

    expect(decision.orders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ side: 'SELL', tickerId: 81, quantity: '7' }),
        expect.objectContaining({ side: 'BUY', tickerId: 72, quantity: '50' }),
      ]),
    );
    expect(decision.orders).toHaveLength(2);
    const lockedResult = decision.result as PaperRecommendationSuccess;
    expect(lockedResult.skipped).toEqual(
      expect.arrayContaining([
        {
          side: 'BUY',
          code: '000660',
          name: 'SK하이닉스',
          reason: 'PENDING_ORDER_EXISTS',
        },
        {
          side: 'SELL',
          code: '000660',
          name: 'SK하이닉스',
          reason: 'PENDING_ORDER_EXISTS',
        },
      ]),
    );
  });

  // 충돌 종목을 제약 함수 뒤에서 버리면, 그 종목이 먼저 먹은 현금과 매수 건수가 되돌아오지
  // 않아 뒤의 유효한 매수가 상한에 걸려 사라진다. 충돌 판정은 제약 함수 앞에 있어야 한다.
  it('대기 주문과 충돌하는 매수가 뒤의 유효한 매수 자리를 잡아먹지 않는다', async () => {
    screenUniverse.execute.mockImplementation(async ({ strategy }) => ({
      strategy,
      ruleVersion: 2,
      universeCount: 4,
      evaluatedCount: 4,
      staleCount: 0,
      passedCount: 4,
      asOf: '2026-08-13',
      recordOutcome: null,
      includedIndicators: [],
      stocks: [
        {
          tickerId: 71,
          code: '000660',
          name: 'SK하이닉스',
          krxMarket: 'KOSPI',
          score: 98,
          indicators,
        },
        {
          tickerId: 72,
          code: '000720',
          name: '현대건설',
          krxMarket: 'KOSPI',
          score: 95,
          indicators,
        },
        {
          tickerId: 73,
          code: '000810',
          name: '삼성화재',
          krxMarket: 'KOSPI',
          score: 92,
          indicators,
        },
        {
          tickerId: 74,
          code: '000880',
          name: '한화',
          krxMarket: 'KOSPI',
          score: 90,
          indicators,
        },
      ],
    }));
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        sells: [],
        buys: [
          { code: '000660', reason: '충돌 종목' },
          { code: '000720', reason: '유효 1' },
          { code: '000810', reason: '유효 2' },
          { code: '000880', reason: '유효 3' },
        ],
      }),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });
    repository.saveRecommendationAtomically.mockImplementation(
      async ({ decide }) =>
        decide({
          account: {
            id: 41,
            seedAmount: { toString: () => '10000000' } as never,
            cashBalance: { toString: () => '10000000' } as never,
          },
          positions: [],
          latestValuation: null,
          existingOrders: [
            {
              tickerId: 71,
              side: 'SELL',
              quantity: { toString: () => '1' } as never,
              indicatorSnapshot: indicators,
            },
          ],
        }).result,
    );

    const result = await usecase.execute({
      strategies: ['LONG_TERM'],
      decidedAt,
    });

    // 충돌 종목만 빠지고 나머지 셋이 그대로 매수 상한을 채워야 한다.
    expect(result.completed[0].orders.map((order) => order.code)).toEqual([
      '000720',
      '000810',
      '000880',
    ]);
    expect(result.completed[0].skipped).toEqual([
      {
        side: 'BUY',
        code: '000660',
        name: 'SK하이닉스',
        reason: 'PENDING_ORDER_EXISTS',
      },
    ]);
  });

  it('반대 방향 대기 주문이 있는 종목은 매수 추천에서도 제외한다', async () => {
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        sells: [],
        buys: [{ code: '000660', reason: '신규 매수' }],
      }),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });
    repository.saveRecommendationAtomically.mockImplementation(
      async ({ decide }) =>
        decide({
          account: {
            id: 41,
            seedAmount: { toString: () => '10000000' } as never,
            cashBalance: { toString: () => '10000000' } as never,
          },
          positions: [],
          latestValuation: null,
          existingOrders: [
            {
              tickerId: 71,
              side: 'SELL',
              quantity: { toString: () => '1' } as never,
              indicatorSnapshot: indicators,
            },
          ],
        }).result,
    );

    const result = await usecase.execute({
      strategies: ['LONG_TERM'],
      decidedAt,
    });

    expect(result.completed[0].orders).toEqual([]);
    expect(result.completed[0].skipped).toEqual([
      {
        side: 'BUY',
        code: '000660',
        name: 'SK하이닉스',
        reason: 'PENDING_ORDER_EXISTS',
      },
    ]);
  });

  it('계좌 생성 race 중 duplicate 오류면 exact strategy account를 refetch한다', async () => {
    repository.findAccountByName
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 55,
        seedAmount: { toString: () => '10000000' } as never,
        cashBalance: { toString: () => '10000000' } as never,
      });
    openPaperAccount.execute.mockRejectedValue(
      new Error('같은 이름의 가상 매매 계좌가 이미 있습니다: LONG_TERM'),
    );

    const result = await usecase.execute({
      strategies: ['LONG_TERM'],
      decidedAt,
    });

    expect(repository.findAccountByName).toHaveBeenNthCalledWith(
      2,
      'LONG_TERM',
    );
    expect(result.completed[0].accountId).toBe(55);
  });

  it('계좌 생성 후 repository에서 재조회한 실제 Decimal record를 사용한다', async () => {
    const seedAmount = new Prisma.Decimal('10000000');
    const cashBalance = new Prisma.Decimal('9000000');
    repository.findAccountByName
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 77, seedAmount, cashBalance });

    const result = await usecase.execute({
      strategies: ['LONG_TERM'],
      decidedAt,
    });

    expect(repository.findAccountByName).toHaveBeenNthCalledWith(
      2,
      'LONG_TERM',
    );
    expect(repository.findPositionsWithTicker).toHaveBeenCalledWith(77);
    expect(result.completed[0].accountId).toBe(77);
  });

  it('계좌 생성 후 재조회해도 없으면 명시적 오류로 실패한다', async () => {
    repository.findAccountByName.mockResolvedValue(null);

    const result = await usecase.execute({
      strategies: ['LONG_TERM'],
      decidedAt,
    });

    expect(result.completed).toEqual([]);
    expect(result.failed).toEqual([
      {
        strategy: 'LONG_TERM',
        message: '생성한 가상 매매 계좌를 찾을 수 없습니다: LONG_TERM',
      },
    ]);
  });

  it('한 전략 실행이 실패해도 다른 전략을 완료한다', async () => {
    screenUniverse.execute.mockRejectedValueOnce(new Error('screen failed'));

    const result = await usecase.execute({ decidedAt });

    expect(result.completed).toEqual([
      expect.objectContaining({
        strategy: 'SWING',
        accountId: 41,
        ordersCreated: 1,
        agentRunId: 99,
      }),
    ]);
    expect(result.failed).toEqual([
      { strategy: 'LONG_TERM', message: 'screen failed' },
    ]);
  });
  it('미체결 매도 주문 때문에 빠진 추천을 제외 사유로 남긴다', async () => {
    // 제약 함수 앞에서 걸러지는 경로라 기록하지 않으면 '추천 없음' 으로 오인된다.
    screenUniverse.execute.mockResolvedValue({
      strategy: 'LONG_TERM',
      ruleVersion: 2,
      universeCount: 1,
      evaluatedCount: 1,
      staleCount: 0,
      passedCount: 0,
      asOf: '2026-08-13',
      recordOutcome: null,
      includedIndicators: [
        {
          tickerId: 81,
          code: '005930',
          name: '삼성전자',
          indicators: { ...indicators, close: 70_000 },
        },
      ],
      stocks: [],
    });
    repository.findPositionsWithTicker.mockResolvedValue([
      {
        id: 1,
        accountId: 41,
        tickerId: 81,
        quantity: { toString: () => '3' } as never,
        avgPrice: { toString: () => '50000' } as never,
        ticker: { code: '005930', name: '삼성전자', tossSymbol: '005930' },
      },
    ]);
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        sells: [{ code: '005930', reason: '추세 훼손' }],
        buys: [],
      }),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });
    repository.saveRecommendationAtomically.mockImplementation(
      async ({ decide }) =>
        decide({
          account: {
            id: 41,
            seedAmount: { toString: () => '10000000' } as never,
            cashBalance: { toString: () => '4050000' } as never,
          },
          positions: [
            {
              id: 1,
              accountId: 41,
              tickerId: 81,
              quantity: { toString: () => '3' } as never,
              avgPrice: { toString: () => '50000' } as never,
              ticker: {
                code: '005930',
                name: '삼성전자',
                tossSymbol: '005930',
              },
            },
          ],
          latestValuation: null,
          existingOrders: [
            {
              tickerId: 81,
              side: 'SELL',
              quantity: { toString: () => '3' } as never,
              indicatorSnapshot: null,
            },
          ],
        }).result,
    );

    const result = await usecase.execute({
      strategies: ['LONG_TERM'],
      decidedAt,
    });

    expect(result.completed[0].orders).toEqual([]);
    expect(result.completed[0].skipped).toEqual([
      {
        side: 'SELL',
        code: '005930',
        name: '삼성전자',
        reason: 'PENDING_ORDER_EXISTS',
      },
    ]);
  });

  it('종가를 못 구한 매도의 예상금액을 0 이 아니라 null 로 둔다', async () => {
    // 보유 종목 시세가 stale 하면 includedIndicators 에 실리지 않는다.
    screenUniverse.execute.mockResolvedValue({
      strategy: 'LONG_TERM',
      ruleVersion: 2,
      universeCount: 1,
      evaluatedCount: 1,
      staleCount: 1,
      passedCount: 0,
      asOf: '2026-08-13',
      recordOutcome: null,
      includedIndicators: [],
      stocks: [],
    });
    repository.findPositionsWithTicker.mockResolvedValue([
      {
        id: 1,
        accountId: 41,
        tickerId: 81,
        quantity: { toString: () => '3' } as never,
        avgPrice: { toString: () => '50000' } as never,
        ticker: { code: '005930', name: '삼성전자', tossSymbol: '005930' },
      },
    ]);
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify({
        sells: [{ code: '005930', reason: '추세 훼손' }],
        buys: [],
      }),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });
    repository.saveRecommendationAtomically.mockImplementation(
      async ({ decide }) =>
        decide({
          account: {
            id: 41,
            seedAmount: { toString: () => '10000000' } as never,
            cashBalance: { toString: () => '4050000' } as never,
          },
          positions: [
            {
              id: 1,
              accountId: 41,
              tickerId: 81,
              quantity: { toString: () => '3' } as never,
              avgPrice: { toString: () => '50000' } as never,
              ticker: {
                code: '005930',
                name: '삼성전자',
                tossSymbol: '005930',
              },
            },
          ],
          latestValuation: null,
          existingOrders: [],
        }).result,
    );

    const result = await usecase.execute({
      strategies: ['LONG_TERM'],
      decidedAt,
    });

    expect(result.completed[0].orders).toEqual([
      {
        side: 'SELL',
        code: '005930',
        name: '삼성전자',
        quantity: 3,
        estimatedAmount: null,
        reason: '추세 훼손',
      },
    ]);
  });

  it('최신 누적 성적을 prompt 에 실어 모델이 자기 성적을 보게 한다', async () => {
    repository.findLatestRecommendationScore.mockResolvedValue({
      asOf: new Date('2026-08-21'),
      closedCount: 10,
      hitCount: 3,
      meanReturnRate: -0.0393,
      meanExcessReturnRate: -0.0206,
      maximumLoss: -0.1943,
    });

    await usecase.execute({ decidedAt });

    const prompt = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(prompt).toContain('추천 성적');
    expect(prompt).toContain('청산 10건 중 적중 3건');
    expect(prompt).toContain('지수를 따라가지 못했다');
    expect(prompt).toContain('채울 의무가 없다');
  });

  it('전략별로 그 전략의 성적만 조회한다', async () => {
    await usecase.execute({ decidedAt });

    const strategies = repository.findLatestRecommendationScore.mock.calls.map(
      ([input]: [{ strategy: string }]) => input.strategy,
    );
    expect(new Set(strategies)).toEqual(new Set(['LONG_TERM', 'SWING']));
  });

  it('기준 시점 이후 성적은 조회 조건에서 배제한다 — look-ahead 차단', async () => {
    await usecase.execute({ decidedAt });

    const [input] = repository.findLatestRecommendationScore.mock.calls[0] as [
      { asOfMax: Date },
    ];
    expect(input.asOfMax).toEqual(decidedAt);
  });

  it('성적 조회가 실패해도 추천은 계속된다 — best-effort', async () => {
    repository.findLatestRecommendationScore.mockRejectedValue(
      new Error('db down'),
    );

    const result = await usecase.execute({ decidedAt });

    expect(result.completed.length).toBeGreaterThan(0);
    expect(modelRouter.route.mock.calls[0][0].request.prompt).not.toContain(
      '추천 성적',
    );
  });

  it('채점 이력이 없으면 prompt 가 늘어나지 않는다', async () => {
    await usecase.execute({ decidedAt });

    expect(modelRouter.route.mock.calls[0][0].request.prompt).not.toContain(
      '추천 성적',
    );
  });
});
