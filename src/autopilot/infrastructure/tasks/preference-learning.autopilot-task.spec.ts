import { PreferenceLearningAutopilotTask } from './preference-learning.autopilot-task';

const buildConfig = (enabled: string | undefined) =>
  ({ get: jest.fn().mockReturnValue(enabled) }) as never;

// 실제 AgentRunService.execute 와 같은 계약으로 둔다 — run 콜백을 실행하고 그 result 를
// outcome.result 로 돌려주며, 콜백이 던진 예외는 그대로 전파한다(FAILED 마감 후 rethrow).
// 형태가 다르면 통과해도 실코드와 어긋난다.
const buildAgentRun = (
  execute = jest.fn(async ({ run }: { run: () => Promise<unknown> }) => {
    const { result } = (await run()) as { result: unknown };
    return { result };
  }),
) => ({ execute }) as never;

const ctx = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-05' };

describe('PreferenceLearningAutopilotTask', () => {
  it('게이트 OFF 면 skip', async () => {
    const task = new PreferenceLearningAutopilotTask(
      { collect: jest.fn() } as never,
      { infer: jest.fn() } as never,
      { findActive: jest.fn() } as never,
      { createPending: jest.fn(), countPendingSince: jest.fn() } as never,
      buildConfig('false'),
      buildAgentRun(),
    );
    expect(await task.run(ctx)).toEqual({ skip: true });
  });

  it('이번 주 PENDING 제안 있으면 skip', async () => {
    const task = new PreferenceLearningAutopilotTask(
      { collect: jest.fn() } as never,
      { infer: jest.fn() } as never,
      { findActive: jest.fn() } as never,
      {
        createPending: jest.fn(),
        countPendingSince: jest.fn().mockResolvedValue(1),
      } as never,
      buildConfig('true'),
      buildAgentRun(),
    );
    expect(await task.run(ctx)).toEqual({ skip: true });
  });

  it('신호 0 → infer 미호출, skip', async () => {
    const collect = jest.fn().mockResolvedValue([]);
    const infer = jest.fn();
    const task = new PreferenceLearningAutopilotTask(
      { collect } as never,
      { infer } as never,
      { findActive: jest.fn().mockResolvedValue(null) } as never,
      {
        createPending: jest.fn(),
        countPendingSince: jest.fn().mockResolvedValue(0),
      } as never,
      buildConfig('true'),
      buildAgentRun(),
    );
    expect(await task.run(ctx)).toEqual({ skip: true });
    expect(infer).not.toHaveBeenCalled();
  });

  it('diff 있으면 PENDING 생성 + preview 반환', async () => {
    const task = new PreferenceLearningAutopilotTask(
      {
        collect: jest
          .fn()
          .mockResolvedValue([
            { source: 'reaction', evidenceRef: 'r', observedText: 't' },
          ]),
      } as never,
      {
        infer: jest.fn().mockResolvedValue({
          diff: { tone: { add: ['간결'] } },
          rationale: 'r',
          modelUsed: 'codex-cli',
        }),
      } as never,
      {
        findActive: jest.fn().mockResolvedValue({ version: 2, profile: {} }),
      } as never,
      {
        createPending: jest.fn().mockResolvedValue(11),
        countPendingSince: jest.fn().mockResolvedValue(0),
      } as never,
      buildConfig('true'),
      buildAgentRun(),
    );
    const result = await task.run(ctx);
    expect(result.skip).toBe(false);
    expect(result.preview?.kind).toBe('PREFERENCE_PROFILE');
    expect(result.preview?.previewText).toContain('간결');
    expect((result.preview?.payload as { proposalId: number }).proposalId).toBe(
      11,
    );
  });

  it('infer 결과가 null 이면 skip', async () => {
    const task = new PreferenceLearningAutopilotTask(
      {
        collect: jest
          .fn()
          .mockResolvedValue([
            { source: 'reaction', evidenceRef: 'r', observedText: 't' },
          ]),
      } as never,
      { infer: jest.fn().mockResolvedValue(null) } as never,
      { findActive: jest.fn().mockResolvedValue(null) } as never,
      {
        createPending: jest.fn(),
        countPendingSince: jest.fn().mockResolvedValue(0),
      } as never,
      buildConfig('true'),
      buildAgentRun(),
    );
    expect(await task.run(ctx)).toEqual({ skip: true });
  });

  it('빈 diff 면 skip', async () => {
    const task = new PreferenceLearningAutopilotTask(
      {
        collect: jest
          .fn()
          .mockResolvedValue([
            { source: 'reaction', evidenceRef: 'r', observedText: 't' },
          ]),
      } as never,
      {
        infer: jest.fn().mockResolvedValue({
          diff: {},
          rationale: '변경 없음',
          modelUsed: 'codex-cli',
        }),
      } as never,
      { findActive: jest.fn().mockResolvedValue(null) } as never,
      {
        createPending: jest.fn(),
        countPendingSince: jest.fn().mockResolvedValue(0),
      } as never,
      buildConfig('true'),
      buildAgentRun(),
    );
    expect(await task.run(ctx)).toEqual({ skip: true });
  });

  // 원장 편입 회귀 — 이 워커는 모델을 부르면서도 agent_run 을 거치지 않아,
  // 추론이 죽은 주와 신호가 없던 주가 집계상 구분되지 않았다.
  describe('실행 원장 편입', () => {
    const buildTask = (
      infer: jest.Mock,
      execute: jest.Mock,
    ): PreferenceLearningAutopilotTask =>
      new PreferenceLearningAutopilotTask(
        {
          collect: jest
            .fn()
            .mockResolvedValue([
              { source: 'reaction', evidenceRef: 'r', observedText: 't' },
            ]),
        } as never,
        { infer } as never,
        {
          findActive: jest.fn().mockResolvedValue({ version: 3, profile: {} }),
        } as never,
        {
          createPending: jest.fn().mockResolvedValue(7),
          countPendingSince: jest.fn().mockResolvedValue(0),
        } as never,
        buildConfig('true'),
        buildAgentRun(execute) as never,
      );

    it('추론을 원장으로 감싸고 agentType·triggerType·slackUserId 를 남긴다', async () => {
      const execute = jest.fn(
        async ({ run }: { run: () => Promise<unknown> }) => {
          const { result } = (await run()) as { result: unknown };
          return { result };
        },
      );
      const task = buildTask(
        jest.fn().mockResolvedValue({
          diff: { tone: { add: ['간결'] } },
          rationale: 'r',
          modelUsed: 'codex-cli',
        }),
        execute,
      );

      const result = await task.run(ctx);

      expect(result.skip).toBe(false);
      expect(execute).toHaveBeenCalledTimes(1);
      const input = execute.mock.calls[0][0] as unknown as {
        agentType: string;
        triggerType: string;
        inputSnapshot: Record<string, unknown>;
      };
      expect(input.agentType).toBe('PREFERENCE_LEARNING');
      expect(input.triggerType).toBe('AUTOPILOT_PREFERENCE_LEARNING_CRON');
      // 사용자별 집계가 이 JSON path 로만 필터하므로 빠지면 그 표면에서 실행이 사라진다.
      expect(input.inputSnapshot.slackUserId).toBe('U1');
      expect(input.inputSnapshot.signalCount).toBe(1);
      expect(input.inputSnapshot.baseVersion).toBe(3);
    });

    it('추론 실패도 원장을 거친 뒤 skip 한다 — 조용히 사라지지 않는다', async () => {
      const execute = jest.fn(
        async ({ run }: { run: () => Promise<unknown> }) => {
          // 실제 execute 는 콜백 예외를 FAILED 로 마감한 뒤 다시 던진다.
          await run();
          return { result: null };
        },
      );
      const task = buildTask(jest.fn().mockResolvedValue(null), execute);

      expect(await task.run(ctx)).toEqual({ skip: true });
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('원장 output 에 diff 본문을 담지 않는다 — 제안 테이블과 중복 저장 방지', async () => {
      let captured: unknown;
      const execute = jest.fn(
        async ({ run }: { run: () => Promise<unknown> }) => {
          const outcome = (await run()) as { result: unknown; output: unknown };
          captured = outcome.output;
          return { result: outcome.result };
        },
      );
      const task = buildTask(
        jest.fn().mockResolvedValue({
          diff: { tone: { add: ['간결'] }, doNot: { add: ['금지'] } },
          rationale: '근거',
          modelUsed: 'codex-cli',
        }),
        execute,
      );

      await task.run(ctx);

      expect(captured).toEqual({
        rationale: '근거',
        diffKeys: ['tone', 'doNot'],
      });
      expect(JSON.stringify(captured)).not.toContain('간결');
    });
  });
});
