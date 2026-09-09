import { AutopilotConsumer } from './autopilot.consumer';

const makeJob = (name: string) =>
  ({
    name,
    // 슬롯 식별자 — orchestrator 의 재진입 차단이 이 값으로 슬롯을 구분한다.
    id: `repeat:${name}:1`,
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
  // #530 으로 워커 동시 처리 수를 2 로 올린 뒤, 스케줄 오프셋(2-57/5 vs */10)만으로는 두
  // 모의투자 작업이 겹치지 않는다는 보장이 사라졌다 — 긴 작업 뒤에 나란히 밀리면 같이 출발한다.
  // 겹치면 체결기가 손절이 막 만든 PENDING SELL 을 집어 당일 시가로 체결해 원장에 틀린 가격이 남는다.
  describe('모의투자 체결·손절 상호 배제', () => {
    it('앞선 배타 그룹이 끝나기 전에는 다른 배타 그룹을 시작하지 않는다', async () => {
      let releaseFirst: () => void = () => undefined;
      const firstStarted = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      // 호출 순서가 아니라 그룹 이름으로 배정한다 — 두 process 가 모두 비동기로 진입해서
      // 순서로 배정하면 어느 쪽이 먼저 mock 을 집을지 정해지지 않는다.
      const runGroup = jest.fn().mockImplementation(async (group: string) => {
        if (group === 'paper-order-fill') {
          await firstStarted;
        }
      });
      const consumer = makeConsumer({ runGroup });

      const first = consumer.process(makeJob('paper-order-fill'));
      const second = consumer.process(makeJob('paper-intraday-stop'));
      // 두 번째가 대기에 걸렸는지 확인하려면 마이크로태스크를 한 번 비워야 한다.
      await Promise.resolve();
      await Promise.resolve();

      expect(runGroup).toHaveBeenCalledTimes(1);
      expect(runGroup.mock.calls[0][0]).toBe('paper-order-fill');

      releaseFirst();
      await Promise.all([first, second]);
      expect(runGroup).toHaveBeenCalledTimes(2);
      expect(runGroup.mock.calls[1][0]).toBe('paper-intraday-stop');
    });

    it('앞선 배타 그룹이 실패해도 다음 배타 그룹은 실행된다', async () => {
      const runGroup = jest.fn().mockImplementation(async (group: string) => {
        if (group === 'paper-order-fill') {
          throw new Error('boom');
        }
      });
      const consumer = makeConsumer(
        { runGroup },
        { publishCronFailure: jest.fn() },
      );

      await expect(
        consumer.process(makeJob('paper-order-fill')),
      ).rejects.toThrow('boom');
      await consumer.process(makeJob('paper-intraday-stop'));

      expect(runGroup).toHaveBeenCalledTimes(2);
    });

    // 배타는 두 그룹 사이에만 건다 — 굶김을 줄이려고 올린 동시성을 되돌리면 안 된다.
    it('배타 목록 밖의 그룹은 앞선 실행을 기다리지 않는다', async () => {
      const runGroup = jest.fn().mockImplementation(async (group: string) => {
        if (group === 'paper-order-fill') {
          await new Promise<void>(() => undefined);
        }
      });
      const consumer = makeConsumer({ runGroup });

      // paper-order-fill 은 영원히 끝나지 않는다. 그런데도 아래 await 가 반환되는 것 자체가
      // "배타 목록 밖 그룹은 기다리지 않는다" 의 증명이다.
      void consumer.process(makeJob('paper-order-fill'));
      await consumer.process(makeJob('morning'));

      // 순서로 단언하지 않는다 — morning 은 사슬을 거치지 않아 오히려 먼저 도달한다.
      expect(runGroup.mock.calls.map((call) => call[0])).toEqual(
        expect.arrayContaining(['morning', 'paper-order-fill']),
      );
    });
  });

  it('job.name = "evening"(groupKey) → 기존 선두부터 GitHub 발행까지 4건을 순서대로 위임한다', async () => {
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
      'repeat:evening:1',
    );
    const entries: Array<{ id: string }> = runGroup.mock.calls[0][1];
    expect(entries.map((entry) => entry.id)).toEqual([
      'work-reviewer',
      'daily-eval',
      'evening-retro-publish',
      'blog-github-publish',
    ]);
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
      'repeat:morning:1',
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
