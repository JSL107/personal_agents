import { AutopilotConsumer } from './autopilot.consumer';

const makeJob = (name: string) =>
  ({
    name,
    data: { ownerSlackUserId: 'U1', target: 'C1' },
  }) as never;

// 평상시(절전 아님) 동작: waitUntilReady 는 즉시 통과, probe 는 준비됨.
const makeWakeGuard = () => ({
  waitUntilReady: jest
    .fn()
    .mockResolvedValue({ waited: false, ready: true, attempts: 0 }),
});
const makeModelRouter = () => ({
  probeReadiness: jest.fn().mockResolvedValue(true),
});

const makeConsumer = (orchestrator: unknown, notificationPublisher?: unknown) =>
  new AutopilotConsumer(
    orchestrator as never,
    makeWakeGuard() as never,
    makeModelRouter() as never,
    notificationPublisher as never,
  );

describe('AutopilotConsumer', () => {
  it('job.name = "evening"(groupKey) → runGroup 위임(daily-eval + work-reviewer + evening-retro-publish 3건)', async () => {
    const runGroup = jest.fn().mockResolvedValue(undefined);
    const consumer = makeConsumer({ runGroup });
    await consumer.process(makeJob('evening'));
    expect(runGroup).toHaveBeenCalledWith(
      'evening',
      expect.arrayContaining([
        expect.objectContaining({ id: 'daily-eval' }),
        expect.objectContaining({ id: 'work-reviewer' }),
        expect.objectContaining({ id: 'evening-retro-publish' }),
      ]),
      'U1',
      'C1',
    );
    // entries 는 정확히 3건 (daily-eval + work-reviewer + evening-retro-publish)
    const entries: unknown[] = runGroup.mock.calls[0][1];
    expect(entries).toHaveLength(3);
  });

  it('job.name = "morning"(groupKey) → orchestrator.runGroup 위임(entries 포함)', async () => {
    const runGroup = jest.fn().mockResolvedValue(undefined);
    const consumer = makeConsumer({ runGroup });
    await consumer.process(makeJob('morning'));
    expect(runGroup).toHaveBeenCalledWith(
      'morning',
      expect.arrayContaining([
        expect.objectContaining({ id: 'morning-briefing' }),
      ]),
      'U1',
      'C1',
    );
  });

  it('미등록 job.name → runGroup 미호출(로그만)', async () => {
    const runGroup = jest.fn();
    const consumer = makeConsumer({ runGroup });
    await consumer.process(makeJob('unknown-x'));
    expect(runGroup).not.toHaveBeenCalled();
  });

  it('플레이북에 없는 groupKey 면 owner 알람을 발사한다', async () => {
    const runGroup = jest.fn();
    const publishCronFailure = jest.fn();
    const consumer = makeConsumer({ runGroup }, { publishCronFailure });

    await consumer.process(makeJob('nonexistent-group'));

    expect(publishCronFailure).toHaveBeenCalledWith({
      cronName: 'Autopilot:nonexistent-group',
      ownerSlackUserId: 'U1',
      errorMessage:
        "미등록 cron group 'nonexistent-group' — 플레이북 등록 누락(구성 오류). 실행 스킵됨.",
    });
  });

  it('실행 실패 → publishCronFailure + rethrow', async () => {
    const runGroup = jest.fn().mockRejectedValue(new Error('boom'));
    const publishCronFailure = jest.fn();
    const consumer = makeConsumer({ runGroup }, { publishCronFailure });
    await expect(consumer.process(makeJob('morning'))).rejects.toThrow('boom');
    expect(publishCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        cronName: 'Autopilot:morning',
        ownerSlackUserId: 'U1',
      }),
    );
  });

  it('runGroup 실행 전에 wakeGuard.waitUntilReady 로 백엔드 준비를 확인한다(절전 게이트)', async () => {
    const runGroup = jest.fn().mockResolvedValue(undefined);
    const waitUntilReady = jest
      .fn()
      .mockResolvedValue({ waited: true, ready: true, attempts: 1 });
    const probeReadiness = jest.fn().mockResolvedValue(true);
    const consumer = new AutopilotConsumer(
      { runGroup } as never,
      { waitUntilReady } as never,
      { probeReadiness } as never,
      undefined as never,
    );

    await consumer.process(makeJob('morning'));

    // waitUntilReady 가 runGroup 보다 먼저 호출된다.
    expect(waitUntilReady).toHaveBeenCalledTimes(1);
    expect(waitUntilReady.mock.invocationCallOrder[0]).toBeLessThan(
      runGroup.mock.invocationCallOrder[0],
    );
    // 주입된 probe 함수는 modelRouter.probeReadiness 를 호출한다.
    const probeFn = waitUntilReady.mock.calls[0][0] as () => Promise<boolean>;
    await probeFn();
    expect(probeReadiness).toHaveBeenCalled();
  });
});
