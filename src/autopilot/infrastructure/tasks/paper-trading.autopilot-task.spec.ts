import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  EvaluateAccountResult,
  EvaluatePaperAccountUsecase,
} from '../../../paper-trading/application/evaluate-paper-account.usecase';
import { formatPaperTradingReport } from '../../../paper-trading/infrastructure/paper-trading.formatter';
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

const createFixture = (input?: {
  enabled?: string;
  evaluation?: EvaluateAccountResult;
  evaluationError?: Error;
}) => {
  const evaluate = {
    execute: input?.evaluationError
      ? jest.fn().mockRejectedValue(input.evaluationError)
      : jest.fn().mockResolvedValue(input?.evaluation ?? EVALUATION),
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
    expect(evaluate.execute).not.toHaveBeenCalled();
    expect(agentRun.execute).not.toHaveBeenCalled();
  });

  it('평가 결과를 원장 감사 요약과 Slack summaryText에 함께 남긴다', async () => {
    const { task, agentRun } = createFixture();

    const result = await task.run(context);

    expect(result).toEqual({
      skip: false,
      summaryText: formatPaperTradingReport(EVALUATION),
    });
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
    await expect(run({ agentRunId: 71 })).resolves.toEqual({
      result: {
        skip: false,
        summaryText: formatPaperTradingReport(EVALUATION),
      },
      modelUsed: 'deterministic',
      output: {
        positionCount: 1,
        staleTickerCount: 0,
        invariantViolationCount: 0,
        suspiciousJumpCount: 0,
        tradeDate: '2026-08-11',
        skipped: false,
        skipReason: null,
      },
    });
  });

  it('포지션 0건 실행도 원장에 기록하고 보유 없음 summary를 반환한다', async () => {
    const evaluation = {
      ...EVALUATION,
      cashBalance: '1000000',
      positionValue: '0',
      totalValue: '1000000',
      returnRate: '0',
      positions: [],
      positionCount: 0,
    };
    const { task, agentRun } = createFixture({ evaluation });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('_보유 없음_');
    const run = agentRun.execute.mock.calls[0][0].run;
    const execution = await run({ agentRunId: 71 });
    expect(execution.output).toEqual(
      expect.objectContaining({ positionCount: 0, skipped: false }),
    );
  });

  it('스냅샷 미적재 실행도 차단 사유를 원장과 Slack에 남긴다', async () => {
    const evaluation = {
      ...EVALUATION,
      skipped: true,
      skipReason: '모든 보유 종목의 시세가 실행일보다 오래되었습니다.',
      positionValue: null,
      totalValue: null,
      returnRate: null,
    };
    const { task, agentRun } = createFixture({ evaluation });

    const result = await task.run(context);

    expect(result).toEqual(
      expect.objectContaining({
        skip: false,
        summaryText: expect.stringContaining(
          '스냅샷 미적재 — 모든 보유 종목의 시세가 실행일보다 오래되었습니다.',
        ),
      }),
    );
    const run = agentRun.execute.mock.calls[0][0].run;
    const execution = await run({ agentRunId: 71 });
    expect(execution.output).toEqual(
      expect.objectContaining({
        skipped: true,
        skipReason: '모든 보유 종목의 시세가 실행일보다 오래되었습니다.',
      }),
    );
  });

  it('평가 usecase 예외를 원장 execute 안에서 전파한다', async () => {
    const error = new Error('시세 조회 실패');
    const { task, agentRun } = createFixture({ evaluationError: error });

    await expect(task.run(context)).rejects.toThrow('시세 조회 실패');
    expect(agentRun.execute).toHaveBeenCalledTimes(1);
  });
});
