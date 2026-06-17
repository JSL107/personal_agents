import { AutopilotConsumer } from './autopilot.consumer';

const makeJob = (name: string) => ({
  name,
  data: { ownerSlackUserId: 'U1', target: 'C1' },
}) as never;

describe('AutopilotConsumer', () => {
  it('job.name = 플레이북 id → orchestrator.run 위임', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const consumer = new AutopilotConsumer({ run } as never, undefined);
    await consumer.process(makeJob('daily-eval'));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'daily-eval' }),
      'U1',
      'C1',
    );
  });

  it('미등록 job.name → orchestrator 미호출(로그만)', async () => {
    const run = jest.fn();
    const consumer = new AutopilotConsumer({ run } as never, undefined);
    await consumer.process(makeJob('unknown-x'));
    expect(run).not.toHaveBeenCalled();
  });

  it('실행 실패 → publishCronFailure + rethrow', async () => {
    const run = jest.fn().mockRejectedValue(new Error('boom'));
    const publishCronFailure = jest.fn();
    const consumer = new AutopilotConsumer({ run } as never, {
      publishCronFailure,
    } as never);
    await expect(consumer.process(makeJob('daily-eval'))).rejects.toThrow('boom');
    expect(publishCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: 'Autopilot:daily-eval', ownerSlackUserId: 'U1' }),
    );
  });
});
