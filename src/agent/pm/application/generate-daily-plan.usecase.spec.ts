import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
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
  let agentRunServiceFindLatest: jest.Mock;
  let listAssignedTasksExecute: jest.Mock;
  let usecase: GenerateDailyPlanUsecase;

  beforeEach(() => {
    modelRouter = { route: jest.fn() };
    agentRunServiceExecute = jest.fn(async (input) => {
      const execution = await input.run();
      return execution.result;
    });
    agentRunServiceFindLatest = jest.fn().mockResolvedValue(null);
    listAssignedTasksExecute = jest.fn();

    usecase = new GenerateDailyPlanUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      {
        execute: agentRunServiceExecute,
        findLatestSucceededRun: agentRunServiceFindLatest,
      } as unknown as AgentRunService,
      {
        execute: listAssignedTasksExecute,
      } as unknown as ListAssignedTasksUsecase,
    );

    modelRouter.route.mockResolvedValue({
      text: JSON.stringify(validPlan),
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    } satisfies CompletionResponse);
  });

  it('GitHub 자동 수집 성공 시 prompt 에 [사용자 입력] + GitHub 섹션이 모두 포함된다', async () => {
    listAssignedTasksExecute.mockResolvedValue({
      issues: [
        {
          number: 12,
          title: 't',
          repo: 'a/b',
          url: 'u',
          labels: [],
          updatedAt: 'x',
        },
      ],
      pullRequests: [],
    });

    await usecase.execute({
      tasksText: '코드 리뷰 2건',
      slackUserId: 'U123',
    });

    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('[사용자 입력]');
    expect(promptArg).toContain('코드 리뷰 2건');
    expect(promptArg).toContain('[GitHub 에서 자동 수집한 assigned 항목]');
    expect(promptArg).toContain('Issue #12');
  });

  it('사용자 입력만 있고 GitHub 호출 실패하면 graceful 진행 (예외 X, prompt 에 사용자 텍스트만)', async () => {
    listAssignedTasksExecute.mockRejectedValue(
      new Error('GITHUB_TOKEN not set'),
    );

    const result = await usecase.execute({
      tasksText: '코드 리뷰 2건',
      slackUserId: 'U123',
    });

    expect(result).toEqual(validPlan);
    const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
    expect(promptArg).toContain('[사용자 입력]');
    expect(promptArg).not.toContain('[GitHub 에서');
  });

  it('AgentRunService inputSnapshot 에 GitHub fetch 메타가 기록된다', async () => {
    listAssignedTasksExecute.mockResolvedValue({
      issues: [],
      pullRequests: [],
    });

    await usecase.execute({ tasksText: 'task A', slackUserId: 'U123' });

    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.inputSnapshot).toMatchObject({
      tasksText: 'task A',
      slackUserId: 'U123',
      githubItemCount: 0,
      githubFetchAttempted: true,
      githubFetchSucceeded: true,
    });
  });

  it('GitHub 결과가 있으면 evidence 에 GITHUB_ASSIGNED_TASKS 가 추가된다', async () => {
    const githubTasks = {
      issues: [
        {
          number: 1,
          title: 't',
          repo: 'a/b',
          url: 'u',
          labels: [],
          updatedAt: 'x',
        },
      ],
      pullRequests: [],
    };
    listAssignedTasksExecute.mockResolvedValue(githubTasks);

    await usecase.execute({ tasksText: 'x', slackUserId: 'U123' });

    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.evidence).toEqual([
      {
        sourceType: 'SLACK_COMMAND_TODAY',
        sourceId: 'U123',
        payload: { tasksText: 'x' },
      },
      {
        sourceType: 'GITHUB_ASSIGNED_TASKS',
        sourceId: 'me',
        payload: {
          issues: githubTasks.issues,
          pullRequests: githubTasks.pullRequests,
        },
      },
    ]);
  });

  it('GitHub 호출 실패시 evidence 에 GITHUB_* 항목이 빠진다', async () => {
    listAssignedTasksExecute.mockRejectedValue(new Error('boom'));

    await usecase.execute({ tasksText: 'x', slackUserId: 'U123' });

    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.evidence).toHaveLength(1);
    expect(call.evidence[0].sourceType).toBe('SLACK_COMMAND_TODAY');
  });

  it('사용자 입력 비어있고 GitHub 도 비어있으면 EMPTY_TASKS_INPUT 예외', async () => {
    listAssignedTasksExecute.mockResolvedValue({
      issues: [],
      pullRequests: [],
    });

    await expect(
      usecase.execute({ tasksText: '   ', slackUserId: 'U123' }),
    ).rejects.toMatchObject({
      pmAgentErrorCode: PmAgentErrorCode.EMPTY_TASKS_INPUT,
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
  });

  it('사용자 입력 비어있고 GitHub 호출 실패해도 EMPTY_TASKS_INPUT 예외', async () => {
    listAssignedTasksExecute.mockRejectedValue(new Error('boom'));

    await expect(
      usecase.execute({ tasksText: '', slackUserId: 'U123' }),
    ).rejects.toMatchObject({
      pmAgentErrorCode: PmAgentErrorCode.EMPTY_TASKS_INPUT,
    });
  });

  it('사용자 입력 비어있어도 GitHub 결과만 있으면 정상 처리', async () => {
    listAssignedTasksExecute.mockResolvedValue({
      issues: [
        {
          number: 1,
          title: 't',
          repo: 'a/b',
          url: 'u',
          labels: [],
          updatedAt: 'x',
        },
      ],
      pullRequests: [],
    });

    const result = await usecase.execute({
      tasksText: '',
      slackUserId: 'U123',
    });

    expect(result).toEqual(validPlan);
  });

  it('모델 응답이 JSON 스키마에 안 맞으면 INVALID_MODEL_OUTPUT 예외', async () => {
    listAssignedTasksExecute.mockResolvedValue({
      issues: [],
      pullRequests: [],
    });
    modelRouter.route.mockResolvedValue({
      text: 'not a plan',
      modelUsed: 'codex-cli',
      provider: ModelProviderName.CHATGPT,
    });

    await expect(
      usecase.execute({ tasksText: 'x', slackUserId: 'U123' }),
    ).rejects.toBeInstanceOf(PmAgentException);
  });

  it('AgentRunService 에 PM / SLACK_COMMAND_TODAY 가 전달된다', async () => {
    listAssignedTasksExecute.mockResolvedValue({
      issues: [],
      pullRequests: [],
    });

    await usecase.execute({ tasksText: 'x', slackUserId: 'U123' });

    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.PM);
    expect(call.triggerType).toBe('SLACK_COMMAND_TODAY');
  });

  describe('전일 plan 참조 (옵션 C)', () => {
    const yesterdayPlan: DailyPlan = {
      topPriority: '어제의 최우선',
      morning: ['어제 오전 1'],
      afternoon: ['어제 오후 1'],
      blocker: null,
      estimatedHours: 5,
      reasoning: 'r',
    };

    it('직전 PM run 이 있으면 prompt 에 [직전 PM 실행 ...] 섹션 포함 + evidence 에 PRIOR_DAILY_PLAN', async () => {
      agentRunServiceFindLatest.mockResolvedValue({
        id: 99,
        output: yesterdayPlan,
        endedAt: new Date('2026-04-22T05:00:00Z'),
      });
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U123' });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).toContain('[직전 PM 실행');
      expect(promptArg).toContain('어제의 최우선');

      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: 'PRIOR_DAILY_PLAN',
            sourceId: '99',
          }),
        ]),
      );
      expect(call.inputSnapshot.previousPlanReferenced).toBe(true);
      expect(call.inputSnapshot.previousPlanAgentRunId).toBe(99);
    });

    it('직전 PM run 이 없으면 prompt 에 섹션 없음 + evidence 에 PRIOR_DAILY_PLAN 없음', async () => {
      agentRunServiceFindLatest.mockResolvedValue(null);
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U123' });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[직전 PM 실행');
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.previousPlanReferenced).toBe(false);
      expect(call.inputSnapshot.previousPlanAgentRunId).toBeNull();
    });

    it('findLatestSucceededRun 이 throw 하면 graceful (prompt/evidence 영향 X)', async () => {
      agentRunServiceFindLatest.mockRejectedValue(new Error('db down'));
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      const result = await usecase.execute({
        tasksText: 'x',
        slackUserId: 'U123',
      });

      expect(result).toEqual(validPlan);
      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[직전 PM 실행');
    });

    it('이전 output 이 DailyPlan 스키마와 안 맞으면 무시', async () => {
      agentRunServiceFindLatest.mockResolvedValue({
        id: 7,
        output: { not: 'a plan' },
        endedAt: new Date(),
      });
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U123' });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[직전 PM 실행');
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.previousPlanReferenced).toBe(false);
    });
  });
});
