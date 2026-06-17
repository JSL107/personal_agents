import { PlaybookEntry } from '../domain/playbook.type';
import { AutopilotOrchestrator } from './autopilot.orchestrator';

const T0_ENTRY: PlaybookEntry = {
  id: 'daily-eval',
  taskId: 'daily-eval',
  trigger: { kind: 'CRON', schedule: '0 19 * * *', timezone: 'Asia/Seoul' },
  riskTier: 'T0_AUTO',
};

const makeEntry = (id: string, taskId: string): PlaybookEntry => ({
  id,
  taskId,
  trigger: { kind: 'CRON', schedule: '0 19 * * *', timezone: 'Asia/Seoul' },
  riskTier: 'T0_AUTO',
});

const makeTask = (id: string, result: unknown) => ({
  id,
  run: jest.fn().mockResolvedValue(result),
});

describe('AutopilotOrchestrator', () => {
  it('단일 항목 그룹 정상 → 1 task 실행, 1 발송', async () => {
    const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const postMessage = jest.fn().mockResolvedValue(undefined);
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce } as never,
    );

    await orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1');

    expect(task.run).toHaveBeenCalledWith(
      expect.objectContaining({ ownerSlackUserId: 'U1' }),
    );
    expect(postMessage).toHaveBeenCalledWith({ target: 'C1', text: '본문' });
    expect(acquireOnce).toHaveBeenCalledTimes(1);
  });

  it('2항목 그룹 → task 2개 실행, postMessage 1회(구분자 포함)', async () => {
    const taskA = makeTask('daily-eval', { skip: false, slackText: 'A' });
    const taskB = makeTask('work-reviewer', { skip: false, slackText: 'B' });
    const postMessage = jest.fn().mockResolvedValue(undefined);
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [taskA, taskB] as never,
      { postMessage } as never,
      { acquireOnce } as never,
    );

    const e1 = makeEntry('daily-eval', 'daily-eval');
    const e2 = makeEntry('work-reviewer', 'work-reviewer');
    await orchestrator.runGroup('evening', [e1, e2], 'U1', 'C1');

    expect(taskA.run).toHaveBeenCalledTimes(1);
    expect(taskB.run).toHaveBeenCalledTimes(1);
    expect(acquireOnce).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    const sentText: string = postMessage.mock.calls[0][0].text;
    expect(sentText).toContain('A');
    expect(sentText).toContain('B');
    expect(sentText).toContain('────────');
  });

  it('그룹 내 일부 skip → 비-skip slackText 만 발송', async () => {
    const taskA = makeTask('daily-eval', { skip: true });
    const taskB = makeTask('work-reviewer', { skip: false, slackText: 'B' });
    const postMessage = jest.fn().mockResolvedValue(undefined);
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [taskA, taskB] as never,
      { postMessage } as never,
      { acquireOnce } as never,
    );

    const e1 = makeEntry('daily-eval', 'daily-eval');
    const e2 = makeEntry('work-reviewer', 'work-reviewer');
    await orchestrator.runGroup('evening', [e1, e2], 'U1', 'C1');

    expect(postMessage).toHaveBeenCalledTimes(1);
    const sentText: string = postMessage.mock.calls[0][0].text;
    expect(sentText).not.toContain('A');
    expect(sentText).toContain('B');
  });

  it('전부 skip → postMessage 0회', async () => {
    const taskA = makeTask('daily-eval', { skip: true });
    const postMessage = jest.fn();
    const orchestrator = new AutopilotOrchestrator(
      [taskA] as never,
      { postMessage } as never,
      { acquireOnce: jest.fn().mockResolvedValue(true) } as never,
    );

    await orchestrator.runGroup('evening', [T0_ENTRY], 'U1', 'C1');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('다중 타깃 + 그룹 → 합친 텍스트를 각 타깃에 발송, acquireOnce 1회', async () => {
    const taskA = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const postMessage = jest.fn().mockResolvedValue(undefined);
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [taskA] as never,
      { postMessage } as never,
      { acquireOnce } as never,
    );

    await orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1, C2');

    expect(acquireOnce).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenCalledWith({ target: 'C1', text: '본문' });
    expect(postMessage).toHaveBeenCalledWith({ target: 'C2', text: '본문' });
  });

  it('미등록 taskId → throw', async () => {
    const orchestrator = new AutopilotOrchestrator(
      [] as never,
      { postMessage: jest.fn() } as never,
      { acquireOnce: jest.fn().mockResolvedValue(true) } as never,
    );
    await expect(
      orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1'),
    ).rejects.toThrow(/task 미등록/);
  });

  it('T1_PREVIEW 항목 포함 → throw (SP4)', async () => {
    const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage: jest.fn() } as never,
      { acquireOnce: jest.fn().mockResolvedValue(true) } as never,
    );
    const t1Entry: PlaybookEntry = { ...T0_ENTRY, riskTier: 'T1_PREVIEW' };
    await expect(
      orchestrator.runGroup('daily-eval', [t1Entry], 'U1', 'C1'),
    ).rejects.toThrow(/T1_PREVIEW/);
  });

  it('멱등 2회차(acquireOnce=false) → 발송 skip', async () => {
    const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const postMessage = jest.fn();
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce: jest.fn().mockResolvedValue(false) } as never,
    );

    await orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1');
    expect(postMessage).not.toHaveBeenCalled();
  });
});
