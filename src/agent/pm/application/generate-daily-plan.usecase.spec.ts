import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { PmAgentException } from '../domain/pm-agent.exception';
import { DailyPlan } from '../domain/pm-agent.type';
import { PmAgentErrorCode } from '../domain/pm-agent-error-code.enum';
import { GenerateDailyPlanUsecase } from './generate-daily-plan.usecase';

describe('GenerateDailyPlanUsecase', () => {
  const validPlan: DailyPlan = {
    topPriority: 'PM Agent /today 구현',
    morning: ['agent-run 모듈', 'PM 유스케이스'],
    afternoon: ['Slack 핸들러', 'E2E 검증'],
    blocker: null,
    estimatedHours: 6,
    reasoning: '집중이 필요한 구현을 오전에 배치',
  };

  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let usecase: GenerateDailyPlanUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run();
      return execution.result;
    });

    usecase = new GenerateDailyPlanUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      { execute: agentRunServiceExecute } as unknown as AgentRunService,
    );
  });

  it('모델 응답을 DailyPlan 으로 파싱해 반환한다', async () => {
    // Given
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validPlan),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    } satisfies CompletionResponse);

    // When
    const result = await usecase.execute({
      tasksText: 'PM Agent 구현 / 리뷰 대응',
      slackUserId: 'U123',
    });

    // Then
    expect(result).toEqual(validPlan);
    expect(modelRouter.route).toHaveBeenCalledWith({
      agentType: AgentType.PM,
      request: expect.objectContaining({
        prompt: 'PM Agent 구현 / 리뷰 대응',
        systemPrompt: expect.any(String),
      }),
    });
  });

  it('AgentRunService 에 PM / SLACK_COMMAND_TODAY / evidence 스냅샷을 전달한다', async () => {
    // Given
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validPlan),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });

    // When
    await usecase.execute({
      tasksText: 'task A / task B',
      slackUserId: 'U123',
    });

    // Then
    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.PM);
    expect(call.triggerType).toBe('SLACK_COMMAND_TODAY');
    expect(call.inputSnapshot).toEqual({
      tasksText: 'task A / task B',
      slackUserId: 'U123',
    });
    expect(call.evidence).toEqual([
      {
        sourceType: 'SLACK_COMMAND_TODAY',
        sourceId: 'U123',
        payload: { tasksText: 'task A / task B' },
      },
    ]);
  });

  it('tasksText 가 비어있으면 EMPTY_TASKS_INPUT 예외', async () => {
    await expect(
      usecase.execute({ tasksText: '   ', slackUserId: 'U123' }),
    ).rejects.toMatchObject({
      pmAgentErrorCode: PmAgentErrorCode.EMPTY_TASKS_INPUT,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('모델 응답이 JSON 스키마에 안 맞으면 INVALID_MODEL_OUTPUT 예외', async () => {
    // Given
    modelRouter.route.mockResolvedValue({
      text: 'not a plan',
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });

    // When / Then
    await expect(
      usecase.execute({ tasksText: 'x', slackUserId: 'U123' }),
    ).rejects.toBeInstanceOf(PmAgentException);
  });
});
