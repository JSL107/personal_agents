import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { CodexQuotaExceededException } from '../../../model-router/infrastructure/codex-cli.provider';
import { OpsSupervisorAdvisorPort } from '../../../ops-supervisor/domain/port/ops-supervisor-advisor.port';
import { PreviewActionRepositoryPort } from '../../../preview-gate/domain/port/preview-action.repository.port';
import { OpsSupervisorAutopilotTask } from './ops-supervisor.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-01' };

const makePreviewRepository = (
  outcomes: Awaited<
    ReturnType<PreviewActionRepositoryPort['countOutcomesByKind']>
  > = [],
) => ({ countOutcomesByKind: jest.fn().mockResolvedValue(outcomes) });

describe('OpsSupervisorAutopilotTask', () => {
  it('이상 없으면 하트비트 요약을 내고 제안기는 호출하지 않는다', async () => {
    const service = {
      aggregateRunStats: jest.fn().mockResolvedValue([
        {
          agentType: 'PM',
          total: 10,
          failed: 0,
          failRate: 0,
          avgDurationMs: 100,
        },
      ]),
      aggregateRetryCounts: jest.fn().mockResolvedValue([]),
      aggregateSweptCounts: jest.fn().mockResolvedValue([]),
    };
    const previewRepository = makePreviewRepository();
    const advisor = { advise: jest.fn() };
    const task = new OpsSupervisorAutopilotTask(
      service as unknown as AgentRunService,
      previewRepository as unknown as PreviewActionRepositoryPort,
      advisor as OpsSupervisorAdvisorPort,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('이상 없음');
    expect(advisor.advise).not.toHaveBeenCalled();
  });

  it('이상 있으면 제안기를 호출해 리포트에 포함한다', async () => {
    const service = {
      aggregateRunStats: jest.fn().mockResolvedValue([
        {
          agentType: 'PM',
          total: 10,
          failed: 4,
          failRate: 0.4,
          avgDurationMs: 100,
        },
      ]),
      aggregateRetryCounts: jest.fn().mockResolvedValue([]),
      aggregateSweptCounts: jest.fn().mockResolvedValue([]),
    };
    const previewRepository = makePreviewRepository();
    const advisor = {
      advise: jest.fn().mockResolvedValue('- PM: 인증 만료 의심'),
    };
    const task = new OpsSupervisorAutopilotTask(
      service as unknown as AgentRunService,
      previewRepository as unknown as PreviewActionRepositoryPort,
      advisor,
    );

    const result = await task.run(context);

    expect(advisor.advise).toHaveBeenCalled();
    expect(result.summaryText).toContain('인증 만료 의심');
  });

  it('제안기 쿼터 소진 시 리포트는 내되 제안 생략', async () => {
    const service = {
      aggregateRunStats: jest.fn().mockResolvedValue([
        {
          agentType: 'PM',
          total: 10,
          failed: 4,
          failRate: 0.4,
          avgDurationMs: 100,
        },
      ]),
      aggregateRetryCounts: jest.fn().mockResolvedValue([]),
      aggregateSweptCounts: jest.fn().mockResolvedValue([]),
    };
    const previewRepository = makePreviewRepository();
    const advisor = {
      advise: jest.fn().mockRejectedValue(new CodexQuotaExceededException()),
    };
    const task = new OpsSupervisorAutopilotTask(
      service as unknown as AgentRunService,
      previewRepository as unknown as PreviewActionRepositoryPort,
      advisor,
    );

    const result = await task.run(context);

    expect(result.summaryText).toContain('제안 생략');
  });

  it('데이터 전무 + 이상 0건이면 skip', async () => {
    const service = {
      aggregateRunStats: jest.fn().mockResolvedValue([]),
      aggregateRetryCounts: jest.fn().mockResolvedValue([]),
      aggregateSweptCounts: jest.fn().mockResolvedValue([]),
    };
    const previewRepository = makePreviewRepository();
    const task = new OpsSupervisorAutopilotTask(
      service as unknown as AgentRunService,
      previewRepository as unknown as PreviewActionRepositoryPort,
      undefined,
    );

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  it('agent run이 없어도 preview 데이터가 있으면 리포트를 생성한다', async () => {
    const service = {
      aggregateRunStats: jest.fn().mockResolvedValue([]),
      aggregateRetryCounts: jest.fn().mockResolvedValue([]),
      aggregateSweptCounts: jest.fn().mockResolvedValue([]),
    };
    const previewRepository = makePreviewRepository([
      { kind: 'PM_WRITE_BACK', applied: 3, cancelled: 0, expired: 0 },
    ]);
    const task = new OpsSupervisorAutopilotTask(
      service as unknown as AgentRunService,
      previewRepository as unknown as PreviewActionRepositoryPort,
      undefined,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('이상 없음');
  });
});
