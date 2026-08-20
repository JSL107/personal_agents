import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import { ConsoleAgentState } from '../../console/domain/console.type';
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
    findChainRootsInWindow: jest.fn().mockResolvedValue([]),
    searchByKeyword: jest.fn().mockResolvedValue([]),
    findActiveRuns: jest.fn().mockResolvedValue([]),
    findLatestSweepReview: jest.fn().mockResolvedValue(null),
    countUnsuccessfulSweepReviews: jest.fn().mockResolvedValue(0),
    findRecentlyFinishedRuns: jest.fn().mockResolvedValue([]),
    findFailedRunsSince: jest.fn().mockResolvedValue([]),
    aggregateSucceededCounts: jest.fn().mockResolvedValue([]),
    countSucceededSince: jest.fn().mockResolvedValue([]),
    countFailedSince: jest.fn().mockResolvedValue(0),
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
    // contractViolations 는 직무 계약 검수 결과라 계약이 바뀌면 값도 바뀐다.
    // 이 테스트의 관심사는 라이프사이클 순서이므로 나머지 인자만 고정한다.
    // (검수 결과 전달 자체는 아래 두 테스트가 검증한다.)
    expect(repository.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 42,
        status: AgentRunStatus.SUCCEEDED,
        modelUsed: 'mock-chatgpt',
        output: plan,
        // OPS-1 Quota Pane — cliProvider 는 modelUsed 와 동일 값으로 기록, durationMs 는 측정값.
        cliProvider: 'mock-chatgpt',
        durationMs: expect.any(Number),
      }),
    );
  });

  it('계약을 지킨 산출물은 contractViolations 없이 마감한다', async () => {
    // PM 계약: topPriority / morning / afternoon + 근거 요구.
    const plan = {
      topPriority: 'PR #195 마감',
      morning: '오전 계획',
      afternoon: '오후 계획',
    };

    await service.execute({
      agentType: AgentType.PM,
      triggerType: TriggerType.SLACK_COMMAND_TODAY,
      inputSnapshot: { text: 'hi' },
      run: async () => ({ result: plan, modelUsed: 'mock', output: plan }),
    });

    expect(repository.finish).toHaveBeenCalledWith(
      expect.objectContaining({ contractViolations: undefined }),
    );
  });

  it('계약 위반은 기록하되 실행 상태는 SUCCEEDED 로 둔다 (관측 모드)', async () => {
    // afternoon 누락 + 근거 없음.
    const plan = { topPriority: '근거 없는 과제', morning: '오전' };

    await service.execute({
      agentType: AgentType.PM,
      triggerType: TriggerType.SLACK_COMMAND_TODAY,
      inputSnapshot: { text: 'hi' },
      run: async () => ({ result: plan, modelUsed: 'mock', output: plan }),
    });

    expect(repository.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: AgentRunStatus.SUCCEEDED,
        contractViolations: [
          { rule: 'missingField', detail: 'afternoon' },
          { rule: 'noEvidence', detail: AgentType.PM },
        ],
      }),
    );
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

  describe('콘솔 이벤트 emit', () => {
    const buildBus = () =>
      ({ publish: jest.fn(), stream: jest.fn() }) as unknown as jest.Mocked<
        Pick<ConsoleEventBus, 'publish' | 'stream'>
      >;

    it('성공 시 run.started→state.changed(IN_PROGRESS)→run.finished→state.changed(COMPLETED) 순 발행', async () => {
      const bus = buildBus();
      const serviceWithBus = new AgentRunService(
        repository,
        undefined,
        bus as unknown as ConsoleEventBus,
      );

      await serviceWithBus.execute({
        agentType: AgentType.PM,
        triggerType: TriggerType.SLACK_COMMAND_TODAY,
        inputSnapshot: {},
        run: async () => ({ result: 'r', modelUsed: 'm', output: {} }),
      });

      const events = bus.publish.mock.calls.map((call) => call[0]);
      expect(events.map((event) => event.type)).toEqual([
        'run.started',
        'state.changed',
        'run.finished',
        'state.changed',
      ]);
      const started = events[0];
      expect(started).toMatchObject({
        type: 'run.started',
        run: { id: '42', agentType: 'PM', status: 'IN_PROGRESS' },
      });
      const stateEvents = events.filter(
        (event) => event.type === 'state.changed',
      );
      expect(stateEvents[0]).toMatchObject({
        agentType: 'PM',
        state: ConsoleAgentState.IN_PROGRESS,
      });
      expect(stateEvents[1]).toMatchObject({
        state: ConsoleAgentState.COMPLETED,
      });
    });

    it('실패 시 run.finished(FAILED) + state.changed(FAILED) 발행 후 에러 재전파', async () => {
      const bus = buildBus();
      const serviceWithBus = new AgentRunService(
        repository,
        undefined,
        bus as unknown as ConsoleEventBus,
      );

      await expect(
        serviceWithBus.execute({
          agentType: AgentType.PM,
          triggerType: TriggerType.SLACK_COMMAND_TODAY,
          inputSnapshot: {},
          run: async () => {
            throw new Error('boom');
          },
        }),
      ).rejects.toThrow('boom');

      const events = bus.publish.mock.calls.map((call) => call[0]);
      expect(events.map((event) => event.type)).toEqual([
        'run.started',
        'state.changed',
        'run.finished',
        'state.changed',
      ]);
      const finished = events.find((event) => event.type === 'run.finished');
      expect(finished).toMatchObject({ run: { status: 'FAILED' } });
      const lastState = events
        .filter((event) => event.type === 'state.changed')
        .pop();
      expect(lastState).toMatchObject({ state: ConsoleAgentState.FAILED });
    });

    it('consoleEvents 미주입이어도 execute 는 정상 동작한다', async () => {
      await expect(
        service.execute({
          agentType: AgentType.PM,
          triggerType: TriggerType.SLACK_COMMAND_TODAY,
          inputSnapshot: {},
          run: async () => ({ result: 'r', modelUsed: 'm', output: {} }),
        }),
      ).resolves.toMatchObject({ result: 'r' });
    });

    it('sweepZombies 는 좀비 런마다 run.finished(FAILED)+state.changed(FAILED) 발행 후 정리 건수 반환', async () => {
      const bus = buildBus();
      const zombie = {
        id: 55,
        agentType: 'PM',
        status: 'IN_PROGRESS',
        parentId: null,
        startedAt: new Date(Date.now() - 40 * 60 * 1000), // 40분 전(좀비)
        endedAt: null,
        triggerType: 'SLACK_COMMAND_TODAY',
        inputSnapshot: null,
      };
      const fresh = {
        id: 56,
        agentType: 'CTO',
        status: 'IN_PROGRESS',
        parentId: null,
        startedAt: new Date(Date.now() - 5 * 60 * 1000), // 5분 전(정상)
        endedAt: null,
        triggerType: 'SLACK_COMMAND_TODAY',
        inputSnapshot: null,
      };
      repository.findActiveRuns.mockResolvedValue([zombie, fresh]);
      repository.sweepZombies.mockResolvedValue(1);
      const serviceWithBus = new AgentRunService(
        repository,
        undefined,
        bus as unknown as ConsoleEventBus,
      );

      const count = await serviceWithBus.sweepZombies({ olderThanMinutes: 30 });

      expect(count).toBe(1);
      const events = bus.publish.mock.calls.map((call) => call[0]);
      expect(events.map((event) => event.type)).toEqual([
        'run.finished',
        'state.changed',
      ]);
      // 좀비(PM)에만 finished+state 이벤트 — 임계 이내 정상 런(CTO)은 제외.
      const finished = events.find((event) => event.type === 'run.finished');
      expect(finished).toMatchObject({
        run: { id: '55', agentType: 'PM', status: 'FAILED' },
      });
      const stateChanged = events.find(
        (event) => event.type === 'state.changed',
      );
      expect(stateChanged).toMatchObject({
        agentType: 'PM',
        state: ConsoleAgentState.FAILED,
      });
      const ctoTouched = events.some(
        (event) =>
          event.type === 'state.changed' &&
          (event as { agentType: string }).agentType === 'CTO',
      );
      expect(ctoTouched).toBe(false);
    });
  });

  describe('findActiveRuns — 콘솔 관제용 활성 런 조회', () => {
    it('repository.findActiveRuns 에 위임하고 결과를 그대로 반환한다', async () => {
      const active = [
        {
          id: 1,
          agentType: 'PM',
          status: 'IN_PROGRESS',
          parentId: null,
          startedAt: new Date('2026-07-27T00:00:00Z'),
          endedAt: null,
          triggerType: 'SLACK_COMMAND_TODAY',
          inputSnapshot: null,
        },
      ];
      repository.findActiveRuns.mockResolvedValue(active);

      const result = await service.findActiveRuns();

      expect(repository.findActiveRuns).toHaveBeenCalledTimes(1);
      expect(result).toBe(active);
    });
  });

  describe('findLatestSweepReview — PR 리뷰 루프 PR 당 리뷰 1회(쿨다운 재시도) 판정 근거', () => {
    it('repository.findLatestSweepReview 에 그대로 위임한다', async () => {
      const latest = {
        status: 'FAILED',
        startedAt: new Date('2026-07-31T00:00:00Z'),
        dryRun: false,
      };
      repository.findLatestSweepReview.mockResolvedValue(latest);

      const result = await service.findLatestSweepReview({
        prRef: 'JSL107/personal_agents#180',
        sinceDays: 30,
      });

      expect(repository.findLatestSweepReview).toHaveBeenCalledWith({
        prRef: 'JSL107/personal_agents#180',
        sinceDays: 30,
      });
      expect(result).toBe(latest);
    });

    it('레코드가 없으면 null 을 그대로 반환한다', async () => {
      repository.findLatestSweepReview.mockResolvedValue(null);

      const result = await service.findLatestSweepReview({
        prRef: 'JSL107/personal_agents#181',
        sinceDays: 30,
      });

      expect(result).toBeNull();
    });
  });

  describe('countUnsuccessfulSweepReviews — PR 리뷰 스윕 재시도 예산 판정 근거', () => {
    it('repository.countUnsuccessfulSweepReviews 에 그대로 위임한다', async () => {
      repository.countUnsuccessfulSweepReviews.mockResolvedValue(2);

      const result = await service.countUnsuccessfulSweepReviews({
        prRef: 'JSL107/personal_agents#180',
        sinceHours: 24,
      });

      expect(repository.countUnsuccessfulSweepReviews).toHaveBeenCalledWith({
        prRef: 'JSL107/personal_agents#180',
        sinceHours: 24,
      });
      expect(result).toBe(2);
    });
  });
});
