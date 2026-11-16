import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import {
  ClaimResult,
  ParamTuneRunPort,
  TuneRunRow,
} from '../../../param-tune/domain/port/param-tune-run.port';
import {
  ChildOutcome,
  ParamTuneChildLauncher,
} from '../../../param-tune/infrastructure/param-tune-child.launcher';
import { ParamTuneAutopilotTask } from './param-tune.autopilot-task';

// 2026-11-21 은 토요일 → 그 주 월요일은 11-16, 축은 순환 기준 첫 축(익절)이다.
const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-11-21' };

const claimed = (runId: number): ClaimResult => ({
  kind: 'CLAIMED',
  runId,
  attemptToken: `token-${runId}`,
});

const unnotified = (id: number): TuneRunRow =>
  ({
    id,
    weekStart: new Date('2026-11-16T00:00:00.000Z'),
    strategy: 'SWING',
    axis: 'EXIT_TAKE_PROFIT_PERCENT',
    status: 'DONE',
    decision: 'NO_CHANGE',
    decisionReason: '변화 없음',
    evaluation: null,
  }) as unknown as TuneRunRow;

const createFixture = (input?: {
  claims?: ClaimResult[];
  outcomes?: ChildOutcome[];
  unnotified?: TuneRunRow[];
}) => {
  const claims = [...(input?.claims ?? [claimed(1), claimed(2)])];
  const outcomes = [
    ...(input?.outcomes ?? [
      { kind: 'EXITED', code: 0, tail: '' },
      { kind: 'EXITED', code: 0, tail: '' },
    ]),
  ];
  const port = {
    claim: jest
      .fn<Promise<ClaimResult>, [{ strategy: string }]>()
      .mockImplementation(async () => claims.shift() as ClaimResult),
    markFailed: jest.fn().mockResolvedValue(true),
    findUnnotified: jest.fn().mockResolvedValue(input?.unnotified ?? []),
    markNotified: jest.fn().mockResolvedValue(undefined),
  };
  const launcher = {
    run: jest.fn(async () => outcomes.shift() as ChildOutcome),
  };
  const agentRun = {
    execute: jest.fn(async (executionInput) => {
      const execution = await executionInput.run({ agentRunId: 71 });
      return { result: execution.result, agentRunId: 71 };
    }),
  };
  return {
    task: new ParamTuneAutopilotTask(
      port as unknown as ParamTuneRunPort,
      launcher as unknown as ParamTuneChildLauncher,
      agentRun as unknown as AgentRunService,
    ),
    port,
    launcher,
    agentRun,
  };
};

describe('ParamTuneAutopilotTask', () => {
  it('SWING → LONG_TERM 순서로 선점하고 자식에게 인자를 넘긴다', async () => {
    const { task, port, launcher, agentRun } = createFixture();

    await task.run(context);

    expect(agentRun.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'INVEST',
        triggerType: 'AUTOPILOT_PARAM_TUNE_CRON',
        inputSnapshot: {
          weekStart: '2026-11-16',
          axis: 'EXIT_TAKE_PROFIT_PERCENT',
        },
      }),
    );
    expect(port.claim.mock.calls.map(([arg]) => arg.strategy)).toEqual([
      'SWING',
      'LONG_TERM',
    ]);
    expect(launcher.run).toHaveBeenNthCalledWith(1, {
      args: [
        '--run-id',
        '1',
        '--attempt-token',
        'token-1',
        '--strategy',
        'SWING',
        '--axis',
        'EXIT_TAKE_PROFIT_PERCENT',
        '--today',
        '2026-11-21',
        '--agent-run-id',
        '71',
      ],
      logPath: 'logs/param-tune/2026-11-16-SWING.log',
      timeoutMs: 3_600_000,
    });
  });

  it('이미 진행 중이거나 끝난 회차는 자식을 띄우지 않는다', async () => {
    const { task, launcher } = createFixture({
      claims: [
        { kind: 'ALREADY_RUNNING', runId: 1 },
        { kind: 'ALREADY_DONE', runId: 2 },
      ],
    });

    await task.run(context);

    expect(launcher.run).not.toHaveBeenCalled();
  });

  it('한 전략이 TIMEOUT 이면 그 행만 FAILED 로 적고 다음 전략을 돈다', async () => {
    const { task, port, launcher } = createFixture({
      outcomes: [
        { kind: 'TIMEOUT', tail: 'last line' },
        { kind: 'EXITED', code: 0, tail: '' },
      ],
    });

    await task.run(context);

    expect(port.markFailed).toHaveBeenCalledTimes(1);
    expect(port.markFailed).toHaveBeenCalledWith({
      runId: 1,
      attemptToken: 'token-1',
      reason: expect.stringContaining('last line'),
    });
    expect(launcher.run).toHaveBeenCalledTimes(2);
  });

  it('종료 코드가 0 이 아니면 tail 을 사유에 실어 FAILED 로 적는다', async () => {
    const { task, port } = createFixture({
      outcomes: [
        { kind: 'EXITED', code: 2, tail: 'boom' },
        { kind: 'EXITED', code: 0, tail: '' },
      ],
    });

    await task.run(context);

    expect(port.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 1,
        reason: expect.stringMatching(/2[\s\S]*boom/u),
      }),
    );
  });

  it('SPAWN_FAILED 는 남은 전략도 마킹한 뒤 한 번 throw 한다', async () => {
    const { task, port, launcher } = createFixture({
      outcomes: [
        { kind: 'SPAWN_FAILED', message: 'ENOENT' },
        { kind: 'SPAWN_FAILED', message: 'ENOENT' },
      ],
    });

    await expect(task.run(context)).rejects.toThrow(/ENOENT/u);

    expect(launcher.run).toHaveBeenCalledTimes(2);
    expect(port.markFailed).toHaveBeenCalledTimes(2);
  });

  it('알릴 행이 없으면 emptyReason 과 함께 skip 한다', async () => {
    const { task } = createFixture({ unnotified: [] });

    await expect(task.run(context)).resolves.toEqual({
      skip: true,
      emptyReason: '이번 주 알릴 자동 조정 없음',
    });
  });

  it('알릴 행이 있으면 요약을 내고 발송 뒤에만 알림 처리한다', async () => {
    const { task, port } = createFixture({
      unnotified: [unnotified(5), unnotified(6)],
    });

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('*투자 파라미터 자동 조정*');
    expect(port.markNotified).not.toHaveBeenCalled();

    await result.onDelivered?.();

    expect(port.markNotified).toHaveBeenCalledWith([5, 6], expect.any(Date));
  });
});
