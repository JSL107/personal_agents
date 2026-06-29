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
      { execute: jest.fn() } as never,
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
      { execute: jest.fn() } as never,
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
      { execute: jest.fn() } as never,
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
      { execute: jest.fn() } as never,
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
      { execute: jest.fn() } as never,
    );

    await orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1, C2');

    expect(acquireOnce).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenCalledWith({ target: 'C1', text: '본문' });
    expect(postMessage).toHaveBeenCalledWith({ target: 'C2', text: '본문' });
  });

  it('그룹 내 한 task 가 throw 해도 다른 task 발송 + 그룹 성공 (실패 격리)', async () => {
    const taskA = makeTask('daily-eval', { skip: false, slackText: 'A 정상' });
    const taskB = {
      id: 'work-reviewer',
      run: jest
        .fn()
        .mockRejectedValue(
          new Error('모델 응답을 JSON 으로 파싱하지 못했습니다.'),
        ),
    };
    const postMessage = jest.fn().mockResolvedValue(undefined);
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [taskA, taskB] as never,
      { postMessage } as never,
      { acquireOnce } as never,
      { execute: jest.fn() } as never,
    );

    const e1 = makeEntry('daily-eval', 'daily-eval');
    const e2 = makeEntry('work-reviewer', 'work-reviewer');

    // 한 task 실패가 그룹/cron 전체를 죽이지 않는다 (throw 안 함).
    await expect(
      orchestrator.runGroup('evening', [e1, e2], 'U1', 'C1'),
    ).resolves.toBeUndefined();

    // 정상 task 는 발송되고, 실패 task 는 안내로 표기된다 (조용한 실패 방지).
    expect(postMessage).toHaveBeenCalledTimes(1);
    const sentText: string = postMessage.mock.calls[0][0].text;
    expect(sentText).toContain('A 정상');
    expect(sentText).toContain('work-reviewer');
  });

  it('그룹 내 모든 task 실패 → throw 안 함, 실패 안내만 발송', async () => {
    const taskA = {
      id: 'daily-eval',
      run: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const postMessage = jest.fn().mockResolvedValue(undefined);
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [taskA] as never,
      { postMessage } as never,
      { acquireOnce } as never,
      { execute: jest.fn() } as never,
    );

    await expect(
      orchestrator.runGroup(
        'evening',
        [makeEntry('daily-eval', 'daily-eval')],
        'U1',
        'C1',
      ),
    ).resolves.toBeUndefined();
    // 실패 안내가 발송되어 owner 가 인지 가능 (조용한 실패 방지).
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].text).toContain('daily-eval');
  });

  it('미등록 taskId → throw', async () => {
    const orchestrator = new AutopilotOrchestrator(
      [] as never,
      { postMessage: jest.fn() } as never,
      { acquireOnce: jest.fn().mockResolvedValue(true) } as never,
      { execute: jest.fn() } as never,
    );
    await expect(
      orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1'),
    ).rejects.toThrow(/task 미등록/);
  });

  it('멱등 2회차(acquireOnce=false) → 발송 skip', async () => {
    const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const postMessage = jest.fn();
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce: jest.fn().mockResolvedValue(false) } as never,
      { execute: jest.fn() } as never,
    );

    await orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('T1_PREVIEW + preview 페이로드 → CreatePreview + postPreviewMessage(버튼)', async () => {
    const previewTask = {
      id: 'docs-sync-audit',
      run: jest.fn().mockResolvedValue({
        skip: false,
        preview: {
          kind: 'DOCS_AUDIT_PR',
          payload: { files: [] },
          previewText: 'pv',
        },
      }),
    };
    const createPreview = {
      execute: jest.fn().mockResolvedValue({ id: 'PV1' }),
    };
    const slackNotifier = {
      postMessage: jest.fn(),
      postPreviewMessage: jest.fn(),
    };
    const idempotency = { acquireOnce: jest.fn().mockResolvedValue(true) };
    const orchestrator = new AutopilotOrchestrator(
      [previewTask] as any,
      slackNotifier as any,
      idempotency as any,
      createPreview as any,
    );
    await orchestrator.runGroup(
      'docs-sync-audit',
      [
        {
          id: 'docs-sync-audit',
          taskId: 'docs-sync-audit',
          riskTier: 'T1_PREVIEW',
          trigger: {
            kind: 'CRON',
            schedule: '0 11 * * 0',
            timezone: 'Asia/Seoul',
          },
        },
      ] as any,
      'U1',
      'U1',
    );
    expect(createPreview.execute).toHaveBeenCalledTimes(1);
    expect(createPreview.execute.mock.calls[0][0].kind).toBe('DOCS_AUDIT_PR');
    expect(createPreview.execute.mock.calls[0][0].slackUserId).toBe('U1');
    expect(slackNotifier.postPreviewMessage).toHaveBeenCalledWith({
      target: 'U1',
      previewText: 'pv',
      previewId: 'PV1',
    });
  });
});
