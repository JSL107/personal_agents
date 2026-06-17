import { AutopilotConsumer } from './autopilot.consumer';

const makeJob = (name: string) =>
  ({
    name,
    data: { ownerSlackUserId: 'U1', target: 'C1' },
  }) as never;

describe('AutopilotConsumer', () => {
  it('job.name = "evening"(groupKey) → runGroup 위임(daily-eval + work-reviewer 2건)', async () => {
    const runGroup = jest.fn().mockResolvedValue(undefined);
    const consumer = new AutopilotConsumer({ runGroup } as never, undefined);
    await consumer.process(makeJob('evening'));
    expect(runGroup).toHaveBeenCalledWith(
      'evening',
      expect.arrayContaining([
        expect.objectContaining({ id: 'daily-eval' }),
        expect.objectContaining({ id: 'work-reviewer' }),
      ]),
      'U1',
      'C1',
    );
    // entries 는 정확히 2건
    const entries: unknown[] = runGroup.mock.calls[0][1];
    expect(entries).toHaveLength(2);
  });

  it('job.name = "morning"(groupKey) → orchestrator.runGroup 위임(entries 포함)', async () => {
    const runGroup = jest.fn().mockResolvedValue(undefined);
    const consumer = new AutopilotConsumer({ runGroup } as never, undefined);
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
    const consumer = new AutopilotConsumer({ runGroup } as never, undefined);
    await consumer.process(makeJob('unknown-x'));
    expect(runGroup).not.toHaveBeenCalled();
  });

  it('실행 실패 → publishCronFailure + rethrow', async () => {
    const runGroup = jest.fn().mockRejectedValue(new Error('boom'));
    const publishCronFailure = jest.fn();
    const consumer = new AutopilotConsumer(
      { runGroup } as never,
      { publishCronFailure } as never,
    );
    await expect(consumer.process(makeJob('morning'))).rejects.toThrow('boom');
    expect(publishCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        cronName: 'Autopilot:morning',
        ownerSlackUserId: 'U1',
      }),
    );
  });
});
