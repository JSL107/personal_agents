import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
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
  positionValue: '120000',
  totalValue: '920000',
  returnRate: '-8',
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
      config as unknown as ConfigService,
      agentRun as unknown as AgentRunService,
    ),
    evaluate,
    config,
    agentRun,
  };
};

describe('PaperTradingAutopilotTask', () => {
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
    });
  });

  it('일부 계좌가 실패해도 나머지 계좌 평가를 남긴다', async () => {
    const { task, agentRun } = createFixture({
      accounts: [
        succeededEntry('LONG_TERM'),
        failedEntry('SWING', '시세 조회 실패'),
      ],
    });

    const result = await task.run(context);

    expect(result.summaryText).toContain('*[LONG_TERM]*');
    expect(result.summaryText).toContain('평가 실패 — 시세 조회 실패');
    const run = agentRun.execute.mock.calls[0][0].run;
    const execution = await run({ agentRunId: 71 });
    expect(execution.output).toEqual(
      expect.objectContaining({ accountCount: 2, failedCount: 1 }),
    );
  });

  it('모든 계좌가 실패하면 원장에 실패로 남긴다', async () => {
    const { task } = createFixture({
      accounts: [
        failedEntry('LONG_TERM', '시세 조회 실패'),
        failedEntry('SWING', '계좌 상태 불일치'),
      ],
    });

    await expect(task.run(context)).rejects.toThrow(
      '가상 계좌 2개를 한 건도 평가하지 못했습니다 — LONG_TERM: 시세 조회 실패 / SWING: 계좌 상태 불일치',
    );
  });

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
