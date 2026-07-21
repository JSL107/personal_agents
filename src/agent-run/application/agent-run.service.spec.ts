import { AgentType } from '../../model-router/domain/model-router.type';
import { AgentRunStatus, TriggerType } from '../domain/agent-run.type';
import { AgentRunRepositoryPort } from '../domain/port/agent-run.repository.port';
import { AgentRunService } from './agent-run.service';

describe('AgentRunService', () => {
  const createRepoMock = (): jest.Mocked<AgentRunRepositoryPort> => ({
    begin: jest.fn(),
    finish: jest.fn(),
    updateParentId: jest.fn(),
    recordEvidence: jest.fn(),
    findLatestSucceededRun: jest.fn(),
    findRecentSucceededRuns: jest.fn(),
    aggregateQuotaStats: jest.fn(),
    findById: jest.fn(),
    findSimilarPlans: jest.fn().mockResolvedValue([]),
    findSucceededOutputsByIds: jest.fn().mockResolvedValue([]),
    aggregateRunStats: jest.fn().mockResolvedValue([]),
    aggregateRetryCounts: jest.fn().mockResolvedValue([]),
    aggregateSweptCounts: jest.fn().mockResolvedValue([]),
    sweepZombies: jest.fn().mockResolvedValue(0),
    aggregatePmContextStats: jest.fn().mockResolvedValue({
      pmRunCount: 0,
      totalInboxItems: 0,
      pmRunsWithInbox: 0,
      totalSimilarPlans: 0,
      pmRunsWithSimilar: 0,
    }),
    findChainFromRoot: jest.fn().mockResolvedValue([]),
    searchByKeyword: jest.fn().mockResolvedValue([]),
  });

  let repository: jest.Mocked<AgentRunRepositoryPort>;
  let service: AgentRunService;

  beforeEach(() => {
    repository = createRepoMock();
    service = new AgentRunService(repository);
    repository.begin.mockResolvedValue({ id: 42 });
  });

  it('성공 시 begin → run → finish(SUCCEEDED) 순서로 호출되고 outcome(result/modelUsed/agentRunId) 을 반환한다', async () => {
    // Given
    const plan = { topPriority: 'fix crawler bug' };

    // When
    const outcome = await service.execute({
      agentType: AgentType.PM,
      triggerType: TriggerType.SLACK_COMMAND_TODAY,
      inputSnapshot: { text: 'hi' },
      run: async () => ({
        result: plan,
        modelUsed: 'mock-chatgpt',
        output: plan,
      }),
    });

    // Then
    expect(outcome).toEqual({
      result: plan,
      modelUsed: 'mock-chatgpt',
      agentRunId: 42,
    });
    expect(repository.begin).toHaveBeenCalledWith({
      agentType: AgentType.PM,
      triggerType: TriggerType.SLACK_COMMAND_TODAY,
      inputSnapshot: { text: 'hi' },
    });
    expect(repository.finish).toHaveBeenCalledWith({
      id: 42,
      status: AgentRunStatus.SUCCEEDED,
      modelUsed: 'mock-chatgpt',
      output: plan,
      // OPS-1 Quota Pane — cliProvider 는 modelUsed 와 동일 값으로 기록, durationMs 는 측정값.
      cliProvider: 'mock-chatgpt',
      durationMs: expect.any(Number),
    });
  });

  it('evidence 입력은 각각 recordEvidence 로 저장된다', async () => {
    // Given
    const evidence = [
      {
        sourceType: 'slack_command',
        sourceId: 'U123',
        payload: { text: 'hi' },
      },
    ];

    // When
    await service.execute({
      agentType: AgentType.PM,
      triggerType: TriggerType.SLACK_COMMAND_TODAY,
      inputSnapshot: {},
      evidence,
      run: async () => ({ result: null, modelUsed: 'm', output: {} }),
    });

    // Then
    expect(repository.recordEvidence).toHaveBeenCalledWith({
      agentRunId: 42,
      sourceType: 'slack_command',
      sourceId: 'U123',
      payload: { text: 'hi' },
    });
  });

  it('recordEvidence 가 throw 하면 finish(FAILED) 로 마감한다 — IN_PROGRESS 고착 방지', async () => {
    // Given
    const boom = new Error('evidence persist 실패');
    repository.recordEvidence.mockRejectedValueOnce(boom);

    const runFn = jest.fn();

    // When / Then
    await expect(
      service.execute({
        agentType: AgentType.PM,
        triggerType: TriggerType.SLACK_COMMAND_TODAY,
        inputSnapshot: {},
        evidence: [{ sourceType: 'x', sourceId: 'y', payload: {} }],
        run: runFn,
      }),
    ).rejects.toBe(boom);

    expect(runFn).not.toHaveBeenCalled();
    expect(repository.finish).toHaveBeenCalledWith({
      id: 42,
      status: AgentRunStatus.FAILED,
      output: { error: 'evidence persist 실패' },
      // FAILED 경로도 가능한 만큼 duration 기록 — quota 분석 시 실패 비율 확인용.
      durationMs: expect.any(Number),
    });
  });

  it('run 이 throw 하면 finish(FAILED) 로 마감하고 에러를 재전파한다', async () => {
    // Given
    const bomb = new Error('boom');

    // When / Then
    await expect(
      service.execute({
        agentType: AgentType.PM,
        triggerType: TriggerType.SLACK_COMMAND_TODAY,
        inputSnapshot: {},
        run: async () => {
          throw bomb;
        },
      }),
    ).rejects.toBe(bomb);

    expect(repository.finish).toHaveBeenCalledWith({
      id: 42,
      status: AgentRunStatus.FAILED,
      output: { error: 'boom' },
      durationMs: expect.any(Number),
    });
  });

  it('execute 성공 시 episodic recorder.record 를 호출한다 (best-effort 적재)', async () => {
    const recorder = {
      record: jest.fn().mockResolvedValue(undefined),
      searchRelevant: jest.fn().mockResolvedValue([]),
    };
    const serviceWithRecorder = new AgentRunService(
      repository,
      recorder as never,
    );

    await serviceWithRecorder.execute({
      agentType: AgentType.PM,
      triggerType: TriggerType.SLACK_COMMAND_TODAY,
      inputSnapshot: { slackUserId: 'U1' },
      run: async () => ({
        result: 'r',
        modelUsed: 'codex-cli',
        output: { plan: 'x' },
      }),
    });

    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(recorder.record.mock.calls[0][0].kind).toBe('agent_run');
    expect(recorder.record.mock.calls[0][0].agentType).toBe(AgentType.PM);
  });

  it('recorder 미주입(undefined)이어도 execute 는 정상 동작한다', async () => {
    await expect(
      service.execute({
        agentType: AgentType.PM,
        triggerType: TriggerType.SLACK_COMMAND_TODAY,
        inputSnapshot: {},
        run: async () => ({ result: 'r', modelUsed: 'codex-cli', output: {} }),
      }),
    ).resolves.toMatchObject({ result: 'r' });
  });

  describe('findSimilarPlans — 의미검색 강화 + FTS fallback', () => {
    it('episodic 주입 시 의미검색 hit 을 agent_run 재조회로 SimilarPlanRow 복원', async () => {
      const recorder = {
        record: jest.fn(),
        searchRelevant: jest
          .fn()
          .mockResolvedValue([
            { id: 10, agentRunId: 42, score: 0.8, occurredAt: new Date() },
          ]),
      };
      repository.findSucceededOutputsByIds.mockResolvedValue([
        { id: 42, output: { plan: 'p' }, endedAt: new Date() },
      ]);
      const serviceWithEpisodic = new AgentRunService(
        repository,
        recorder as never,
      );

      const rows = await serviceWithEpisodic.findSimilarPlans({
        query: '결제',
        agentType: AgentType.PM,
        limit: 3,
      });

      expect(recorder.searchRelevant).toHaveBeenCalledTimes(1);
      expect(repository.findSimilarPlans).not.toHaveBeenCalled();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(42);
      expect(rows[0].rank).toBeCloseTo(0.8);
    });

    it('episodic 미주입 시 기존 FTS repository.findSimilarPlans 로 fallback', async () => {
      repository.findSimilarPlans.mockResolvedValue([
        { id: 1, output: {}, endedAt: new Date(), rank: 0.5 },
      ]);

      const rows = await service.findSimilarPlans({
        query: 'q',
        agentType: AgentType.PM,
        limit: 3,
      });

      expect(repository.findSimilarPlans).toHaveBeenCalledTimes(1);
      expect(rows[0].id).toBe(1);
    });
  });

  it('aggregateRunStats: repository 에 그대로 위임한다(untilDays 포함)', async () => {
    const rows = [
      {
        agentType: 'PM',
        total: 3,
        failed: 0,
        failRate: 0,
        avgDurationMs: 1000,
      },
    ];
    repository.aggregateRunStats.mockResolvedValue(rows);

    const result = await service.aggregateRunStats({
      sinceDays: 14,
      untilDays: 7,
    });

    expect(repository.aggregateRunStats).toHaveBeenCalledWith({
      sinceDays: 14,
      untilDays: 7,
    });
    expect(result).toBe(rows);
  });

  describe('findChainFromRoot — V3 chain audit walk facade', () => {
    it('rootRunId + default maxDepth(16) 으로 repository delegate, 결과 그대로 반환', async () => {
      const chain = [
        {
          id: 1,
          parentId: null,
          agentType: 'PM',
          status: AgentRunStatus.SUCCEEDED,
          startedAt: new Date('2026-05-28T10:00:00Z'),
          endedAt: new Date('2026-05-28T10:00:30Z'),
          depth: 0,
        },
        {
          id: 2,
          parentId: 1,
          agentType: 'CTO',
          status: AgentRunStatus.SUCCEEDED,
          startedAt: new Date('2026-05-28T10:00:31Z'),
          endedAt: new Date('2026-05-28T10:01:00Z'),
          depth: 1,
        },
      ];
      repository.findChainFromRoot.mockResolvedValue(chain);

      const result = await service.findChainFromRoot(1);

      expect(repository.findChainFromRoot).toHaveBeenCalledTimes(1);
      expect(repository.findChainFromRoot).toHaveBeenCalledWith({
        rootRunId: 1,
        maxDepth: 16,
      });
      expect(result).toBe(chain);
    });

    it('명시 maxDepth 전달 시 repository 호출에 그대로 반영', async () => {
      repository.findChainFromRoot.mockResolvedValue([]);

      await service.findChainFromRoot(99, 3);

      expect(repository.findChainFromRoot).toHaveBeenCalledWith({
        rootRunId: 99,
        maxDepth: 3,
      });
    });

    it('repository 가 빈 배열 반환 시 (root 존재 X) 그대로 빈 배열', async () => {
      repository.findChainFromRoot.mockResolvedValue([]);

      await expect(service.findChainFromRoot(404)).resolves.toEqual([]);
    });

    it('maxDepth 가 default(16) 보다 크면 clamp — DoS 방지 (security MEDIUM)', async () => {
      repository.findChainFromRoot.mockResolvedValue([]);

      await service.findChainFromRoot(1, 9999);

      expect(repository.findChainFromRoot).toHaveBeenCalledWith({
        rootRunId: 1,
        maxDepth: 16,
      });
    });

    it('maxDepth 가 음수/0 이면 최소 1 로 clamp', async () => {
      repository.findChainFromRoot.mockResolvedValue([]);

      await service.findChainFromRoot(1, -5);

      expect(repository.findChainFromRoot).toHaveBeenCalledWith({
        rootRunId: 1,
        maxDepth: 1,
      });
    });

    it('rootRunId / maxDepth 가 NaN/Infinity 면 repository 호출 X + 빈 배열', async () => {
      const a = await service.findChainFromRoot(Number.NaN, 5);
      const b = await service.findChainFromRoot(1, Number.POSITIVE_INFINITY);

      expect(a).toEqual([]);
      expect(b).toEqual([]);
      expect(repository.findChainFromRoot).not.toHaveBeenCalled();
    });
  });
});
