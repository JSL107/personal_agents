import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  ApplyIntradayStopResult,
  ApplyIntradayStopUsecase,
} from '../../../paper-trading/application/apply-intraday-stop.usecase';
import { PaperIntradayStopAutopilotTask } from './paper-intraday-stop.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-11' };

const resultOf = (
  overrides: Partial<ApplyIntradayStopResult> = {},
): ApplyIntradayStopResult => ({
  window: 'TRADING',
  accountCount: 2,
  inspectedCount: 2,
  priceErrorCount: 0,
  notTradedCount: 0,
  fillFailureCount: 0,
  accountFailures: [],
  decidedCount: 0,
  filledCount: 0,
  fills: [],
  skippedByPendingSell: 0,
  skippedByNoPosition: 0,
  accountFailureCount: 0,
  ...overrides,
});

const createFixture = (input?: {
  enabled?: string;
  result?: ApplyIntradayStopResult;
}) => {
  const applyIntradayStop = {
    execute: jest.fn().mockResolvedValue(input?.result ?? resultOf()),
  };
  const config = {
    get: jest.fn().mockReturnValue(input?.enabled ?? 'true'),
  };
  let executionOutput: unknown;
  const agentRun = {
    execute: jest.fn(async (executionInput) => {
      const execution = await executionInput.run({ agentRunId: 83 });
      executionOutput = execution;
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 83,
      };
    }),
  };
  return {
    task: new PaperIntradayStopAutopilotTask(
      applyIntradayStop as unknown as ApplyIntradayStopUsecase,
      config as unknown as ConfigService,
      agentRun as unknown as AgentRunService,
    ),
    applyIntradayStop,
    agentRun,
    getExecutionOutput: () => executionOutput,
  };
};

