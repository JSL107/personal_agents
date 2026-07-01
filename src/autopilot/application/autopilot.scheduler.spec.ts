import { AutopilotScheduler } from './autopilot.scheduler';

const makeQueue = () => ({
  add: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
});

describe('AutopilotScheduler', () => {
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

    // 각 그룹당 1번씩 queue.add 호출 — entry 수(6)가 아닌 그룹 수.
    const addCalls: string[] = queue.add.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    // 동일 groupKey 로 중복 등록 없음 (그룹당 exactly 1).
    const unique = new Set(addCalls);
    expect(unique.size).toBe(addCalls.length);
    // SP4: evening(daily-eval+work-reviewer) + morning + weekly-summary + ceo-meta + impact-report
    //   + run-retro(주간 실행 회고, 단독 그룹) + knowledge-lint(주간 무결성 점검, 단독 그룹)
    //   + docs-sync-audit(주간 문서↔코드 점검, 단독 그룹) + preference-learning(주간 선호 학습) = 9그룹.
    expect(queue.add).toHaveBeenCalledTimes(9);
    expect(addCalls).toContain('evening');
    expect(addCalls).toContain('morning');
    expect(addCalls).toContain('weekly-summary');
    expect(addCalls).toContain('ceo-meta');
    expect(addCalls).toContain('impact-report');
    expect(addCalls).toContain('run-retro');
    expect(addCalls).toContain('knowledge-lint');
    expect(addCalls).toContain('docs-sync-audit');
    expect(addCalls).toContain('preference-learning');
  });

  it('evening 그룹 스케줄은 첫 항목(daily-eval) env 기반 → 19:00', async () => {
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
});
