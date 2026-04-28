import { Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import {
  SimilarPlanRow,
  SucceededAgentRunSnapshot,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
import { AssignedTasks } from '../../../github/domain/github.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { ListActiveTasksUsecase } from '../../../notion/application/list-active-tasks.usecase';
import { NotionTask } from '../../../notion/domain/notion.type';
import { ListMyMentionsUsecase } from '../../../slack-collector/application/list-my-mentions.usecase';
import { SlackMention } from '../../../slack-collector/domain/slack-collector.type';
import { SlackInboxService } from '../../../slack-inbox/application/slack-inbox.service';
import { DailyReview } from '../../work-reviewer/domain/work-reviewer.type';
import { DailyPlan } from '../domain/pm-agent.type';
import { coerceToDailyPlan } from '../domain/prompt/previous-plan-formatter';
import { coerceToDailyReview } from '../domain/prompt/previous-worklog-formatter';
import {
  createRecentPlanSummary,
  RecentPlanSummary,
} from '../domain/prompt/recent-plan-summary-formatter';

export const SLACK_MENTION_SINCE_HOURS = 24;
export const RECENT_PLAN_LOOKBACK_DAYS = 7;
export const RECENT_PLAN_LIMIT = 7;

export interface PreviousPlanContext {
  plan: DailyPlan;
  endedAt: Date;
  agentRunId: number;
}

export interface PreviousWorklogContext {
  review: DailyReview;
  endedAt: Date;
  agentRunId: number;
}

export interface DailyPlanContext {
  userText: string;
  slackUserId: string;
  githubTasks: AssignedTasks | null;
  previousPlan: PreviousPlanContext | null;
  previousWorklog: PreviousWorklogContext | null;
  slackMentions: SlackMention[];
  notionTasks: NotionTask[];
  recentPlanSummaries: RecentPlanSummary[];
  inboxItems: string[];
  inboxItemIds: number[];
  similarPlans: SimilarPlanRow[];
}

// PM `/today` 가 필요로 하는 외부 컨텍스트 6종을 병렬 수집. 모두 graceful — 실패해도 null/empty 로 빠진다.
// 각 fetcher 는 한 가지 source 만 책임져 신규 source 추가 시 여기 한 파일만 수정하면 된다 (OCP 강화).
@Injectable()
export class DailyPlanContextCollector {
  private readonly logger = new Logger(DailyPlanContextCollector.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly listAssignedTasksUsecase: ListAssignedTasksUsecase,
    private readonly listMyMentionsUsecase: ListMyMentionsUsecase,
    private readonly listActiveTasksUsecase: ListActiveTasksUsecase,
    private readonly slackInboxService: SlackInboxService,
  ) {}

  async collect({
    userText,
    slackUserId,
  }: {
    userText: string;
    slackUserId: string;
  }): Promise<DailyPlanContext> {
    const [
      githubTasks,
      previousPlan,
      previousWorklog,
      slackMentions,
      notionTasks,
      recentPlanSummaries,
      inboxResult,
      similarPlans,
    ] = await Promise.all([
      this.fetchGithubTasksOrNull(),
      this.fetchPreviousPlanOrNull(),
      this.fetchPreviousWorklogOrNull(),
      this.fetchSlackMentionsOrEmpty({ slackUserId }),
      this.fetchNotionTasksOrEmpty(),
      this.fetchRecentPlanSummariesOrEmpty({ slackUserId }),
      this.fetchInboxItemsOrEmpty({ slackUserId }),
      this.fetchSimilarPlansOrEmpty({ userText }),
    ]);

    return {
      userText,
      slackUserId,
      githubTasks,
      previousPlan,
      previousWorklog,
      slackMentions,
      notionTasks,
      recentPlanSummaries,
      inboxItems: inboxResult.texts,
      inboxItemIds: inboxResult.ids,
      similarPlans,
    };
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

  private async fetchSlackMentionsOrEmpty({
    slackUserId,
  }: {
    slackUserId: string;
  }): Promise<SlackMention[]> {
    try {
      return await this.listMyMentionsUsecase.execute({
        slackUserId,
        sinceHours: SLACK_MENTION_SINCE_HOURS,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Slack 멘션 수집 실패 (해당 컨텍스트 없이 계속 진행): ${message}`,
      );
      return [];
    }
  }

  private async fetchNotionTasksOrEmpty(): Promise<NotionTask[]> {
    try {
      return await this.listActiveTasksUsecase.execute();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Notion task 수집 실패 (해당 컨텍스트 없이 계속 진행): ${message}`,
      );
      return [];
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

  private async fetchInboxItemsOrEmpty({
    slackUserId,
  }: {
    slackUserId: string;
  }): Promise<{ texts: string[]; ids: number[] }> {
    try {
      const items = await this.slackInboxService.peekPending(slackUserId);
      return {
        texts: items.map((i) => i.text),
        ids: items.map((i) => i.id),
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Slack Inbox 수집 실패 (해당 컨텍스트 없이 계속 진행): ${error instanceof Error ? error.message : String(error)}`,
      );
      return { texts: [], ids: [] };
    }
  }

  private async fetchSimilarPlansOrEmpty({
    userText,
  }: {
    userText: string;
  }): Promise<SimilarPlanRow[]> {
    if (userText.trim().length < 5) {
      return [];
    }
    try {
      return await this.agentRunService.findSimilarPlans({
        query: userText,
        agentType: AgentType.PM,
        limit: 3,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `유사 plan FTS 실패 (해당 컨텍스트 없이 계속 진행): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async fetchRecentPlanSummariesOrEmpty({
    slackUserId,
  }: {
    slackUserId: string;
  }): Promise<RecentPlanSummary[]> {
    try {
      const runs = await this.agentRunService.findRecentSucceededRuns({
        agentType: AgentType.PM,
        slackUserId,
        sinceDays: RECENT_PLAN_LOOKBACK_DAYS,
        limit: RECENT_PLAN_LIMIT,
      });

      const summaries: RecentPlanSummary[] = [];
      for (const run of runs) {
        const plan = coerceToDailyPlan(run.output);
        if (plan) {
          summaries.push(createRecentPlanSummary(plan, run.endedAt, run.id));
        }
      }
      return summaries;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `최근 ${RECENT_PLAN_LOOKBACK_DAYS}일 plan 패턴 수집 실패 (해당 컨텍스트 없이 계속 진행): ${message}`,
      );
      return [];
    }
  }
}
