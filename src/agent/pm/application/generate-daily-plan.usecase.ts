import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import {
  EvidenceInput,
  TriggerType,
} from '../../../agent-run/domain/agent-run.type';
import { SucceededAgentRunSnapshot } from '../../../agent-run/domain/port/agent-run.repository.port';
import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
import { AssignedTasks } from '../../../github/domain/github.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DailyReview } from '../../work-reviewer/domain/work-reviewer.type';
import { PmAgentException } from '../domain/pm-agent.exception';
import { DailyPlan, GenerateDailyPlanInput } from '../domain/pm-agent.type';
import { PmAgentErrorCode } from '../domain/pm-agent-error-code.enum';
import { parseDailyPlan } from '../domain/prompt/daily-plan.parser';
import { formatGithubTasksAsPromptSection } from '../domain/prompt/github-task-formatter';
import { PM_SYSTEM_PROMPT } from '../domain/prompt/pm-system.prompt';
import {
  coerceToDailyPlan,
  formatPreviousDailyPlanSection,
} from '../domain/prompt/previous-plan-formatter';
import {
  coerceToDailyReview,
  formatPreviousDailyReviewSection,
} from '../domain/prompt/previous-worklog-formatter';

interface PreviousPlanContext {
  plan: DailyPlan;
  endedAt: Date;
  agentRunId: number;
}

interface PreviousWorklogContext {
  review: DailyReview;
  endedAt: Date;
  agentRunId: number;
}

@Injectable()
export class GenerateDailyPlanUsecase {
  private readonly logger = new Logger(GenerateDailyPlanUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly listAssignedTasksUsecase: ListAssignedTasksUsecase,
  ) {}

