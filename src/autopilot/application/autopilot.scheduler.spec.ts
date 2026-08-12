import { AutopilotScheduler, isLowFrequencyCron } from './autopilot.scheduler';

const makeQueue = () => ({
  add: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
});

describe('AutopilotScheduler', () => {
  it.each([
    ['0 17 * * 5', true],
    ['0 18 * * 0', true],
    ['0 9 * * 6', true],
    ['0 9 * * 1', true],
    ['0 10 * * 0', true],
    ['0 11 * * 0', true],
    ['0 12 * * 0', true],
    ['0 9 1 * *', true],
    ['30 8 * * *', false],
    ['0 19 * * *', false],
    ['0 13 * * *', false],
    ['10 17 * * 1-5', false],
    ['0 18 * * 1-5', false],
    ['30 16 * * 1-5', false],
    ['*/3 * * * *', false],
    ['*/10 * * * *', false],
    ['50 * * * *', false],
    ['0 0 17 * * 5', true],
    ['0 */3 * * * *', false],
    ['0 17 * *', false],
  ])('cron "%s"의 저빈도 판별값은 %s이다', (pattern, expected) => {
    expect(isLowFrequencyCron(pattern)).toBe(expected);
  });

  it('owner 미설정 → 등록 0 + cleanup 호출', async () => {
    const queue = makeQueue();
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();
    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.getRepeatableJobs).toHaveBeenCalled();
  });

  it('owner 설정 → 그룹당 1 repeatable 등록(jobName=groupKey)', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    // 각 그룹당 1번씩 queue.add 호출 — entry 수가 아닌 그룹 수.
    const addCalls: string[] = queue.add.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    // 동일 groupKey 로 중복 등록 없음 (그룹당 exactly 1).
    const unique = new Set(addCalls);
    expect(unique.size).toBe(addCalls.length);
    // SP4: evening(daily-eval+work-reviewer) + morning + noon(assign+po-shadow)
    //   + weekly-summary + ceo-meta + impact-report
    //   + run-retro(주간 실행 회고, 단독 그룹) + knowledge-lint(주간 무결성 점검, 단독 그룹)
    //   + docs-sync-audit + preference-learning + run-sweeper + preview-sweeper + ops-supervisor
    //   + stock-monitor + paper-trading + universe-sweep + stock-monitor-us + stock-alert-scoring + pr-review-sweep
    //   + ai-cli-env-snapshot + ai-cli-env-apply = 21그룹.
    expect(queue.add).toHaveBeenCalledTimes(21);
    expect(addCalls).toContain('evening');
    expect(addCalls).toContain('morning');
    expect(addCalls).toContain('noon');
    expect(addCalls).toContain('weekly-summary');
    expect(addCalls).toContain('ceo-meta');
    expect(addCalls).toContain('impact-report');
    expect(addCalls).toContain('run-retro');
    expect(addCalls).toContain('knowledge-lint');
    expect(addCalls).toContain('docs-sync-audit');
    expect(addCalls).toContain('preference-learning');
    expect(addCalls).toContain('run-sweeper');
    expect(addCalls).toContain('preview-sweeper');
    expect(addCalls).toContain('ops-supervisor');
    expect(addCalls).toContain('stock-monitor');
    expect(addCalls).toContain('paper-trading');
    expect(addCalls).toContain('universe-sweep');
    expect(addCalls).toContain('stock-monitor-us');
    expect(addCalls).toContain('stock-alert-scoring');
    expect(addCalls).toContain('pr-review-sweep');
    expect(addCalls).toContain('ai-cli-env-snapshot');
    expect(addCalls).toContain('ai-cli-env-apply');
  });

  it('evening 그룹 스케줄은 첫 항목(work-reviewer) env 기반 → 19:00', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    const eveningCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'evening',
    );
    expect(eveningCall).toBeDefined();
    expect(eveningCall[2]).toMatchObject({
      repeat: { pattern: '0 19 * * *', tz: 'Asia/Seoul' },
    });
  });

  it('morning 그룹 등록 확인 — jobName="morning", schedule=08:30', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    const morningCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'morning',
    );
    expect(morningCall).toBeDefined();
    expect(morningCall[2]).toMatchObject({
      repeat: { pattern: '30 8 * * *', tz: 'Asia/Seoul' },
    });
  });

  it('주간 그룹은 시간 단위 재시도 옵션으로 등록한다', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    const weeklySummaryCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'weekly-summary',
    );
    expect(weeklySummaryCall).toBeDefined();
    expect(weeklySummaryCall[2]).toMatchObject({
      attempts: 4,
      backoff: { type: 'exponential', delay: 1_800_000 },
    });
  });

  it('일간 그룹은 기존 재시도 옵션으로 등록한다', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    const morningCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'morning',
    );
    expect(morningCall).toBeDefined();
    expect(morningCall[2]).toMatchObject({
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });
  });

  it('첫 항목 schedule override의 resolved cron으로 repeat와 재시도 정책을 등록한다', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AUTOPILOT_OWNER_SLACK_USER_ID') {
          return 'U1';
        }
        if (key === 'AUTOPILOT_WEEKLY_SUMMARY_SCHEDULE') {
          return '0 17 * * *';
        }
        return undefined;
      }),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);
    await scheduler.onApplicationBootstrap();

    const weeklySummaryCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'weekly-summary',
    );
    expect(weeklySummaryCall).toBeDefined();
    expect(weeklySummaryCall[2]).toMatchObject({
      repeat: { pattern: '0 17 * * *', tz: 'Asia/Seoul' },
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });
  });

  it('AI CLI 환경 태스크는 계약 전용 cron/timezone 키를 우선 적용한다', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'AUTOPILOT_OWNER_SLACK_USER_ID') {
          return 'U1';
        }
        if (key === 'AI_CLI_ENV_SNAPSHOT_CRON') {
          return '15 18 * * 5';
        }
        if (key === 'AI_CLI_ENV_SNAPSHOT_TIMEZONE') {
          return 'America/New_York';
        }
        if (key === 'AI_CLI_ENV_APPLY_CRON') {
          return '30 11 * * *';
        }
        if (key === 'AI_CLI_ENV_APPLY_TIMEZONE') {
          return 'Europe/London';
        }
        return undefined;
      }),
    };
    const scheduler = new AutopilotScheduler(queue as never, config as never);

    await scheduler.onApplicationBootstrap();

    const snapshotCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'ai-cli-env-snapshot',
    );
    const applyCall = queue.add.mock.calls.find(
      (call: unknown[]) => call[0] === 'ai-cli-env-apply',
    );
    expect(snapshotCall?.[2]).toMatchObject({
      repeat: { pattern: '15 18 * * 5', tz: 'America/New_York' },
    });
    expect(applyCall?.[2]).toMatchObject({
      repeat: { pattern: '30 11 * * *', tz: 'Europe/London' },
    });
  });
});
