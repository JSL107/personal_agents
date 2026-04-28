import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { DailyPlanService } from '../../../daily-plan/application/daily-plan.service';
import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import {
  AgentType,
  CompletionResponse,
  ModelProviderName,
} from '../../../model-router/domain/model-router.type';
import { AppendDailyPlanUsecase } from '../../../notion/application/append-daily-plan.usecase';
import { ListActiveTasksUsecase } from '../../../notion/application/list-active-tasks.usecase';
import { ListMyMentionsUsecase } from '../../../slack-collector/application/list-my-mentions.usecase';
import { PmAgentException } from '../domain/pm-agent.exception';
import { DailyPlan, TaskItem } from '../domain/pm-agent.type';
import { PmAgentErrorCode } from '../domain/pm-agent-error-code.enum';

const task = (title: string, overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: overrides.id ?? `user:${title}`,
  title,
  source: overrides.source ?? 'USER_INPUT',
  subtasks: overrides.subtasks ?? [],
  isCriticalPath: overrides.isCriticalPath ?? false,
});
import { DailyPlanContextCollector } from './daily-plan-context.collector';
import { DailyPlanEvidenceBuilder } from './daily-plan-evidence.builder';
import { DailyPlanPromptBuilder } from './daily-plan-prompt.builder';
import { GenerateDailyPlanUsecase } from './generate-daily-plan.usecase';

