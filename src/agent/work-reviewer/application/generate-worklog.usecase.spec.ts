import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { WorkReviewerException } from '../domain/work-reviewer.exception';
import { DailyReview } from '../domain/work-reviewer.type';
import { WorkReviewerErrorCode } from '../domain/work-reviewer-error-code.enum';
import { GenerateWorklogUsecase } from './generate-worklog.usecase';

describe('GenerateWorklogUsecase', () => {
  const validReview: DailyReview = {
    summary: 'Work Reviewer 에이전트 구현 마무리',
    impact: {
      quantitative: ['unit test +8건'],
      qualitative: '회고 자동화 파이프라인 가동',
    },
    improvementBeforeAfter: null,
    nextActions: ['/review-pr 설계'],
    oneLineAchievement: 'Phase 3 `/worklog` E2E 착수 완료',
  };

  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let usecase: GenerateWorklogUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run();
      return execution.result;
    });

    usecase = new GenerateWorklogUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      { execute: agentRunServiceExecute } as unknown as AgentRunService,
    );
  });

  it('모델 응답을 DailyReview 로 파싱해 반환한다', async () => {
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validReview),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    } satisfies CompletionResponse);

    const result = await usecase.execute({
      workText: '오늘 Work Reviewer 구현. 테스트 8건 추가.',
      slackUserId: 'U123',
    });

    expect(result).toEqual(validReview);
    expect(modelRouter.route).toHaveBeenCalledWith({
      agentType: AgentType.WORK_REVIEWER,
      request: expect.objectContaining({
        prompt: '오늘 Work Reviewer 구현. 테스트 8건 추가.',
        systemPrompt: expect.any(String),
      }),
    });
  });

  it('AgentRunService 에 WORK_REVIEWER / SLACK_COMMAND_WORKLOG / evidence 를 전달한다', async () => {
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validReview),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });

    await usecase.execute({ workText: 'task A / task B', slackUserId: 'U123' });

    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.WORK_REVIEWER);
    expect(call.triggerType).toBe('SLACK_COMMAND_WORKLOG');
    expect(call.inputSnapshot).toEqual({
      workText: 'task A / task B',
      slackUserId: 'U123',
    });
    expect(call.evidence).toEqual([
      {
        sourceType: 'SLACK_COMMAND_WORKLOG',
        sourceId: 'U123',
        payload: { workText: 'task A / task B' },
      },
    ]);
  });

  it('workText 가 비어있으면 EMPTY_WORK_INPUT 예외', async () => {
    await expect(
      usecase.execute({ workText: '   ', slackUserId: 'U123' }),
    ).rejects.toMatchObject({
      workReviewerErrorCode: WorkReviewerErrorCode.EMPTY_WORK_INPUT,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('모델 응답이 JSON 스키마에 안 맞으면 INVALID_MODEL_OUTPUT 예외', async () => {
    modelRouter.route.mockResolvedValue({
      text: 'not a review',
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });

    await expect(
      usecase.execute({ workText: 'x', slackUserId: 'U123' }),
    ).rejects.toBeInstanceOf(WorkReviewerException);
  });
});
