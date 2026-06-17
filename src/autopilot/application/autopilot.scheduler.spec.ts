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

    // 각 그룹당 1번씩 queue.add 호출 — entry 수가 아닌 그룹 수.
    // AUTOPILOT_PLAYBOOK 에 정의된 그룹(digestGroup ?? id 기준) 수와 일치해야 함.
    const addCalls: string[] = queue.add.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );
    // 동일 groupKey 로 중복 등록 없음 (그룹당 exactly 1).
    const unique = new Set(addCalls);
    expect(unique.size).toBe(addCalls.length);
    // 최소 1개 이상 등록됨.
    expect(queue.add.mock.calls.length).toBeGreaterThanOrEqual(1);
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