describe('GenerateDailyPlanUsecase', () => {
  const validPlan: DailyPlan = {
    topPriority: task('PM Agent /today 구현', { isCriticalPath: true }),
    varianceAnalysis: {
      rolledOverTasks: [],
      analysisReasoning: '(이월 없음)',
    },
    morning: [task('agent-run 모듈'), task('PM 유스케이스')],
    afternoon: [task('Slack 핸들러'), task('E2E 검증')],
    blocker: null,
    estimatedHours: 6,
    reasoning: '집중이 필요한 구현을 오전에 배치',
  };

  let modelRouter: { route: jest.Mock };
  let agentRunServiceExecute: jest.Mock;
  let agentRunServiceFindLatest: jest.Mock;
  let agentRunServiceFindRecent: jest.Mock;
  let dailyPlanRecord: jest.Mock;
  let appendDailyPlanExecute: jest.Mock;
  let listAssignedTasksExecute: jest.Mock;
  let listMyMentionsExecute: jest.Mock;
  let listActiveTasksExecute: jest.Mock;
  let usecase: GenerateDailyPlanUsecase;

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
    agentRunServiceFindLatest = jest.fn().mockResolvedValue(null);
    agentRunServiceFindRecent = jest.fn().mockResolvedValue([]);
    dailyPlanRecord = jest.fn().mockResolvedValue({
      id: 1,
      planDate: new Date('2026-04-24'),
      plan: validPlan,
      agentRunId: 42,
      evidenceIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    appendDailyPlanExecute = jest.fn().mockResolvedValue({
      pageId: 'p_fake',
      url: 'https://notion.so/p_fake',
    });
    listAssignedTasksExecute = jest.fn();
    listMyMentionsExecute = jest.fn().mockResolvedValue([]);
    listActiveTasksExecute = jest.fn().mockResolvedValue([]);

    const agentRunService = {
      execute: agentRunServiceExecute,
      findLatestSucceededRun: agentRunServiceFindLatest,
      findRecentSucceededRuns: agentRunServiceFindRecent,
      findSimilarPlans: jest.fn().mockResolvedValue([]),
    } as unknown as AgentRunService;

    // builder 3종은 실제 인스턴스 — 내부 로직 (fetch/prompt/evidence) 을 그대로 통합 검증.
    const contextCollector = new DailyPlanContextCollector(
      agentRunService,
      {
        execute: listAssignedTasksExecute,
      } as unknown as ListAssignedTasksUsecase,
      { execute: listMyMentionsExecute } as unknown as ListMyMentionsUsecase,
      { execute: listActiveTasksExecute } as unknown as ListActiveTasksUsecase,
      {
        peekPending: jest.fn().mockResolvedValue([]),
        markConsumed: jest.fn().mockResolvedValue(undefined),
      } as unknown as import('../../../slack-inbox/application/slack-inbox.service').SlackInboxService,
    );
    const promptBuilder = new DailyPlanPromptBuilder();
    const evidenceBuilder = new DailyPlanEvidenceBuilder();

    usecase = new GenerateDailyPlanUsecase(
      modelRouter as unknown as ModelRouterUsecase,
      agentRunService,
      {
        recordDailyPlan: dailyPlanRecord,
      } as unknown as DailyPlanService,
      {
        execute: appendDailyPlanExecute,
      } as unknown as AppendDailyPlanUsecase,
      contextCollector,
      promptBuilder,
      evidenceBuilder,
      {
        peekPending: jest.fn().mockResolvedValue([]),
        markConsumed: jest.fn().mockResolvedValue(undefined),
      } as unknown as import('../../../slack-inbox/application/slack-inbox.service').SlackInboxService,
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

    expect(result.result.plan).toEqual(validPlan);
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

    expect(result.result.plan).toEqual(validPlan);
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

  describe('daily_plan 기록', () => {
    it('plan 생성 성공 후 dailyPlanService.recordDailyPlan 이 agentRunId 와 함께 호출된다', async () => {
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U' });

      expect(dailyPlanRecord).toHaveBeenCalledTimes(1);
      const [call] = dailyPlanRecord.mock.calls;
      expect(call[0]).toMatchObject({
        plan: validPlan,
        agentRunId: 42,
        evidenceIds: [],
      });
      expect(call[0].planDate).toBeInstanceOf(Date);
    });

    it('recordDailyPlan 실패해도 plan 응답은 graceful 반환 (throw X)', async () => {
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });
      dailyPlanRecord.mockRejectedValue(new Error('db down'));

      const result = await usecase.execute({
        tasksText: 'x',
        slackUserId: 'U',
      });

      expect(result.result.plan).toEqual(validPlan);
    });

    it('Notion AppendDailyPlanUsecase 도 plan 생성 후 호출된다 (graceful)', async () => {
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U' });

      expect(appendDailyPlanExecute).toHaveBeenCalledTimes(1);
      const [call] = appendDailyPlanExecute.mock.calls;
      expect(call[0]).toMatchObject({ plan: validPlan });
      expect(call[0].planDate).toBeInstanceOf(Date);
    });

    it('Notion append 실패해도 plan 응답은 graceful 반환', async () => {
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });
      appendDailyPlanExecute.mockRejectedValue(new Error('notion 403'));

      const result = await usecase.execute({
        tasksText: 'x',
        slackUserId: 'U',
      });

      expect(result.result.plan).toEqual(validPlan);
    });
  });

  it('AgentRunService 에 PM / SLACK_COMMAND_TODAY 가 전달된다 (default)', async () => {
    listAssignedTasksExecute.mockResolvedValue({
      issues: [],
      pullRequests: [],
    });

    await usecase.execute({ tasksText: 'x', slackUserId: 'U123' });

    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.agentType).toBe(AgentType.PM);
    expect(call.triggerType).toBe('SLACK_COMMAND_TODAY');
  });

  it('OPS-8: 호출자가 triggerType 명시하면 그 값으로 AgentRun 기록 (Morning Briefing CRON)', async () => {
    // 자동 컨텍스트 1건 있어 assertNonEmptyInput 통과 (CRON 발송 시 자동 수집 케이스 시뮬).
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
      tasksText: '',
      slackUserId: 'U123',
      triggerType: 'MORNING_BRIEFING_CRON' as never,
    });

    const call = agentRunServiceExecute.mock.calls[0][0];
    expect(call.triggerType).toBe('MORNING_BRIEFING_CRON');
  });

  describe('전일 plan 참조 (옵션 C)', () => {
    const yesterdayPlan: DailyPlan = {
      topPriority: task('어제의 최우선', { isCriticalPath: true }),
      varianceAnalysis: {
        rolledOverTasks: [],
        analysisReasoning: '(이월 없음)',
      },
      morning: [task('어제 오전 1')],
      afternoon: [task('어제 오후 1')],
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

      expect(result.result.plan).toEqual(validPlan);
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

  describe('전일 worklog 참조 (옵션 a)', () => {
    const yesterdayReview = {
      summary: '어제 한 일 요약',
      impact: { quantitative: ['+5건'], qualitative: '리뷰 자동화' },
      improvementBeforeAfter: null,
      nextActions: ['오늘 마무리할 다음 액션'],
      oneLineAchievement: '/review-pr E2E 진입',
    };

    it('agentType 에 따라 PM/WORK_REVIEWER 다른 결과 반환 시 두 섹션 모두 prompt 에 포함', async () => {
      const yesterdayPlan: DailyPlan = {
        topPriority: task('어제의 최우선', { isCriticalPath: true }),
        varianceAnalysis: {
          rolledOverTasks: [],
          analysisReasoning: '(이월 없음)',
        },
        morning: [task('오전 1')],
        afternoon: [task('오후 1')],
        blocker: null,
        estimatedHours: 5,
        reasoning: 'r',
      };
      agentRunServiceFindLatest.mockImplementation(({ agentType }) => {
        if (agentType === AgentType.PM) {
          return Promise.resolve({
            id: 99,
            output: yesterdayPlan,
            endedAt: new Date('2026-04-22T05:00:00Z'),
          });
        }
        if (agentType === AgentType.WORK_REVIEWER) {
          return Promise.resolve({
            id: 100,
            output: yesterdayReview,
            endedAt: new Date('2026-04-22T08:00:00Z'),
          });
        }
        return Promise.resolve(null);
      });
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U' });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).toContain('[직전 PM 실행');
      expect(promptArg).toContain('[직전 Work Reviewer 실행');
      expect(promptArg).toContain('어제의 최우선');
      expect(promptArg).toContain('어제 한 일 요약');

      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: 'PRIOR_DAILY_PLAN',
            sourceId: '99',
          }),
          expect.objectContaining({
            sourceType: 'PRIOR_DAILY_REVIEW',
            sourceId: '100',
          }),
        ]),
      );
      expect(call.inputSnapshot.previousWorklogReferenced).toBe(true);
      expect(call.inputSnapshot.previousWorklogAgentRunId).toBe(100);
    });

    it('WORK_REVIEWER run 만 있고 PM 은 없을 때도 worklog 섹션은 나옴', async () => {
      agentRunServiceFindLatest.mockImplementation(({ agentType }) => {
        if (agentType === AgentType.WORK_REVIEWER) {
          return Promise.resolve({
            id: 50,
            output: yesterdayReview,
            endedAt: new Date('2026-04-22T08:00:00Z'),
          });
        }
        return Promise.resolve(null);
      });
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U' });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[직전 PM 실행');
      expect(promptArg).toContain('[직전 Work Reviewer 실행');
    });

    it('WORK_REVIEWER output 이 DailyReview 스키마에 안 맞으면 무시', async () => {
      agentRunServiceFindLatest.mockImplementation(({ agentType }) => {
        if (agentType === AgentType.WORK_REVIEWER) {
          return Promise.resolve({
            id: 51,
            output: { not: 'a review' },
            endedAt: new Date(),
          });
        }
        return Promise.resolve(null);
      });
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U' });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[직전 Work Reviewer 실행');
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.previousWorklogReferenced).toBe(false);
    });

    it('WORK_REVIEWER 조회 실패해도 graceful (PM plan 만 보여도 OK)', async () => {
      agentRunServiceFindLatest.mockImplementation(({ agentType }) => {
        if (agentType === AgentType.WORK_REVIEWER) {
          return Promise.reject(new Error('db down'));
        }
        return Promise.resolve(null);
      });
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      const result = await usecase.execute({
        tasksText: 'x',
        slackUserId: 'U',
      });

      expect(result.result.plan).toEqual(validPlan);
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.previousWorklogReferenced).toBe(false);
    });
  });

  describe('Slack mention 수집 (입력 b)', () => {
    const mention = {
      channelId: 'C1',
      channelName: 'general',
      channelType: 'public_channel' as const,
      authorUserId: 'U999',
      ts: '1.0',
      text: '<@U123> 도와주세요',
      permalink: undefined,
    };

    it('mention 이 있으면 prompt 에 [Slack 에서 본인 멘션 ...] 섹션 + evidence SLACK_MENTIONS 추가', async () => {
      listMyMentionsExecute.mockResolvedValue([mention]);
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U123' });

      expect(listMyMentionsExecute).toHaveBeenCalledWith({
        slackUserId: 'U123',
        sinceHours: 24,
      });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).toContain('Slack 에서 본인 멘션된 최근 메시지');
      expect(promptArg).toContain('도와주세요');

      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.slackMentionCount).toBe(1);
      expect(call.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: 'SLACK_MENTIONS',
            sourceId: 'U123',
          }),
        ]),
      );
    });

    it('mention 이 비어있으면 prompt 섹션 / evidence 모두 생략', async () => {
      listMyMentionsExecute.mockResolvedValue([]);
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U' });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('Slack 에서 본인 멘션');
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.slackMentionCount).toBe(0);
      expect(call.evidence).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceType: 'SLACK_MENTIONS' }),
        ]),
      );
    });

    it('Slack 호출 실패해도 graceful (mention 없는 채로 계속)', async () => {
      listMyMentionsExecute.mockRejectedValue(new Error('SCOPE_MISSING'));
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      const result = await usecase.execute({
        tasksText: 'x',
        slackUserId: 'U',
      });

      expect(result.result.plan).toEqual(validPlan);
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.slackMentionCount).toBe(0);
    });
  });

  describe('Notion task 수집 (입력 c)', () => {
    const notionTask = {
      databaseId: 'DB1',
      pageId: 'p1',
      url: 'https://notion.so/p1',
      title: '버그 수정',
      properties: { 상태: '진행중', 우선순위: '높음' },
    };

    it('notionTasks 가 있으면 prompt 에 [Notion task DB ...] + evidence NOTION_TASKS', async () => {
      listActiveTasksExecute.mockResolvedValue([notionTask]);
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U' });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).toContain('[Notion task DB');
      expect(promptArg).toContain('"버그 수정"');
      expect(promptArg).toContain('상태: 진행중');

      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.notionTaskCount).toBe(1);
      expect(call.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: 'NOTION_TASKS',
            sourceId: 'me',
          }),
        ]),
      );
    });

    it('notionTasks 가 비어있으면 prompt 섹션 / evidence 모두 생략', async () => {
      listActiveTasksExecute.mockResolvedValue([]);
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U' });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('[Notion task DB');
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.notionTaskCount).toBe(0);
      expect(call.evidence).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceType: 'NOTION_TASKS' }),
        ]),
      );
    });

    it('Notion 호출 실패해도 graceful (task 없는 채로 계속)', async () => {
      listActiveTasksExecute.mockRejectedValue(
        new Error('NOTION_TOKEN_NOT_CONFIGURED'),
      );
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      const result = await usecase.execute({
        tasksText: 'x',
        slackUserId: 'U',
      });

      expect(result.result.plan).toEqual(validPlan);
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.notionTaskCount).toBe(0);
    });

    it('userText / GitHub 비어 있어도 Notion task 만 있으면 정상 처리', async () => {
      listActiveTasksExecute.mockResolvedValue([notionTask]);
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      const result = await usecase.execute({
        tasksText: '',
        slackUserId: 'U',
      });

      expect(result.result.plan).toEqual(validPlan);
    });

    it('userText / GitHub / Notion 모두 비어 있으면 EMPTY_TASKS_INPUT 예외', async () => {
      listActiveTasksExecute.mockResolvedValue([]);
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await expect(
        usecase.execute({ tasksText: '   ', slackUserId: 'U' }),
      ).rejects.toMatchObject({
        pmAgentErrorCode: PmAgentErrorCode.EMPTY_TASKS_INPUT,
      });
    });
  });

  describe('지난 7일 plan 패턴 참조 (V3-1)', () => {
    const buildPastPlan = (label: string): DailyPlan => ({
      topPriority: task(label, { isCriticalPath: true }),
      varianceAnalysis: {
        rolledOverTasks: [],
        analysisReasoning: '(이월 없음)',
      },
      morning: [],
      afternoon: [],
      blocker: null,
      estimatedHours: 6,
      reasoning: 'r',
    });

    it('최근 7일 PM run 이 있으면 prompt 에 "지난 7일 plan 패턴" 섹션 포함 + inputSnapshot 에 sample count 기록', async () => {
      agentRunServiceFindRecent.mockResolvedValue([
        {
          id: 201,
          output: buildPastPlan('어제의 최우선'),
          endedAt: new Date('2026-04-26T05:00:00Z'),
        },
        {
          id: 200,
          output: buildPastPlan('그제의 최우선'),
          endedAt: new Date('2026-04-25T05:00:00Z'),
        },
      ]);
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U123' });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).toContain('## 지난 7일 plan 패턴 (최근순)');
      expect(promptArg).toContain('어제의 최우선');
      expect(promptArg).toContain('그제의 최우선');

      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.recentPlanLookbackDays).toBe(7);
      expect(call.inputSnapshot.recentPlanSampleCount).toBe(2);
    });

    it('최근 run 이 없으면 prompt 에 섹션 없음 + sampleCount=0', async () => {
      agentRunServiceFindRecent.mockResolvedValue([]);
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U123' });

      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('## 지난 7일 plan 패턴');
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.recentPlanSampleCount).toBe(0);
    });

    it('findRecentSucceededRuns 가 throw 하면 graceful (prompt/evidence 영향 X)', async () => {
      agentRunServiceFindRecent.mockRejectedValue(new Error('db down'));
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      const result = await usecase.execute({
        tasksText: 'x',
        slackUserId: 'U123',
      });

      expect(result.result.plan).toEqual(validPlan);
      const promptArg = modelRouter.route.mock.calls[0][0].request.prompt;
      expect(promptArg).not.toContain('## 지난 7일 plan 패턴');
      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.recentPlanSampleCount).toBe(0);
    });

    it('스키마와 안 맞는 output 은 sample count 에서 제외', async () => {
      agentRunServiceFindRecent.mockResolvedValue([
        {
          id: 301,
          output: buildPastPlan('정상'),
          endedAt: new Date('2026-04-26T05:00:00Z'),
        },
        {
          id: 302,
          output: { not: 'a daily plan' },
          endedAt: new Date('2026-04-25T05:00:00Z'),
        },
      ]);
      listAssignedTasksExecute.mockResolvedValue({
        issues: [],
        pullRequests: [],
      });

      await usecase.execute({ tasksText: 'x', slackUserId: 'U123' });

      const call = agentRunServiceExecute.mock.calls[0][0];
      expect(call.inputSnapshot.recentPlanSampleCount).toBe(1);
    });
  });
});
