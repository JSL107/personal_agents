import { ConfigService } from '@nestjs/config';

import { evaluateContract } from '../../../agent-registry/contract-inspector';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { ApplyExitBandUsecase } from '../../../paper-trading/application/apply-exit-band.usecase';
import {
  EvaluateAccountResult,
  EvaluatedAccountEntry,
  EvaluatePaperAccountUsecase,
} from '../../../paper-trading/application/evaluate-paper-account.usecase';
import { PaperTradingAutopilotTask } from './paper-trading.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-11' };

const EVALUATION: EvaluateAccountResult = {
  skipped: false,
  tradeDate: '2026-08-11',
  cashBalance: '800000',
  settledCash: '800000',
  unsettledCash: '0',
  pendingDividendCash: '0',
  purchasableCash: '800000',
  nextDividendPayDate: null,
  dividendNetTotal: '0',
  dividendCount: 0,
  positionValue: '120000',
  totalValue: '920000',
  returnRate: '-8',
  realizedPnl: '-100000',
  unrealizedPnl: '20000',
  benchmarkClose: null,
  positions: [
    {
      tickerId: 21,
      tickerCode: '005930',
      tickerName: '삼성전자',
      quantity: '10',
      avgPrice: '10000',
      price: '12000',
      priceDate: '2026-08-11',
      marketValue: '120000',
      unrealizedPnl: '20000',
      returnRate: '20',
      isStale: false,
    },
  ],
  unpricedPositions: [],
  positionCount: 1,
  staleTickerCount: 0,
  invariantViolations: [],
  suspiciousJumps: [],
};

const succeededEntry = (
  accountName: string,
  evaluation: EvaluateAccountResult = EVALUATION,
): EvaluatedAccountEntry => ({
  accountName,
  evaluation,
  failureReason: null,
});

const failedEntry = (
  accountName: string,
  failureReason: string,
): EvaluatedAccountEntry => ({
  accountName,
  evaluation: null,
  failureReason,
});

