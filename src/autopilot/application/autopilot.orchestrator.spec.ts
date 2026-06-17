import { PlaybookEntry } from '../domain/playbook.type';
import { AutopilotOrchestrator } from './autopilot.orchestrator';

const T0_ENTRY: PlaybookEntry = {
  id: 'daily-eval',
  taskId: 'daily-eval',
  trigger: { kind: 'CRON', schedule: '0 19 * * *', timezone: 'Asia/Seoul' },
  riskTier: 'T0_AUTO',
};

const makeTask = (id: string, result: unknown) => ({
  id,
  run: jest.fn().mockResolvedValue(result),
});

describe('AutopilotOrchestrator', () => {
  it('T0 정상 → 멱등 획득 후 Slack 게시', async () => {
    const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const postMessage = jest.fn().mockResolvedValue(undefined);
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const o = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce } as never,
    );

    await o.run(T0_ENTRY, 'U1', 'C1');

    expect(task.run).toHaveBeenCalledWith(
      expect.objectContaining({ ownerSlackUserId: 'U1' }),
    );
    expect(postMessage).toHaveBeenCalledWith({ target: 'C1', text: '본문' });
  });

  it('skip=true → 게시 안 함', async () => {
    const task = makeTask('daily-eval', { skip: true });
    const postMessage = jest.fn();
    const o = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce: jest.fn().mockResolvedValue(true) } as never,
    );
    await o.run(T0_ENTRY, 'U1', 'C1');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('멱등 2회차(false) → 게시 skip', async () => {
    const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const postMessage = jest.fn();
    const o = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce: jest.fn().mockResolvedValue(false) } as never,
    );
    await o.run(T0_ENTRY, 'U1', 'C1');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('미등록 taskId → throw', async () => {
    const o = new AutopilotOrchestrator(
      [] as never,
      { postMessage: jest.fn() } as never,
      { acquireOnce: jest.fn().mockResolvedValue(true) } as never,
    );
    await expect(o.run(T0_ENTRY, 'U1', 'C1')).rejects.toThrow(/task 미등록/);
  });

  it('T1_PREVIEW → 미지원 throw (SP4)', async () => {
    const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const o = new AutopilotOrchestrator(
      [task] as never,
      { postMessage: jest.fn() } as never,
      { acquireOnce: jest.fn().mockResolvedValue(true) } as never,
    );
    await expect(
      o.run({ ...T0_ENTRY, riskTier: 'T1_PREVIEW' }, 'U1', 'C1'),
    ).rejects.toThrow(/T1_PREVIEW/);
  });

  it('T0 다중 타깃(콤마) → 각 타깃에 발송, 멱등은 1회', async () => {
    const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const postMessage = jest.fn().mockResolvedValue(undefined);
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const o = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce } as never,
    );
    await o.run(T0_ENTRY, 'U1', 'C1, C2 ,C3');
    expect(acquireOnce).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(3);
    expect(postMessage).toHaveBeenCalledWith({ target: 'C2', text: '본문' });
  });
});
