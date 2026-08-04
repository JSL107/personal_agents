import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import { SecretariatAutopilotTask } from './secretariat.autopilot-task';

const OWNER = 'U_OWNER';

describe('SecretariatAutopilotTask', () => {
  const buildTask = (overrides: {
    succeeded?: unknown[];
    activeRuns?: unknown[];
    openPreviews?: unknown[];
    failedRuns?: unknown[];
    recentlyFinished?: unknown[];
  }) => {
    const agentRunService = {
      aggregateSucceededCounts: jest
        .fn()
        .mockResolvedValue(overrides.succeeded ?? []),
      findActiveRuns: jest.fn().mockResolvedValue(overrides.activeRuns ?? []),
      findFailedRunsSince: jest
        .fn()
        .mockResolvedValue(overrides.failedRuns ?? []),
      findRecentlyFinishedRuns: jest
        .fn()
        .mockResolvedValue(overrides.recentlyFinished ?? []),
    } as unknown as AgentRunService;
    const findAllOpenPreviews = {
      execute: jest.fn().mockResolvedValue(overrides.openPreviews ?? []),
    } as unknown as FindAllOpenPreviewsUsecase;
    return {
      task: new SecretariatAutopilotTask(agentRunService, findAllOpenPreviews),
      agentRunService,
    };
  };

  const run = (task: SecretariatAutopilotTask) =>
    task.run({ ownerSlackUserId: OWNER, firedAtKst: '2026-08-03' });

  it('보고할 것이 하나도 없으면 skip 한다 (앱이 멈춰 있던 날)', async () => {
    const { task } = buildTask({});

    expect(await run(task)).toEqual({ skip: true });
  });

  it('다섯 항목을 고정 순서로 한 장에 담는다', async () => {
    const { task } = buildTask({
      succeeded: [{ agentType: 'PM', succeeded: 1 }],
      failedRuns: [
        {
          agentType: 'CODE_REVIEWER',
          reason: '모델 호출 실패 (CHATGPT)',
          endedAt: new Date('2026-08-02T09:00:00.000Z'),
        },
      ],
      recentlyFinished: [
        {
          agentType: 'CODE_REVIEWER',
          status: 'FAILED',
          endedAt: new Date('2026-08-04T05:00:00.000Z'),
        },
      ],
    });

    const result = await run(task);

    expect(result.skip).toBe(false);
    const text = result.summaryText ?? '';
    expect(text).toContain('📋 *비서실* — 2026-08-03 · 지난 24시간');
    expect(text).toContain('*① 완료* — 1건 · PM 1');
    expect(text).toContain('*② 진행 중* — 없음');
    expect(text).toContain('*③ 대표 승인 대기* — 없음');
    expect(text).toContain(
      '*④ 막힌 것* — 1종\n   • CODE_REVIEWER 1건 — 모델 호출 실패 (CHATGPT)',
    );
    // 실패 1건은 결정거리가 아니다 — 다음 슬롯이 재시도한다.
    expect(text).toContain('*⑤ 오늘 결정할 것* — 없음');
  });

  // `unresolvedAgentTypes` 는 "실패 이력이 있어도 최신 종료가 성공이면 막힌 것에서 뺀다" 는
  // 화이트리스트다. 조회(findRecentlyFinishedRuns)가 성공까지 함께 주게 됐으므로, 여기서
  // FAILED 만 걸러내지 않으면 복구된 에이전트가 다시 "막힌 것" 으로 올라온다.
  it('실패 후 성공으로 복구된 에이전트는 막힌 것에서 빠진다', async () => {
    const { task } = buildTask({
      // 완료 한 줄을 함께 둔다 — 막힌 것까지 비면 보고 자체가 skip 되어 검증할 텍스트가 없다.
      succeeded: [{ agentType: 'PM', succeeded: 1 }],
      failedRuns: [
        {
          agentType: 'CODE_REVIEWER',
          reason: '모델 호출 실패 (CHATGPT)',
          endedAt: new Date('2026-08-02T09:00:00.000Z'),
        },
      ],
      recentlyFinished: [
        {
          agentType: 'CODE_REVIEWER',
          status: 'SUCCEEDED',
          endedAt: new Date('2026-08-04T05:00:00.000Z'),
        },
      ],
    });

    const text = (await run(task)).summaryText ?? '';

    expect(text).toContain('*④ 막힌 것* — 없음');
  });

  it('owner 가 아닌 사용자의 승인 카드는 싣지 않는다', async () => {
    // FindAllOpenPreviewsUsecase 는 콘솔 관제용이라 사용자 구분 없이 전부 돌려준다.
    // 이 보고는 owner 에게 가고 owner 만 승인할 수 있으므로 여기서 좁힌다.
    const { task } = buildTask({
      openPreviews: [
        {
          slackUserId: 'U_OTHER',
          previewText: '남의 카드',
          expiresAt: new Date(Date.now() + 5 * 3600_000),
        },
        {
          slackUserId: OWNER,
          previewText: '내 카드',
          expiresAt: new Date(Date.now() + 5 * 3600_000),
        },
      ],
    });

    const text = (await run(task)).summaryText ?? '';

    expect(text).toContain('*③ 대표 승인 대기* — 1건');
    expect(text).toContain('내 카드');
    expect(text).not.toContain('남의 카드');
  });

  it('LLM 을 부르지 않고 24시간 창으로만 조회한다', async () => {
    const { task, agentRunService } = buildTask({});

    await run(task);

    expect(agentRunService.aggregateSucceededCounts).toHaveBeenCalledWith({
      sinceDays: 1,
    });
    expect(agentRunService.findFailedRunsSince).toHaveBeenCalledWith({
      withinMinutes: 1440,
    });
    expect(agentRunService.findRecentlyFinishedRuns).toHaveBeenCalledWith({
      withinMinutes: 1440,
    });
  });
});
