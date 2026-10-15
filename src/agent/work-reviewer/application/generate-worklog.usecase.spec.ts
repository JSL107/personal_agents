import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { WorkSessionDigestService } from '../../../local-sessions/application/work-session-digest.service';
import { WorkSessionDigest } from '../../../local-sessions/domain/work-session-digest';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { AppendWorklogUsecase } from '../../../notion/application/append-worklog.usecase';
import { DAILY_REVIEW_OUTPUT_SCHEMA } from '../domain/prompt/daily-review.schema';
import { WORK_REVIEWER_SYSTEM_PROMPT } from '../domain/prompt/work-reviewer-system.prompt';
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
    decisions: [],
    risks: [],
    nextActions: ['/review-pr 설계'],
    oneLineAchievement: 'Phase 3 `/worklog` E2E 착수 완료',
  };

  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let appendWorklogExecute: jest.Mock;
  let usecase: GenerateWorklogUsecase;
  let listSince: jest.Mock;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run({ agentRunId: 42 });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 42,
      };
    });
    appendWorklogExecute = jest.fn().mockResolvedValue(null);
    listSince = jest.fn().mockReturnValue([]);

    usecase = new GenerateWorklogUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      { execute: agentRunServiceExecute } as unknown as AgentRunService,
      { execute: appendWorklogExecute } as unknown as AppendWorklogUsecase,
      { listSince } as unknown as WorkSessionDigestService,
    );
  });

  it('세션이 0개면 prompt, systemPrompt, evidence가 기존 값과 정확히 같다', async () => {
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validReview),
      modelUsed: 'codex-cli',
    });
    await usecase.execute({ workText: '  완료  ', slackUserId: 'U123' });
    expect(modelRouter.route.mock.calls[0][0].request.prompt).toBe('완료');
    expect(modelRouter.route.mock.calls[0][0].request.systemPrompt).toBe(
      WORK_REVIEWER_SYSTEM_PROMPT,
    );
    expect(agentRunServiceExecute.mock.calls[0][0].evidence).toEqual([
      {
        sourceType: 'SLACK_COMMAND_WORKLOG',
        sourceId: 'U123',
        payload: { workText: '완료' },
      },
    ]);
  });

  it('세션이 있으면 섹션, NOTICE, 본문 없는 evidence가 붙는다', async () => {
    const session: WorkSessionDigest = {
      source: 'codex',
      sessionId: 's1',
      repo: 'project',
      branch: null,
      title: null,
      pullRequests: [],
      firstPrompt: '구현',
      lastPrompt: null,
      lastReply: '완료',
      lastActivityAt: new Date(),
    };
    listSince.mockReturnValue([session]);
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validReview),
      modelUsed: 'codex-cli',
    });
    await usecase.execute({ workText: '완료', slackUserId: 'U123' });
    expect(listSince).toHaveBeenCalledWith({
      since: expect.any(Date),
      slackUserId: 'U123',
    });
    expect(modelRouter.route.mock.calls[0][0].request.prompt).toContain(
      '[로컬 작업 세션',
    );
    expect(modelRouter.route.mock.calls[0][0].request.systemPrompt).toContain(
      '<untrusted-input>',
    );
    expect(agentRunServiceExecute.mock.calls[0][0].evidence[1].sourceType).toBe(
      'LOCAL_WORK_SESSIONS',
    );
    expect(
      JSON.stringify(agentRunServiceExecute.mock.calls[0][0].evidence[1]),
    ).not.toContain('firstPrompt');
  });

  it('주간 경로에서는 세션 조회를 하지 않는다', async () => {
    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validReview),
      modelUsed: 'codex-cli',
    });
    await usecase.execute({
      workText: '완료',
      slackUserId: 'U123',
      triggerType: TriggerType.WEEKLY_SUMMARY_CRON,
    });
    expect(listSince).not.toHaveBeenCalled();
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

    expect(result.result).toEqual(validReview);
    expect(result.modelUsed).toBe('codex-cli');
    expect(result.agentRunId).toBe(42);
    expect(modelRouter.route).toHaveBeenCalledWith({
      agentType: AgentType.WORK_REVIEWER,
      request: expect.objectContaining({
        prompt: '오늘 Work Reviewer 구현. 테스트 8건 추가.',
        systemPrompt: expect.any(String),
        // objectContaining 이라 이 줄이 없으면 스키마를 빼먹어도 테스트가 통과한다 —
        // 형태 강제가 조용히 사라지는 걸 막으려 명시한다.
        outputSchema: DAILY_REVIEW_OUTPUT_SCHEMA,
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
