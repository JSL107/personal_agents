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
import { PmAgentErrorCode } from '../domain/pm-agent-error-code.enum';
import { PmAgentException } from '../domain/pm-agent.exception';
import { DailyPlan, GenerateDailyPlanInput } from '../domain/pm-agent.type';
import { parseDailyPlan } from '../domain/prompt/daily-plan.parser';
import { formatGithubTasksAsPromptSection } from '../domain/prompt/github-task-formatter';
import { PM_SYSTEM_PROMPT } from '../domain/prompt/pm-system.prompt';
import {
  coerceToDailyPlan,
  formatPreviousDailyPlanSection,
} from '../domain/prompt/previous-plan-formatter';

interface PreviousPlanContext {
  plan: DailyPlan;
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

    // 외부 컨텍스트 두 가지 모두 graceful — 실패해도 사용자 입력만으로 계속 진행한다.
    const [githubTasks, previousPlan] = await Promise.all([
      this.fetchGithubTasksOrNull(),
      this.fetchPreviousPlanOrNull(),
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
    });
    const evidence = this.buildEvidence({
      userText,
      slackUserId,
      githubTasks,
      previousPlan,
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

  // 직전 PM 실행의 plan 을 조회해 모델에게 "전일 컨텍스트" 로 노출한다.
  // 조회 실패 / shape 불일치 / 직전 run 없음 모두 graceful (null 반환).
  private async fetchPreviousPlanOrNull(): Promise<PreviousPlanContext | null> {
    let snapshot: SucceededAgentRunSnapshot | null;
    try {
      snapshot = await this.agentRunService.findLatestSucceededRun({
        agentType: AgentType.PM,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `이전 PM plan 조회 실패 (전일 컨텍스트 없이 계속 진행): ${message}`,
      );
      return null;
    }
    if (!snapshot) {
      return null;
    }
    const plan = coerceToDailyPlan(snapshot.output);
    if (!plan) {
      this.logger.warn(
        `이전 AgentRun #${snapshot.id} 의 output 이 DailyPlan 스키마에 안 맞아 무시합니다.`,
      );
      return null;
    }
    return { plan, endedAt: snapshot.endedAt, agentRunId: snapshot.id };
  }

  private buildCombinedPrompt({
    userText,
    githubTasks,
    previousPlan,
  }: {
    userText: string;
    githubTasks: AssignedTasks | null;
    previousPlan: PreviousPlanContext | null;
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
  }: {
    userText: string;
    slackUserId: string;
    githubTasks: AssignedTasks | null;
    previousPlan: PreviousPlanContext | null;
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
    return evidence;
  }
}