  async execute({
    tasksText,
    slackUserId,
  }: GenerateDailyPlanInput): Promise<DailyPlan> {
    const userText = tasksText.trim();

    // 외부 컨텍스트 셋 모두 graceful — 실패해도 사용자 입력만으로 계속 진행한다.
    const [githubTasks, previousPlan, previousWorklog] = await Promise.all([
      this.fetchGithubTasksOrNull(),
      this.fetchPreviousPlanOrNull(),
      this.fetchPreviousWorklogOrNull(),
    ]);
    const githubItemCount = githubTasks
      ? githubTasks.issues.length + githubTasks.pullRequests.length
      : 0;

    if (userText.length === 0 && githubItemCount === 0) {
      throw new PmAgentException({
        code: PmAgentErrorCode.EMPTY_TASKS_INPUT,
        message:
          '오늘 할 일이 비어있고 GitHub 자동 수집도 비어있습니다. `/today <할 일>` 형식으로 입력하거나 GITHUB_TOKEN 을 설정해주세요.',
        status: HttpStatus.BAD_REQUEST,
      });
    }

    const combinedPrompt = this.buildCombinedPrompt({
      userText,
      githubTasks,
      previousPlan,
      previousWorklog,
    });
    const evidence = this.buildEvidence({
      userText,
      slackUserId,
      githubTasks,
      previousPlan,
      previousWorklog,
    });

    return this.agentRunService.execute({
      agentType: AgentType.PM,
      triggerType: TriggerType.SLACK_COMMAND_TODAY,
      inputSnapshot: {
        tasksText: userText,
        slackUserId,
        githubItemCount,
        githubFetchAttempted: true,
        githubFetchSucceeded: githubTasks !== null,
        previousPlanReferenced: previousPlan !== null,
        previousPlanAgentRunId: previousPlan ? previousPlan.agentRunId : null,
        previousWorklogReferenced: previousWorklog !== null,
        previousWorklogAgentRunId: previousWorklog
          ? previousWorklog.agentRunId
          : null,
      },
      evidence,
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.PM,
          request: {
            prompt: combinedPrompt,
            systemPrompt: PM_SYSTEM_PROMPT,
          },
        });
        const plan = parseDailyPlan(completion.text);
        return {
          result: plan,
          modelUsed: completion.modelUsed,
          output: plan as unknown as Record<string, unknown>,
        };
      },
    });
  }

  private async fetchGithubTasksOrNull(): Promise<AssignedTasks | null> {
    try {
      return await this.listAssignedTasksUsecase.execute();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `GitHub assigned tasks 수집 실패 (사용자 입력만으로 계속 진행): ${message}`,
      );
      return null;
    }
  }

  private async fetchPreviousPlanOrNull(): Promise<PreviousPlanContext | null> {
    const snapshot = await this.findLatestRunOrNull(AgentType.PM);
    if (!snapshot) {
      return null;
    }
    const plan = coerceToDailyPlan(snapshot.output);
    if (!plan) {
      this.logger.warn(
        `이전 PM AgentRun #${snapshot.id} 의 output 이 DailyPlan 스키마에 안 맞아 무시합니다.`,
      );
      return null;
    }
    return { plan, endedAt: snapshot.endedAt, agentRunId: snapshot.id };
  }

  private async fetchPreviousWorklogOrNull(): Promise<PreviousWorklogContext | null> {
    const snapshot = await this.findLatestRunOrNull(AgentType.WORK_REVIEWER);
    if (!snapshot) {
      return null;
    }
    const review = coerceToDailyReview(snapshot.output);
    if (!review) {
      this.logger.warn(
        `이전 WORK_REVIEWER AgentRun #${snapshot.id} 의 output 이 DailyReview 스키마에 안 맞아 무시합니다.`,
      );
      return null;
    }
    return { review, endedAt: snapshot.endedAt, agentRunId: snapshot.id };
  }

  // 두 fetcher 가 동일한 try/catch + null 패턴을 공유하므로 여기서 한번만 처리한다.
  private async findLatestRunOrNull(
    agentType: AgentType,
  ): Promise<SucceededAgentRunSnapshot | null> {
    try {
      return await this.agentRunService.findLatestSucceededRun({ agentType });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `${agentType} 직전 run 조회 실패 (해당 컨텍스트 없이 계속 진행): ${message}`,
      );
      return null;
    }
  }

  private buildCombinedPrompt({
    userText,
    githubTasks,
    previousPlan,
    previousWorklog,
  }: {
    userText: string;
    githubTasks: AssignedTasks | null;
    previousPlan: PreviousPlanContext | null;
    previousWorklog: PreviousWorklogContext | null;
  }): string {
    const sections: string[] = [];
    if (previousPlan) {
      sections.push(
        formatPreviousDailyPlanSection({
          plan: previousPlan.plan,
          endedAt: previousPlan.endedAt,
        }),
      );
    }
    if (previousWorklog) {
      sections.push(
        formatPreviousDailyReviewSection({
          review: previousWorklog.review,
          endedAt: previousWorklog.endedAt,
        }),
      );
    }
    if (userText.length > 0) {
      sections.push(`[사용자 입력]\n${userText}`);
    }
    if (githubTasks) {
      sections.push(formatGithubTasksAsPromptSection(githubTasks));
    }
    return sections.join('\n\n');
  }

  private buildEvidence({
    userText,
    slackUserId,
    githubTasks,
    previousPlan,
    previousWorklog,
  }: {
    userText: string;
    slackUserId: string;
    githubTasks: AssignedTasks | null;
    previousPlan: PreviousPlanContext | null;
    previousWorklog: PreviousWorklogContext | null;
  }): EvidenceInput[] {
    const evidence: EvidenceInput[] = [
      {
        sourceType: 'SLACK_COMMAND_TODAY',
        sourceId: slackUserId,
        payload: { tasksText: userText },
      },
    ];
    if (githubTasks) {
      evidence.push({
        sourceType: 'GITHUB_ASSIGNED_TASKS',
        sourceId: 'me',
        payload: {
          issues: githubTasks.issues,
          pullRequests: githubTasks.pullRequests,
        },
      });
    }
    if (previousPlan) {
      evidence.push({
        sourceType: 'PRIOR_DAILY_PLAN',
        sourceId: String(previousPlan.agentRunId),
        payload: {
          plan: previousPlan.plan as unknown as Record<string, unknown>,
          endedAt: previousPlan.endedAt.toISOString(),
        },
      });
    }
    if (previousWorklog) {
      evidence.push({
        sourceType: 'PRIOR_DAILY_REVIEW',
        sourceId: String(previousWorklog.agentRunId),
        payload: {
          review: previousWorklog.review as unknown as Record<string, unknown>,
          endedAt: previousWorklog.endedAt.toISOString(),
        },
      });
    }
    return evidence;
  }
}
