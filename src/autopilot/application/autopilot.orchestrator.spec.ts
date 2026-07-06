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
    const task = makeTask('daily-eval', { skip: false, summaryText: '본문' });
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
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
    const taskA = makeTask('daily-eval', { skip: false, summaryText: 'A' });
    const taskB = makeTask('work-reviewer', { skip: false, summaryText: 'B' });
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
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

  it('그룹 내 일부 skip → 비-skip summaryText 만 발송', async () => {
    const taskA = makeTask('daily-eval', { skip: true });
    const taskB = makeTask('work-reviewer', { skip: false, summaryText: 'B' });
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
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
    const taskA = makeTask('daily-eval', { skip: false, summaryText: '본문' });
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
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
    const taskA = makeTask('daily-eval', {
      skip: false,
      summaryText: 'A 정상',
    });
    const taskB = {
      id: 'work-reviewer',
      run: jest
        .fn()
        .mockRejectedValue(
          new Error('모델 응답을 JSON 으로 파싱하지 못했습니다.'),
        ),
    };
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
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
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
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
    const task = makeTask('daily-eval', { skip: false, summaryText: '본문' });
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
      postMessage: jest.fn().mockResolvedValue({ ts: undefined }),
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
    // autopilot preview 는 하루 1회 cron 발화라 TTL 24h — 당일 승인 놓쳐도 다음 발화 직전까지 유효.
    expect(createPreview.execute.mock.calls[0][0].ttlMs).toBe(
      24 * 60 * 60 * 1000,
    );
    expect(slackNotifier.postPreviewMessage).toHaveBeenCalledWith({
      target: 'U1',
      previewText: 'pv',
      previewId: 'PV1',
    });
  });

  it('요약은 메인 메시지로, 상세는 같은 스레드 댓글로 발송한다', async () => {
    const taskA = {
      id: 'a',
      run: jest.fn().mockResolvedValue({
        skip: false,
        summaryText: 'SA',
        detailText: 'DA',
      }),
    };
    const taskB = {
      id: 'b',
      run: jest.fn().mockResolvedValue({ skip: false, summaryText: 'SB' }),
    };
    const postMessageMock = jest.fn().mockResolvedValue({ ts: 'TS1' });
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [taskA, taskB] as never,
      { postMessage: postMessageMock } as never,
      { acquireOnce } as never,
      { execute: jest.fn() } as never,
    );

    const entryA = makeEntry('a', 'a');
    const entryB = makeEntry('b', 'b');
    await orchestrator.runGroup('g', [entryA, entryB], 'U1', 'C1');

    // 1) 메인: SA + 구분자 + SB
    expect(postMessageMock).toHaveBeenNthCalledWith(1, {
      target: 'C1',
      text: 'SA\n\n────────\n\nSB',
    });
    // 2) 스레드: detailText 있는 A 만, threadTs=TS1
    expect(postMessageMock).toHaveBeenNthCalledWith(2, {
      target: 'C1',
      text: 'DA',
      threadTs: 'TS1',
    });
    expect(postMessageMock).toHaveBeenCalledTimes(2);
  });

  it('detail 없는 task만 있으면 메인 1건만 발송', async () => {
    const task = makeTask('daily-eval', { skip: false, summaryText: '요약만' });
    const postMessage = jest.fn().mockResolvedValue({ ts: 'TS2' });
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce: jest.fn().mockResolvedValue(true) } as never,
      { execute: jest.fn() } as never,
    );

    await orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1');

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ target: 'C1', text: '요약만' });
  });

  // 회귀 방지 — 멱등 가드가 acquireOnce 단계에서 소비된 채 메인 발송이 실패하면,
  // BullMQ 재시도가 "이미 발송됨"으로 차단돼 저녁 다이제스트가 영구 미전송되던 버그.
  // 메인 발송 실패 시 가드 키를 release(롤백)해야 재시도가 다시 발송할 수 있다.
  it('메인 발송 실패 시 멱등 키를 release 하고 rethrow (재시도가 다시 발송 가능)', async () => {
    const task = makeTask('daily-eval', { skip: false, summaryText: '본문' });
    const postMessage = jest
      .fn()
      .mockRejectedValue(new Error('Slack API 일시 오류'));
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const release = jest.fn().mockResolvedValue(undefined);
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce, release } as never,
      { execute: jest.fn() } as never,
    );

    await expect(
      orchestrator.runGroup('evening', [T0_ENTRY], 'U1', 'C1'),
    ).rejects.toThrow('Slack API 일시 오류');

    // 획득했던 바로 그 키를 롤백해야 한다.
    const acquiredKey: string = acquireOnce.mock.calls[0][0];
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(acquiredKey);
  });

  it('발송 성공 시 release 호출 안 함 (정상 경로는 가드 유지)', async () => {
    const task = makeTask('daily-eval', { skip: false, summaryText: '본문' });
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const release = jest.fn().mockResolvedValue(undefined);
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce, release } as never,
      { execute: jest.fn() } as never,
    );

    await orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1');

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  // 메인 발송은 성공(ts 반환)했으나 스레드 상세 발송만 실패한 경우 — 이미 자체 try/catch 로
  // swallow 하므로 가드 롤백/rethrow 대상이 아니다(메인 요약은 전달됨 = 데이터 손실 아님).
  it('task.result.previews 배열이면 각 항목마다 PreviewGate 카드를 발송한다', async () => {
    const previewA = {
      kind: 'EVENING_BLOG_PUBLISH',
      payload: { a: 1 },
      previewText: 'A',
    };
    const previewB = {
      kind: 'EVENING_CAREER_REFLECT',
      payload: { b: 2 },
      previewText: 'B',
    };
    const previewTask = {
      id: 'evening-retro-publish',
      run: jest
        .fn()
        .mockResolvedValue({ skip: true, previews: [previewA, previewB] }),
    };
    const createPreview = {
      execute: jest.fn().mockResolvedValue({ id: 'PV1' }),
    };
    const slackNotifier = {
      postMessage: jest.fn().mockResolvedValue({ ts: undefined }),
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
      'evening',
      [
        {
          id: 'evening-retro-publish',
          taskId: 'evening-retro-publish',
          riskTier: 'T1_PREVIEW',
          trigger: {
            kind: 'CRON',
            schedule: '0 19 * * *',
            timezone: 'Asia/Seoul',
          },
        },
      ] as any,
      'U1',
      'C1',
    );
    expect(createPreview.execute).toHaveBeenCalledTimes(2);
    expect(slackNotifier.postPreviewMessage).toHaveBeenCalledTimes(2);
  });

  it('스레드 상세 발송 실패는 swallow — release/throw 없음', async () => {
    const task = {
      id: 'daily-eval',
      run: jest
        .fn()
        .mockResolvedValue({ skip: false, summaryText: 'S', detailText: 'D' }),
    };
    const postMessage = jest
      .fn()
      .mockResolvedValueOnce({ ts: 'TS1' }) // 메인 성공
      .mockRejectedValueOnce(new Error('thread 실패')); // 스레드 상세 실패
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const release = jest.fn().mockResolvedValue(undefined);
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce, release } as never,
      { execute: jest.fn() } as never,
    );

    await expect(
      orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1'),
    ).resolves.toBeUndefined();

    expect(release).not.toHaveBeenCalled();
  });

  // 다중 target 부분 실패 — 앞 target 성공 후 뒤 target 발송 실패 시 release 1회 + rethrow.
  // 가드가 group 단위 단일 키라 재시도는 성공 target 에도 재발송되는 트레이드오프를 고정한다
  // ("전 target 미전송" 보다 작은 해악으로 수용 — orchestrator 주석 참조).
  it('다중 target 부분 실패 → release 1회 + rethrow (성공 target 재발송 트레이드오프)', async () => {
    const task = makeTask('daily-eval', { skip: false, summaryText: '본문' });
    const postMessage = jest
      .fn()
      .mockResolvedValueOnce({ ts: undefined }) // C1 메인 성공
      .mockRejectedValueOnce(new Error('C2 발송 실패')); // C2 메인 실패
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const release = jest.fn().mockResolvedValue(undefined);
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce, release } as never,
      { execute: jest.fn() } as never,
    );

    await expect(
      orchestrator.runGroup('evening', [T0_ENTRY], 'U1', 'C1, C2'),
    ).rejects.toThrow('C2 발송 실패');

    const acquiredKey: string = acquireOnce.mock.calls[0][0];
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(acquiredKey);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenNthCalledWith(1, {
      target: 'C1',
      text: '본문',
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      target: 'C2',
      text: '본문',
    });
  });
});