describe('PaperIntradayStopAutopilotTask', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('게이트가 true가 아니면 usecase와 AgentRun을 호출하지 않는다', async () => {
    const { task, applyIntradayStop, agentRun } = createFixture({
      enabled: 'false',
    });

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(applyIntradayStop.execute).not.toHaveBeenCalled();
    expect(agentRun.execute).not.toHaveBeenCalled();
  });

  it('장 시작 전이면 의도적 skip 사유를 반환한다', async () => {
    const { task } = createFixture({
      result: resultOf({ window: 'BEFORE_OPEN' }),
    });

    await expect(task.run(context)).resolves.toEqual({
      skip: true,
      summaryText: '장중 손절 시간 창 이전 — 주문 미처리',
    });
  });

  it('장 마감 뒤면 의도적 skip 사유를 반환한다', async () => {
    const { task } = createFixture({
      result: resultOf({ window: 'AFTER_CLOSE' }),
    });

    await expect(task.run(context)).resolves.toEqual({
      skip: true,
      summaryText: '장중 손절 시간 창 종료 — 주문 미처리',
    });
  });

  it('체결·조회 실패·판정이 모두 0건이면 조용히 skip한다', async () => {
    const { task } = createFixture({
      result: resultOf({
        filledCount: 0,
        priceErrorCount: 0,
        notTradedCount: 0,
        fillFailureCount: 0,
        accountFailures: [],
        decidedCount: 0,
      }),
    });

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  // 공휴일에는 전 종목이 오늘 봉을 못 받아 실패로 잡힌다. 이 회차를 알리면 휴장일마다
  // 5분 간격으로 같은 카드가 70장 나간다.
  it('판정에 성공한 종목이 하나도 없으면 휴장으로 보고 조용히 skip한다', async () => {
    const { task } = createFixture({
      result: resultOf({ inspectedCount: 0, notTradedCount: 4 }),
    });

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  // 반대로 일부만 실패한 회차는 진짜 부분 장애라 알려야 한다.
  it('일부 종목만 조회에 실패하면 카드를 낸다', async () => {
    const { task } = createFixture({
      result: resultOf({ inspectedCount: 2, priceErrorCount: 1 }),
    });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('시세 조회 실패 1건');
  });

  // 계좌 실패까지 조용한 skip 에 묶이면, 예외를 삼킨 회차가 "손절 0건" 과 구분되지 않는다.
  it('체결이 없어도 계좌 처리 실패가 있으면 카드를 낸다', async () => {
    const { task } = createFixture({
      result: resultOf({
        accountFailureCount: 2,
        accountFailures: [
          { accountName: 'SWING', reason: 'db down' },
          { accountName: 'LONG_TERM', reason: 'timeout' },
        ],
      }),
    });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain(
      '계좌 2개는 처리 중 오류로 건너뛰었습니다',
    );
    // 건수만 남기면 원장을 봐도 무엇을 볼지 알 수 없다.
    expect(result.summaryText).toContain('SWING: db down');
    expect(result.summaryText).toContain('LONG_TERM: timeout');
  });

  it('체결 내역을 raw 계좌명과 escape된 종목명으로 정확히 포맷한다', async () => {
    const { task } = createFixture({
      result: resultOf({
        decidedCount: 2,
        filledCount: 2,
        fills: [
          {
            accountName: 'SWING',
            tickerCode: '008930',
            tickerName: '한미사이언스',
            quantity: '32',
            price: '46100.4',
            returnRatePercent: -18.275,
          },
          {
            accountName: 'LONG<&>',
            tickerCode: '020120',
            tickerName: '키다리<스튜디오>',
            quantity: '1358',
            price: '4900',
            returnRatePercent: -7.55,
          },
        ],
      }),
    });

    await expect(task.run(context)).resolves.toEqual({
      skip: false,
      summaryText:
        '*장중 손절* — 2건 청산\n' +
        ' • [SWING] 008930 한미사이언스 32주 @ 46,100원 (-18.28%)\n' +
        ' • [LONG<&>] 020120 키다리&lt;스튜디오&gt; 1,358주 @ 4,900원 (-7.55%)',
    });
  });

  it('시세 조회 실패가 있으면 다음 회차 재시도 문구를 덧붙인다', async () => {
    const { task } = createFixture({
      result: resultOf({ priceErrorCount: 3 }),
    });

    await expect(task.run(context)).resolves.toEqual({
      skip: false,
      summaryText:
        '*장중 손절* — 0건 청산\n' +
        ' • 시세 조회 실패 3건 — 시세 공급자 쪽 문제일 수 있습니다. 그 종목은 이번 회차에 손절 판정을 받지 못했습니다',
    });
  });

  it('손절 판정은 났지만 체결되지 않았으면 skip하지 않는다', async () => {
    const { task } = createFixture({
      result: resultOf({
        decidedCount: 2,
        filledCount: 0,
        skippedByPendingSell: 1,
        skippedByNoPosition: 1,
      }),
    });

    await expect(task.run(context)).resolves.toEqual({
      skip: false,
      summaryText:
        '*장중 손절* — 0건 청산\n' +
        ' • 손절 판정 후 미체결 2건 — 기존 매도 주문 대기 1건 · 보유 수량 없음 1건',
    });
  });

  it('skip 사유로 설명되지 않는 미체결도 보조 라인에 남긴다', async () => {
    const { task } = createFixture({
      result: resultOf({
        decidedCount: 3,
        filledCount: 0,
        skippedByPendingSell: 1,
        skippedByNoPosition: 1,
      }),
    });

    await expect(task.run(context)).resolves.toEqual({
      skip: false,
      summaryText:
        '*장중 손절* — 0건 청산\n' +
        ' • 손절 판정 후 미체결 3건 — 기존 매도 주문 대기 1건 · 보유 수량 없음 1건 · 기타 체결 미완료 1건',
    });
  });

  it('실행 시각과 AgentRun input/output 계약을 정확히 지킨다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T02:34:56.000Z'));
    const applyResult = resultOf({
      inspectedCount: 7,
      priceErrorCount: 2,
      decidedCount: 3,
      filledCount: 1,
      skippedByPendingSell: 1,
      skippedByNoPosition: 1,
      fills: [
        {
          accountName: 'SWING',
          tickerCode: '008930',
          tickerName: '한미사이언스',
          quantity: '32',
          price: '46100',
          returnRatePercent: -18.28,
        },
      ],
    });
    const { task, applyIntradayStop, agentRun, getExecutionOutput } =
      createFixture({ result: applyResult });

    await task.run(context);

    expect(applyIntradayStop.execute).toHaveBeenCalledWith({
      executedAt: new Date('2026-08-12T02:34:56.000Z'),
      agentRunId: 83,
    });
    const executionInput = agentRun.execute.mock.calls[0][0];
    expect(executionInput.agentType).toBe(AgentType.PAPER_TRADE);
    expect(executionInput.triggerType).toBe(
      TriggerType.AUTOPILOT_PAPER_INTRADAY_STOP_CRON,
    );
    expect(executionInput.inputSnapshot).toEqual({
      taskId: 'paper-intraday-stop',
      firedAtKst: '2026-08-11',
    });
    expect(getExecutionOutput()).toEqual({
      result: {
        skip: false,
        summaryText:
          '*장중 손절* — 1건 청산\n' +
          ' • [SWING] 008930 한미사이언스 32주 @ 46,100원 (-18.28%)\n' +
          ' • 시세 조회 실패 2건 — 시세 공급자 쪽 문제일 수 있습니다. 그 종목은 이번 회차에 손절 판정을 받지 못했습니다\n' +
          ' • 손절 판정 후 미체결 2건 — 기존 매도 주문 대기 1건 · 보유 수량 없음 1건',
      },
      modelUsed: 'deterministic',
      output: {
        inspectedCount: 7,
        priceErrorCount: 2,
        notTradedCount: 0,
        decidedCount: 3,
        filledCount: 1,
        fillFailureCount: 0,
        skippedByPendingSell: 1,
        skippedByNoPosition: 1,
        accountFailureCount: 0,
        accountFailures: [],
      },
    });
  });
});
