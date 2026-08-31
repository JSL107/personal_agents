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
      { acquireOnce, isDone: jest.fn().mockResolvedValue(false) } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    await orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1');

    expect(task.run).toHaveBeenCalledWith(
      expect.objectContaining({ ownerSlackUserId: 'U1' }),
    );
    expect(postMessage).toHaveBeenCalledWith({ target: 'C1', text: '본문' });
    expect(acquireOnce).toHaveBeenCalledTimes(1);
  });

  describe('unfurlLinks — 링크가 여러 개인 목록형 카드가 미리보기에 묻히지 않게 한다', () => {
    const runWith = async (
      results: { skip: false; summaryText: string; unfurlLinks?: boolean }[],
    ): Promise<jest.Mock> => {
      const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
      const tasks = results.map((result, index) => {
        return makeTask(index === 0 ? 'daily-eval' : 'work-reviewer', result);
      });
      const orchestrator = new AutopilotOrchestrator(
        tasks as never,
        { postMessage } as never,
        {
          acquireOnce: jest.fn().mockResolvedValue(true),
          isDone: jest.fn().mockResolvedValue(false),
        } as never,
        { execute: jest.fn() } as never,
        { attachSlackMessage: jest.fn() } as never,
      );
      const entries = tasks.map((_, index) => {
        return index === 0
          ? makeEntry('daily-eval', 'daily-eval')
          : makeEntry('work-reviewer', 'work-reviewer');
      });
      await orchestrator.runGroup('evening', entries, 'U1', 'C1');
      return postMessage;
    };

    it('task 가 끄기를 요청하면 발송에 그대로 전달한다', async () => {
      const postMessage = await runWith([
        { skip: false, summaryText: '본문', unfurlLinks: false },
      ]);
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ unfurlLinks: false }),
      );
    });

    it('아무도 요청하지 않으면 옵션을 붙이지 않는다 — 기존 발송은 그대로다', async () => {
      const postMessage = await runWith([{ skip: false, summaryText: '본문' }]);
      expect(postMessage).toHaveBeenCalledWith({ target: 'C1', text: '본문' });
    });

    it('요약이 합쳐질 때 한 항목만 요청해도 끈다 — 설정은 메시지 단위다', async () => {
      // 켜 둔 채 합치면 그 항목의 링크가 펼쳐져, 끄려던 이유가 그대로 남는다.
      const postMessage = await runWith([
        { skip: false, summaryText: 'A' },
        { skip: false, summaryText: 'B', unfurlLinks: false },
      ]);
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ unfurlLinks: false }),
      );
    });
  });

  it('2항목 그룹 → task 2개 실행, postMessage 1회(구분자 포함)', async () => {
    const taskA = makeTask('daily-eval', { skip: false, summaryText: 'A' });
    const taskB = makeTask('work-reviewer', { skip: false, summaryText: 'B' });
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [taskA, taskB] as never,
      { postMessage } as never,
      { acquireOnce, isDone: jest.fn().mockResolvedValue(false) } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
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
      { acquireOnce, isDone: jest.fn().mockResolvedValue(false) } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    const e1 = makeEntry('daily-eval', 'daily-eval');
    const e2 = makeEntry('work-reviewer', 'work-reviewer');
    await orchestrator.runGroup('evening', [e1, e2], 'U1', 'C1');

    expect(postMessage).toHaveBeenCalledTimes(1);
    const sentText: string = postMessage.mock.calls[0][0].text;
    expect(sentText).not.toContain('A');
    expect(sentText).toContain('B');
  });

  it('전부 skip → 정상 종료하고 postMessage 0회', async () => {
    const taskA = makeTask('daily-eval', { skip: true });
    const postMessage = jest.fn();
    const orchestrator = new AutopilotOrchestrator(
      [taskA] as never,
      { postMessage } as never,
      {
        acquireOnce: jest.fn().mockResolvedValue(true),
        isDone: jest.fn().mockResolvedValue(false),
      } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    await expect(
      orchestrator.runGroup('evening', [T0_ENTRY], 'U1', 'C1'),
    ).resolves.toBeUndefined();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('다중 타깃 + 그룹 → 합친 텍스트를 각 타깃에 발송, acquireOnce 1회', async () => {
    const taskA = makeTask('daily-eval', { skip: false, summaryText: '본문' });
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [taskA] as never,
      { postMessage } as never,
      { acquireOnce, isDone: jest.fn().mockResolvedValue(false) } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
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
      { acquireOnce, isDone: jest.fn().mockResolvedValue(false) } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
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

  it('그룹 내 모든 task 실패 → 모든 target에 실패 안내 후 재시도를 위해 throw', async () => {
    const taskA = {
      id: 'daily-eval',
      run: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [taskA] as never,
      { postMessage } as never,
      { acquireOnce, isDone: jest.fn().mockResolvedValue(false) } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    await expect(
      orchestrator.runGroup(
        'evening',
        [makeEntry('daily-eval', 'daily-eval')],
        'U1',
        ' C1, , C2 ',
        'repeat:evening:1',
      ),
    ).rejects.toThrow('Autopilot: 실행한 모든 task 가 실패했습니다.');
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage).toHaveBeenNthCalledWith(1, {
      target: 'C1',
      text: expect.stringContaining('daily-eval 자동 생성 실패'),
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      target: 'C2',
      text: expect.stringContaining('daily-eval 자동 생성 실패'),
    });
    expect(acquireOnce).not.toHaveBeenCalled();
  });

  it('skip + task 실패로 전달 산출물이 없으면 재시도를 위해 throw하고 가드를 소비하지 않는다', async () => {
    const skippedTask = makeTask('evening-retro-publish', { skip: true });
    const failedTask = {
      id: 'daily-eval',
      run: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [skippedTask, failedTask] as never,
      { postMessage } as never,
      { acquireOnce, isDone: jest.fn().mockResolvedValue(false) } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    await expect(
      orchestrator.runGroup(
        'evening',
        [
          makeEntry('evening-retro-publish', 'evening-retro-publish'),
          makeEntry('daily-eval', 'daily-eval'),
        ],
        'U1',
        'C1',
      ),
    ).rejects.toThrow('Autopilot: 실행한 모든 task 가 실패했습니다.');

    expect(postMessage).toHaveBeenCalledWith({
      target: 'C1',
      text: expect.stringContaining('daily-eval 자동 생성 실패'),
    });
    expect(acquireOnce).not.toHaveBeenCalled();
  });

  it('preview 산출물 + task 실패 → preview를 전달하고 그룹은 성공한다', async () => {
    const previewTask = {
      id: 'evening-retro-publish',
      run: jest.fn().mockResolvedValue({
        skip: true,
        preview: {
          kind: 'EVENING_BLOG_PUBLISH',
          payload: {},
          previewText: '발행 후보',
        },
      }),
    };
    const failedTask = {
      id: 'daily-eval',
      run: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
    const postPreviewMessage = jest
      .fn()
      .mockResolvedValue({ channelId: 'C1', messageTs: '1.2' });
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [previewTask, failedTask] as never,
      { postMessage, postPreviewMessage } as never,
      { acquireOnce, isDone: jest.fn().mockResolvedValue(false) } as never,
      { execute: jest.fn().mockResolvedValue({ id: 'PV1' }) } as never,
      { attachSlackMessage: jest.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      orchestrator.runGroup(
        'evening',
        [
          makeEntry('evening-retro-publish', 'evening-retro-publish'),
          makeEntry('daily-eval', 'daily-eval'),
        ],
        'U1',
        'C1',
      ),
    ).resolves.toBeUndefined();

    expect(postPreviewMessage).toHaveBeenCalledWith({
      target: 'C1',
      previewText: '발행 후보',
      previewId: 'PV1',
    });
    expect(acquireOnce).toHaveBeenCalledTimes(1);
  });

  it('전멸 실패 안내 발송도 실패하면 원래 전멸 오류로 throw하고 가드를 소비하지 않는다', async () => {
    const taskA = {
      id: 'daily-eval',
      run: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const postMessage = jest
      .fn()
      .mockRejectedValue(new Error('Slack API 일시 오류'));
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [taskA] as never,
      { postMessage } as never,
      { acquireOnce, isDone: jest.fn().mockResolvedValue(false) } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    await expect(
      orchestrator.runGroup(
        'evening',
        [makeEntry('daily-eval', 'daily-eval')],
        'U1',
        'C1',
        'repeat:evening:2',
      ),
    ).rejects.toThrow('Autopilot: 실행한 모든 task 가 실패했습니다.');

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'C1',
        text: expect.stringContaining('daily-eval 자동 생성 실패'),
      }),
    );
    expect(acquireOnce).not.toHaveBeenCalled();
  });

  it('미등록 taskId → throw', async () => {
    const orchestrator = new AutopilotOrchestrator(
      [] as never,
      { postMessage: jest.fn() } as never,
      {
        acquireOnce: jest.fn().mockResolvedValue(true),
        isDone: jest.fn().mockResolvedValue(false),
      } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
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
      {
        acquireOnce: jest.fn().mockResolvedValue(false),
        isDone: jest.fn().mockResolvedValue(false),
      } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
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
      postPreviewMessage: jest
        .fn()
        .mockResolvedValue({ channelId: 'C1', messageTs: '111.222' }),
    };
    const idempotency = {
      acquireOnce: jest.fn().mockResolvedValue(true),
      isDone: jest.fn().mockResolvedValue(false),
    };
    const previewRepository = {
      attachSlackMessage: jest.fn().mockResolvedValue(undefined),
    };
    const orchestrator = new AutopilotOrchestrator(
      [previewTask] as any,
      slackNotifier as any,
      idempotency as any,
      createPreview as any,
      previewRepository as any,
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
    // preview 발송 후 첫 타깃 좌표(channel/ts)를 저장한다.
    expect(previewRepository.attachSlackMessage).toHaveBeenCalledWith({
      id: 'PV1',
      slackChannelId: 'C1',
      slackMessageTs: '111.222',
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
      { acquireOnce, isDone: jest.fn().mockResolvedValue(false) } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
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
      {
        acquireOnce: jest.fn().mockResolvedValue(true),
        isDone: jest.fn().mockResolvedValue(false),
      } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
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
      {
        acquireOnce,
        release,
        isDone: jest.fn().mockResolvedValue(false),
      } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
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
      {
        acquireOnce,
        release,
        isDone: jest.fn().mockResolvedValue(false),
      } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    await orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1');

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });

  // job-feed 알림 도장(claimForNotification) 선점을 발송 성공 뒤로 미루기 위해 추가한
  // 후처리 콜백 계약 — 되돌릴 수 없는 상태 변경은 발송이 실제로 나간 뒤에만 실행돼야
  // 한다(autopilot-task.port.ts AutopilotTaskResult.onDelivered 참조).
  describe('AutopilotTaskResult.onDelivered — 발송 성공 뒤 후처리', () => {
    it('발송 성공 시 task 의 onDelivered 콜백을 호출한다', async () => {
      const onDelivered = jest.fn().mockResolvedValue(undefined);
      const task = makeTask('daily-eval', {
        skip: false,
        summaryText: '본문',
        onDelivered,
      });
      const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
      const orchestrator = new AutopilotOrchestrator(
        [task] as never,
        { postMessage } as never,
        {
          acquireOnce: jest.fn().mockResolvedValue(true),
          isDone: jest.fn().mockResolvedValue(false),
        } as never,
        { execute: jest.fn() } as never,
        { attachSlackMessage: jest.fn() } as never,
      );

      await orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1');

      expect(onDelivered).toHaveBeenCalledTimes(1);
    });

    it('발송 실패 시 onDelivered 콜백을 호출하지 않는다', async () => {
      const onDelivered = jest.fn().mockResolvedValue(undefined);
      const task = makeTask('daily-eval', {
        skip: false,
        summaryText: '본문',
        onDelivered,
      });
      const postMessage = jest
        .fn()
        .mockRejectedValue(new Error('Slack API 오류'));
      const orchestrator = new AutopilotOrchestrator(
        [task] as never,
        { postMessage } as never,
        {
          acquireOnce: jest.fn().mockResolvedValue(true),
          release: jest.fn().mockResolvedValue(undefined),
          isDone: jest.fn().mockResolvedValue(false),
        } as never,
        { execute: jest.fn() } as never,
        { attachSlackMessage: jest.fn() } as never,
      );

      await expect(
        orchestrator.runGroup('evening', [T0_ENTRY], 'U1', 'C1'),
      ).rejects.toThrow('Slack API 오류');

      expect(onDelivered).not.toHaveBeenCalled();
    });

    it('onDelivered 콜백이 던져도 발송 결과는 성공으로 남는다 (release·rethrow 없음, 로그만)', async () => {
      const onDelivered = jest.fn().mockRejectedValue(new Error('DB 오류'));
      const task = makeTask('daily-eval', {
        skip: false,
        summaryText: '본문',
        onDelivered,
      });
      const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
      const release = jest.fn().mockResolvedValue(undefined);
      const orchestrator = new AutopilotOrchestrator(
        [task] as never,
        { postMessage } as never,
        {
          acquireOnce: jest.fn().mockResolvedValue(true),
          release,
          isDone: jest.fn().mockResolvedValue(false),
        } as never,
        { execute: jest.fn() } as never,
        { attachSlackMessage: jest.fn() } as never,
      );

      await expect(
        orchestrator.runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1'),
      ).resolves.toBeUndefined();

      expect(postMessage).toHaveBeenCalledTimes(1);
      expect(release).not.toHaveBeenCalled();
    });

    it('여러 task 의 onDelivered 콜백은 각각 격리해서 부른다 — 한 콜백 실패가 다른 콜백을 막지 않는다', async () => {
      const failingOnDelivered = jest
        .fn()
        .mockRejectedValue(new Error('첫 task 후처리 실패'));
      const succeedingOnDelivered = jest.fn().mockResolvedValue(undefined);
      const taskA = makeTask('job-feed', {
        skip: false,
        summaryText: 'A',
        onDelivered: failingOnDelivered,
      });
      const taskB = makeTask('job-feed-gap', {
        skip: false,
        summaryText: 'B',
        onDelivered: succeedingOnDelivered,
      });
      const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
      const orchestrator = new AutopilotOrchestrator(
        [taskA, taskB] as never,
        { postMessage } as never,
        {
          acquireOnce: jest.fn().mockResolvedValue(true),
          isDone: jest.fn().mockResolvedValue(false),
        } as never,
        { execute: jest.fn() } as never,
        { attachSlackMessage: jest.fn() } as never,
      );
      const e1 = makeEntry('job-feed', 'job-feed');
      const e2 = makeEntry('job-feed-gap', 'job-feed-gap');

      await orchestrator.runGroup('morning', [e1, e2], 'U1', 'C1');

      expect(failingOnDelivered).toHaveBeenCalledTimes(1);
      expect(succeedingOnDelivered).toHaveBeenCalledTimes(1);
    });
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
      postPreviewMessage: jest
        .fn()
        .mockResolvedValue({ channelId: 'C1', messageTs: '111.222' }),
    };
    const idempotency = {
      acquireOnce: jest.fn().mockResolvedValue(true),
      isDone: jest.fn().mockResolvedValue(false),
    };
    const previewRepository = {
      attachSlackMessage: jest.fn().mockResolvedValue(undefined),
    };
    const orchestrator = new AutopilotOrchestrator(
      [previewTask] as any,
      slackNotifier as any,
      idempotency as any,
      createPreview as any,
      previewRepository as any,
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
    // preview 별로 좌표 저장 — 각 preview 행은 좌표 하나(첫 타깃)만 가진다.
    expect(previewRepository.attachSlackMessage).toHaveBeenCalledTimes(2);
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
      {
        acquireOnce,
        release,
        isDone: jest.fn().mockResolvedValue(false),
      } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
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
      {
        acquireOnce,
        release,
        isDone: jest.fn().mockResolvedValue(false),
      } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
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

  // 회귀 방지 — 한 승인 카드(preview) 의 생성/발송 실패가 (1) 이후 카드를 죽이거나
  // (2) group 을 throw 시켜 메인 다이제스트·앞 카드를 중복 재발송(이중 발행)하지 않아야 한다.
  // 실패한 카드는 owner 에게 통지된다(조용한 유실 방지).
  it('한 preview 발송 실패는 격리 — 다른 preview 발송 + 실패 통지, group throw/release 없음', async () => {
    const previewA = {
      kind: 'EVENING_BLOG_PUBLISH',
      payload: {},
      previewText: 'A',
    };
    const previewB = {
      kind: 'EVENING_CAREER_REFLECT',
      payload: {},
      previewText: 'B',
    };
    const previewTask = {
      id: 'evening-retro-publish',
      run: jest
        .fn()
        .mockResolvedValue({ skip: true, previews: [previewA, previewB] }),
    };
    const createPreview = {
      execute: jest.fn().mockResolvedValue({ id: 'PV' }),
    };
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
    const postPreviewMessage = jest
      .fn()
      .mockRejectedValueOnce(new Error('Slack 카드 발송 실패')) // A 실패
      .mockResolvedValueOnce({ channelId: 'C1', messageTs: '1.2' }); // B 성공
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const release = jest.fn().mockResolvedValue(undefined);
    const orchestrator = new AutopilotOrchestrator(
      [previewTask] as never,
      { postMessage, postPreviewMessage } as never,
      {
        acquireOnce,
        release,
        isDone: jest.fn().mockResolvedValue(false),
      } as never,
      createPreview as never,
      { attachSlackMessage: jest.fn().mockResolvedValue(undefined) } as never,
    );

    await expect(
      orchestrator.runGroup(
        'evening',
        [makeEntry('evening-retro-publish', 'evening-retro-publish')],
        'U1',
        'C1',
      ),
    ).resolves.toBeUndefined();

    // A 실패해도 B 는 생성/발송된다(격리).
    expect(createPreview.execute).toHaveBeenCalledTimes(2);
    expect(postPreviewMessage).toHaveBeenCalledTimes(2);
    // 실패 카드는 owner 채널에 통지(조용한 유실 방지).
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: 'C1',
        text: expect.stringContaining('승인 카드 발송 실패'),
      }),
    );
    // 메인 다이제스트 중복 재발송/이중 발행 방지 — throw/release 없음.
    expect(release).not.toHaveBeenCalled();
  });

  // 회귀 방지 — stalled 재처리로 같은 슬롯이 다시 들어오면, 완주 여부를 task 실행 "앞" 에서
  // 확인해 LLM 을 한 번도 호출하지 않고 끝나야 한다.
  // (이전엔 확인이 발송 직전에만 있어 재실행이 task 를 전부 다시 돌린 뒤 발송만 skip 했고,
  //  그 재실행이 또 lockDuration 을 넘겨 stalled 가 되는 자기 증폭 루프가 됐다 —
  //  2026-07-26 morning-briefing 12회 연쇄 재실행, 각 16~33분, LLM 12회 낭비.)
  it('완주된 슬롯 재진입(isDone=true) → task 를 한 개도 실행하지 않고 즉시 종료', async () => {
    const task = makeTask('daily-eval', { skip: false, summaryText: '본문' });
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const isDone = jest.fn().mockResolvedValue(true);
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce, isDone } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    await orchestrator.runGroup(
      'daily-eval',
      [T0_ENTRY],
      'U1',
      'C1',
      'repeat:abc:1',
    );

    // 핵심 — LLM 을 태우는 task 가 실행되지 않아야 증폭 루프가 끊긴다.
    expect(task.run).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    // 진입에서 끊었으므로 발송 직전 선점까지 가지 않는다.
    expect(acquireOnce).not.toHaveBeenCalled();
  });

  // 재진입 확인은 "슬롯(job id)" 단위, 발송 가드는 "발화일" 단위 — 두 키는 달라야 한다.
  // 같은 키를 쓰면 하루 여러 번 도는 그룹이 첫 발송 이후 그날 내내 진입에서 끊긴다.
  it('진입 확인은 슬롯 키, 발송 선점은 날짜 키 — 서로 다른 키를 본다', async () => {
    const task = makeTask('daily-eval', { skip: false, summaryText: '본문' });
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const isDone = jest.fn().mockResolvedValue(false);
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage: jest.fn().mockResolvedValue({ ts: undefined }) } as never,
      { acquireOnce, isDone } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    await orchestrator.runGroup(
      'preview-sweeper',
      [T0_ENTRY],
      'U1',
      'C1',
      'repeat:abc:1',
    );

    const checkedKey: string = isDone.mock.calls[0][0];
    const sendGuardKey: string = acquireOnce.mock.calls[0][0];
    expect(checkedKey).toBe('autopilot:slot:preview-sweeper:repeat:abc:1');
    expect(sendGuardKey).toContain('autopilot:preview-sweeper:');
    expect(sendGuardKey).not.toContain('slot');
    // 완주 후 슬롯 표식을 남겨야 stalled 재큐가 진입에서 끊긴다.
    expect(acquireOnce).toHaveBeenCalledWith(
      'autopilot:slot:preview-sweeper:repeat:abc:1',
      expect.any(Number),
    );
  });

  // 회귀 방지 — preview-sweeper(*/10) / pr-review-sweep(*/3) / run-sweeper(매시간) 처럼 하루에
  // 여러 번 도는 그룹은, 그날 이미 한 번 발송해 날짜 가드가 소비된 뒤에도 다음 슬롯의 실제
  // 작업(만료 카드 정리·좀비 run 정리)이 계속 실행돼야 한다. 발송만 중복 차단된다.
  it('같은 날 다음 슬롯 → 날짜 가드가 소진돼도 task 는 실행된다 (발송만 차단)', async () => {
    const task = makeTask('daily-eval', {
      skip: false,
      summaryText: '정리 1건',
    });
    const postMessage = jest.fn().mockResolvedValue({ ts: undefined });
    // 날짜 가드는 이미 소비됨(false) / 이번 슬롯은 처음(isDone=false).
    const acquireOnce = jest.fn().mockResolvedValue(false);
    const isDone = jest.fn().mockResolvedValue(false);
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce, isDone } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    await orchestrator.runGroup(
      'preview-sweeper',
      [T0_ENTRY],
      'U1',
      'C1',
      'repeat:abc:2',
    );

    expect(task.run).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
    // 발송만 차단됐을 뿐 task 는 다 돌았으므로 이 슬롯도 완주 표식을 남겨야 한다.
    // 안 남기면 하루에 여러 번 도는 그룹은 첫 슬롯 외 전부가 표식 없이 끝나, stalled
    // 재큐가 진입 확인을 통과해 task 를 전부 재실행한다(증폭 루프 잔존).
    expect(acquireOnce).toHaveBeenCalledWith(
      'autopilot:slot:preview-sweeper:repeat:abc:2',
      expect.any(Number),
    );
  });

  // 실행 도중 강제 종료된 슬롯은 표식이 없어야 재시도가 산다 — 발송 실패 경로에서
  // 완주 표식이 새지 않는지 고정한다(위 수정이 표식을 과하게 남기지 않도록).
  it('메인 발송 실패 → 슬롯 완주 표식을 남기지 않는다 (재시도 보존)', async () => {
    const task = makeTask('daily-eval', { skip: false, summaryText: '보고' });
    const postMessage = jest.fn().mockRejectedValue(new Error('slack down'));
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const isDone = jest.fn().mockResolvedValue(false);
    const release = jest.fn().mockResolvedValue(undefined);
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce, isDone, release } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    await expect(
      orchestrator.runGroup(
        'morning-briefing',
        [T0_ENTRY],
        'U1',
        'C1',
        'repeat:abc:1',
      ),
    ).rejects.toThrow('slack down');

    // 날짜 가드는 롤백되고(재시도가 다시 발송 가능), 이 실행은 슬롯 표식을 남기지 않는다.
    const releasedKeys = release.mock.calls.map(([key]: [string]) => key);
    expect(releasedKeys.some((key) => !key.startsWith('autopilot:slot:'))).toBe(
      true,
    );
    const slotAcquires = acquireOnce.mock.calls.filter(([key]: [string]) =>
      key.startsWith('autopilot:slot:'),
    );
    expect(slotAcquires).toHaveLength(0);
  });

  // 회귀 방지 — 겹친 재실행이 "이미 발송됨" 으로 판단해 슬롯 표식을 남긴 뒤, 선점한 쪽의
  // 발송이 실패하면 그 표식이 남아 재시도가 진입에서 차단된다(보고가 25h 통째 누락).
  // 발송 실패 롤백은 날짜 가드뿐 아니라 슬롯 표식도 해제해야 한다.
  it('메인 발송 실패 → 슬롯 표식도 해제한다 (겹친 재실행이 남긴 표식까지 롤백)', async () => {
    const task = makeTask('daily-eval', { skip: false, summaryText: '보고' });
    const postMessage = jest.fn().mockRejectedValue(new Error('slack down'));
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const isDone = jest.fn().mockResolvedValue(false);
    const release = jest.fn().mockResolvedValue(undefined);
    const orchestrator = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce, isDone, release } as never,
      { execute: jest.fn() } as never,
      { attachSlackMessage: jest.fn() } as never,
    );

    await expect(
      orchestrator.runGroup(
        'morning-briefing',
        [T0_ENTRY],
        'U1',
        'C1',
        'repeat:abc:1',
      ),
    ).rejects.toThrow('slack down');

    expect(release).toHaveBeenCalledWith(
      'autopilot:slot:morning-briefing:repeat:abc:1',
    );
  });
});