const createFixture = (input?: {
  enabled?: string;
  accounts?: EvaluatedAccountEntry[];
}) => {
  const evaluate = {
    executeAll: jest.fn().mockResolvedValue({
      accounts: input?.accounts ?? [
        succeededEntry('LONG_TERM'),
        succeededEntry('SWING'),
      ],
    }),
  };
  const exitBand = {
    execute: jest.fn().mockResolvedValue({ accounts: [], createdCount: 0 }),
  };
  const config = {
    get: jest.fn().mockReturnValue(input?.enabled ?? 'true'),
  };
  const agentRun = {
    execute: jest.fn(async (executionInput) => {
      const execution = await executionInput.run({ agentRunId: 71 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 71,
      };
    }),
  };
  return {
    task: new PaperTradingAutopilotTask(
      evaluate as unknown as EvaluatePaperAccountUsecase,
      exitBand as unknown as ApplyExitBandUsecase,
      config as unknown as ConfigService,
      agentRun as unknown as AgentRunService,
    ),
    evaluate,
    exitBand,
    config,
    agentRun,
  };
};

describe('PaperTradingAutopilotTask', () => {
  // 이 워커의 계약(accounts / accountCount / failedCount)은 2026-08-24 실측으로 정했는데,
  // 그 표본에는 같은 AgentType 으로 기록하는 장중 손절 워커가 빠져 있었다. 양쪽 모두 자기
  // 산출물을 계약으로 채점하게 두어, 형태와 계약이 갈리면 테스트가 먼저 깨지게 한다.
  it('원장에 남기는 산출물이 자기 직무 계약을 만족한다', async () => {
    const { task, agentRun } = createFixture();

    await task.run(context);

    const executionInput = agentRun.execute.mock.calls[0][0] as {
      agentType: AgentType;
      run: (context: { agentRunId: number }) => Promise<{ output: unknown }>;
    };
    const executed = await executionInput.run({ agentRunId: 71 });
    const evaluation = evaluateContract(
      executionInput.agentType,
      executed.output,
    );

    expect(executionInput.agentType).toBe(AgentType.PAPER_TRADE);
    expect(evaluation.violations).toEqual([]);
    expect(evaluation.score).toBe(1);
  });

  it('게이트가 꺼져 있으면 usecase와 원장을 호출하지 않는다', async () => {
    const { task, evaluate, agentRun } = createFixture({ enabled: 'false' });

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(evaluate.executeAll).not.toHaveBeenCalled();
    expect(agentRun.execute).not.toHaveBeenCalled();
  });

  // 회귀 방지 — 평가 대상을 'DEFAULT' 로 지목하던 동안 추천이 실제로 매매하는 전략 계좌
  // (LONG_TERM / SWING) 의 스냅샷이 한 건도 적재되지 않았다. 계좌 이름을 task 가 알지 못하고
  // 전체를 훑는지(executeAll) 를 계약으로 고정한다.
  it('계좌 이름을 지정하지 않고 전체 계좌를 슬롯 거래일로 평가한다', async () => {
    const { task, evaluate } = createFixture();

    await task.run(context);

    expect(evaluate.executeAll).toHaveBeenCalledWith(
      new Date('2026-08-11T08:40:00.000Z'),
    );
  });

  it('계좌별 평가를 원장 감사와 Slack summaryText에 함께 남긴다', async () => {
    const { task, agentRun } = createFixture();

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('*[LONG_TERM]*');
    expect(result.summaryText).toContain('*[SWING]*');
    expect(agentRun.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.PAPER_TRADE,
        triggerType: TriggerType.AUTOPILOT_PAPER_TRADING_CRON,
        inputSnapshot: {
          taskId: 'paper-trading',
          firedAtKst: '2026-08-11',
        },
      }),
    );
    const run = agentRun.execute.mock.calls[0][0].run;
    const execution = await run({ agentRunId: 71 });
    expect(execution.modelUsed).toBe('deterministic');
    expect(execution.output).toEqual({
      accountCount: 2,
      failedCount: 0,
      accounts: [
        {
          accountName: 'LONG_TERM',
          positionCount: 1,
          staleTickerCount: 0,
          invariantViolationCount: 0,
          suspiciousJumpCount: 0,
          tradeDate: '2026-08-11',
          skipped: false,
          skipReason: null,
          failureReason: null,
        },
        {
          accountName: 'SWING',
          positionCount: 1,
          staleTickerCount: 0,
          invariantViolationCount: 0,
          suspiciousJumpCount: 0,
          tradeDate: '2026-08-11',
          skipped: false,
          skipReason: null,
          failureReason: null,
        },
      ],
      exitBandOrderCount: 0,
      exitBandAccounts: [],
    });
  });

  // 계좌가 없는 상태를 조용히 성공으로 남기면 성적표가 비어가는 것을 아무도 모른다.
  it('계좌가 0건이면 원장에 남기고 경고 summary를 반환한다', async () => {
    const { task, agentRun } = createFixture({ accounts: [] });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('평가할 가상 계좌가 없습니다');
    const run = agentRun.execute.mock.calls[0][0].run;
    const execution = await run({ agentRunId: 71 });
    expect(execution.output).toEqual({
      accountCount: 0,
      failedCount: 0,
      accounts: [],
      exitBandOrderCount: 0,
      exitBandAccounts: [],
    });
  });

  it('밴드 청산이 걸리면 카드와 원장에 예약 내역을 남긴다', async () => {
    const { task, exitBand } = createFixture();
    exitBand.execute.mockResolvedValue({
      createdCount: 1,
      accounts: [
        {
          accountName: 'LONG_TERM',
          created: 1,
          skippedByPendingSell: 0,
          skippedByNoPosition: 0,
          reasons: ['121440 익절 밴드 도달: 평가 손익률 5.26% (기준 +2% 이상)'],
        },
      ],
    });

    const result = await task.run(context);

    expect(result.summaryText).toContain(
      '청산 예약 — 다음 거래일 시가 매도 1건',
    );
    expect(result.summaryText).toContain('[LONG_TERM] 121440 익절 밴드 도달');
  });

  // 실패 계좌가 섞여 있어도 성공한 계좌의 청산은 그 회차에 걸려야 한다.
  // 뒤로 미루면 재시도가 실패하는 동안 손절선이 계속 열려 있는다.
  it('평가 실패로 던지기 전에 밴드를 먼저 적용한다', async () => {
    const { task, exitBand } = createFixture({
      accounts: [
        succeededEntry('LONG_TERM'),
        failedEntry('SWING', '시세 조회 실패'),
      ],
    });

    await expect(task.run(context)).rejects.toThrow('평가하지 못했습니다');
    expect(exitBand.execute).toHaveBeenCalledTimes(1);
  });

  // 부분 실패를 성공으로 반환하면 슬롯이 완주 처리되어 BullMQ 재시도가 돌지 않는다.
  // 스냅샷은 거래일 단위라 다음 슬롯이 그날 구멍을 메워주지 못한다.
  it('한 계좌만 실패해도 재시도되도록 실패로 올린다', async () => {
    const { task } = createFixture({
      accounts: [
        succeededEntry('LONG_TERM'),
        failedEntry('SWING', '시세 조회 실패'),
      ],
    });

    await expect(task.run(context)).rejects.toThrow(
      '가상 계좌 2개 중 1개를 평가하지 못했습니다 — SWING: 시세 조회 실패 (평가 완료: LONG_TERM)',
    );
  });

  it('모든 계좌가 실패하면 평가 완료 목록 없이 실패로 남긴다', async () => {
    const { task } = createFixture({
      accounts: [
        failedEntry('LONG_TERM', '시세 조회 실패'),
        failedEntry('SWING', '계좌 상태 불일치'),
      ],
    });

    await expect(task.run(context)).rejects.toThrow(
      '가상 계좌 2개 중 2개를 평가하지 못했습니다 — LONG_TERM: 시세 조회 실패 / SWING: 계좌 상태 불일치',
    );
  });

  // 계좌별 격리(한 계좌의 예외가 나머지 계좌의 평가·적재를 막지 않는 것)는
  // evaluate-paper-account.usecase.spec 의 executeAll 계약이 고정한다.

  it('스냅샷 미적재 사유를 계좌 섹션과 원장에 남긴다', async () => {
    const { task, agentRun } = createFixture({
      accounts: [
        succeededEntry('LONG_TERM', {
          ...EVALUATION,
          skipped: true,
          skipReason: '모든 보유 종목의 시세가 실행일보다 오래되었습니다.',
          positionValue: null,
          totalValue: null,
          returnRate: null,
        }),
      ],
    });

    const result = await task.run(context);

    expect(result.summaryText).toContain(
      '스냅샷 미적재 — 모든 보유 종목의 시세가 실행일보다 오래되었습니다.',
    );
    const run = agentRun.execute.mock.calls[0][0].run;
    const execution = await run({ agentRunId: 71 });
    expect(execution.output.accounts[0]).toEqual(
      expect.objectContaining({
        accountName: 'LONG_TERM',
        skipped: true,
        skipReason: '모든 보유 종목의 시세가 실행일보다 오래되었습니다.',
      }),
    );
  });
});
