import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import { SecretariatAutopilotTask } from './secretariat.autopilot-task';

describe('SecretariatAutopilotTask', () => {
  const buildTask = (overrides: {
    stats?: unknown[];
    activeRuns?: unknown[];
    openPreviews?: unknown[];
    failedRuns?: unknown[];
  }) => {
    const agentRunService = {
      aggregateRunStats: jest.fn().mockResolvedValue(overrides.stats ?? []),
      findActiveRuns: jest.fn().mockResolvedValue(overrides.activeRuns ?? []),
      findFailedRunsSince: jest
        .fn()
        .mockResolvedValue(overrides.failedRuns ?? []),
    } as unknown as AgentRunService;
    const findAllOpenPreviews = {
      execute: jest.fn().mockResolvedValue(overrides.openPreviews ?? []),
    } as unknown as FindAllOpenPreviewsUsecase;
    return {
      task: new SecretariatAutopilotTask(agentRunService, findAllOpenPreviews),
      agentRunService,
    };
  };

  it('보고할 것이 하나도 없으면 skip 한다 (앱이 멈춰 있던 날)', async () => {
    const { task } = buildTask({});

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-03',
    });

    expect(result).toEqual({ skip: true });
  });

  it('다섯 항목을 고정 순서로 한 장에 담는다', async () => {
    const { task } = buildTask({
      stats: [
        {
          agentType: 'PM',
          total: 2,
          failed: 1,
          failRate: 0.5,
          avgDurationMs: 1,
        },
      ],
      failedRuns: [
        {
          agentType: 'CODE_REVIEWER',
          reason: '모델 호출 실패 (CHATGPT)',
          endedAt: new Date('2026-08-02T09:00:00.000Z'),
        },
      ],
    });

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-03',
    });

    expect(result.skip).toBe(false);
    const text = result.summaryText ?? '';
    expect(text).toContain('📋 *비서실* — 2026-08-03 · 지난 24시간');
    expect(text).toContain('*① 완료* — 1건 · PM 1');
    expect(text).toContain('*② 진행 중* — 없음');
    expect(text).toContain('*③ 대표 승인 대기* — 없음');
    expect(text).toContain(
      '*④ 막힌 것* — 1종\n   • CODE_REVIEWER 1건 — 모델 호출 실패 (CHATGPT)',
    );
    // 실패 1회는 결정거리가 아니다 — 다음 슬롯이 재시도한다.
    expect(text).toContain('*⑤ 오늘 결정할 것* — 없음');
  });

  it('LLM 을 부르지 않고 24시간 창으로만 조회한다', async () => {
    const { task, agentRunService } = buildTask({});

    await task.run({ ownerSlackUserId: 'U1', firedAtKst: '2026-08-03' });

    expect(agentRunService.aggregateRunStats).toHaveBeenCalledWith({
      sinceDays: 1,
    });
    expect(agentRunService.findFailedRunsSince).toHaveBeenCalledWith({
      withinMinutes: 1440,
    });
  });
});
