import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { DailyPlan, TaskItem } from '../../pm/domain/pm-agent.type';
import { PoShadowException } from '../domain/po-shadow.exception';
import { PoShadowReport } from '../domain/po-shadow.type';
import { PoShadowErrorCode } from '../domain/po-shadow-error-code.enum';
import { GeneratePoShadowUsecase } from './generate-po-shadow.usecase';

const task = (title: string, overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: overrides.id ?? `user:${title}`,
  title,
  source: overrides.source ?? 'USER_INPUT',
  subtasks: overrides.subtasks ?? [],
  isCriticalPath: overrides.isCriticalPath ?? false,
});

const yesterdayPlan: DailyPlan = {
  topPriority: task('PM Agent 마무리', { isCriticalPath: true }),
  varianceAnalysis: {
    rolledOverTasks: [],
    analysisReasoning: '(이월 없음)',
  },
  morning: [task('agent-run')],
  afternoon: [task('Slack handler')],
  blocker: null,
  estimatedHours: 6,
  reasoning: 'r',
};

const validReport: PoShadowReport = {
  priorityRecheck: 'PM 마무리는 release 직전 맞음',
  missingRequirements: ['모델 fallback 모니터링'],
  releaseRisks: ['Codex 쿼터 소진 시 사용자 응답 지연'],
  realPurposeQuestion: '내부 도구 완성도 vs 실 사용자 가치 — 어느 쪽 우선인가?',
  recommendation: '오늘은 PM 마무리 진행하되 fallback 알림 추가 검토',
};

describe('GeneratePoShadowUsecase', () => {
  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let agentRunServiceFindLatest: jest.Mock;
  let usecase: GeneratePoShadowUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 11 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 11,
      };
    });
    agentRunServiceFindLatest = jest.fn().mockResolvedValue({
      id: 99,
      output: yesterdayPlan,
      endedAt: new Date('2026-04-23T05:00:00Z'),
    });

    usecase = new GeneratePoShadowUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      {
        execute: agentRunServiceExecute,
        findLatestSucceededRun: agentRunServiceFindLatest,
      } as unknown as AgentRunService,
    );

    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validReport),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    } satisfies CompletionResponse);
  });

  it('직전 PM run 없으면 NO_RECENT_PLAN 예외', async () => {
    agentRunServiceFindLatest.mockResolvedValue(null);
    await expect(
      usecase.execute({ extraContext: '', slackUserId: 'U1' }),
    ).rejects.toMatchObject({
      poShadowErrorCode: PoShadowErrorCode.NO_RECENT_PLAN,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('직전 PM output 이 DailyPlan 스키마 안 맞으면 NO_RECENT_PLAN 예외', async () => {
    agentRunServiceFindLatest.mockResolvedValue({
      id: 99,
      output: { not: 'a plan' },
      endedAt: new Date(),
    });
    await expect(
      usecase.execute({ extraContext: '', slackUserId: 'U1' }),
    ).rejects.toBeInstanceOf(PoShadowException);
  });

  it('모델 응답을 PoShadowReport 로 파싱해 반환', async () => {
    const result = await usecase.execute({
      extraContext: 'v1.2 release 직전',
      slackUserId: 'U1',
    });
    expect(result.result).toEqual(validReport);
    expect(result.modelUsed).toBe('codex-cli');
    expect(result.agentRunId).toBe(11);
  });

  it('AgentRunService 에 PO_SHADOW + SLACK_COMMAND_PO_SHADOW 전달 + evidence', async () => {
    await usecase.execute({
      extraContext: 'v1.2 release 직전',
      slackUserId: 'U1',
    });
    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.PO_SHADOW);
    expect(call.triggerType).toBe('SLACK_COMMAND_PO_SHADOW');
    expect(call.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'PRIOR_DAILY_PLAN',
          sourceId: '99',
        }),
        expect.objectContaining({
          sourceType: 'SLACK_COMMAND_PO_SHADOW',
          sourceId: 'U1',
        }),
      ]),
    );
    expect(call.inputSnapshot).toMatchObject({
      slackUserId: 'U1',
      sourcePlanAgentRunId: 99,
      extraContextLength: 'v1.2 release 직전'.length,
    });
  });

  it('triggerType을 지정하면 AgentRunService에 그대로 전달한다', async () => {
    await usecase.execute({
      extraContext: '',
      slackUserId: 'U1',
      triggerType: TriggerType.AUTOPILOT_PO_SHADOW_CRON,
    });

    expect(agentRunServiceExecute.mock.calls[0][0].triggerType).toBe(
      TriggerType.AUTOPILOT_PO_SHADOW_CRON,
    );
  });

  it('extraContext 비어있으면 evidence 에 SLACK_COMMAND_PO_SHADOW 포함되지 않음 (PRIOR_DAILY_PLAN 단독)', async () => {
    await usecase.execute({ extraContext: '', slackUserId: 'U1' });
    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.evidence).toHaveLength(1);
    expect(call.evidence[0].sourceType).toBe('PRIOR_DAILY_PLAN');
  });

  it('prompt 에 직전 plan + 추가 컨텍스트 두 섹션 모두 포함', async () => {
    await usecase.execute({
      extraContext: 'v1.2 release 직전',
      slackUserId: 'U1',
    });
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('[직전 PM plan');
    expect(promptArg).toContain('PM Agent 마무리');
    expect(promptArg).toContain('[추가 컨텍스트]');
    expect(promptArg).toContain('v1.2 release 직전');
  });
});
