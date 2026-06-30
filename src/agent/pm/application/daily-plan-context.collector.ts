import { Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import {
  SimilarPlanRow,
  SucceededAgentRunSnapshot,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import { ClassifyPullRequestEngagementUsecase } from '../../../github/application/classify-pr-engagement.usecase';
import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
import { AssignedTasks } from '../../../github/domain/github.type';
import { WaitingItem } from '../../../github/domain/pr-engagement.type';
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
  // cron + BRIEFING_WAITING_SECTION_ENABLED=true 일 때만 채워짐. 그 외 빈 배열.
  waitingItems: WaitingItem[];
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
    private readonly classifyEngagement: ClassifyPullRequestEngagementUsecase,
  ) {}

  async collect({
    userText,
    slackUserId,
    excludeApprovedPullRequests = false,
    classifyWaitingPullRequests = false,
  }: {
    userText: string;
    slackUserId: string;
    // Morning Briefing CRON 등 자동 발화 시 true — APPROVED 받은 PR 은 plan 컨텍스트에서 제외.
    // 수동 /today 에서는 false — APPROVED PR 도 보여 LLM 이 후순위 라벨을 보고 판단.
    excludeApprovedPullRequests?: boolean;
    // BRIEFING_WAITING_SECTION_ENABLED=true + isCron 일 때 true — PR 을 ACTIVE/WAITING 으로 분류.
    // true 이면 excludeApprovedPullRequests 분기는 실행되지 않는다 (우선 분기).
    classifyWaitingPullRequests?: boolean;
  }): Promise<DailyPlanContext> {
    const [
      githubTasksRaw,
      previousPlan,
      previousWorklog,
      slackMentionsRaw,
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

    let githubTasks = githubTasksRaw;
    let waitingItems: WaitingItem[] = [];

    if (classifyWaitingPullRequests && githubTasksRaw) {
      try {
        const split = await this.classifyEngagement.execute(githubTasksRaw.pullRequests);
        githubTasks = { issues: githubTasksRaw.issues, pullRequests: split.activePullRequests };
        waitingItems = split.waitingItems;
      } catch (error: unknown) {
        this.logger.warn(
          `PR engagement 분류 실패 — waitingItems=[] + 원본 githubTasks 유지: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else if (excludeApprovedPullRequests && githubTasksRaw) {
      githubTasks = {
        issues: githubTasksRaw.issues,
        pullRequests: githubTasksRaw.pullRequests.filter((pr) => !pr.isApproved),
      };
    }

    // V3 audit B3 D3 — 같은 Slack 메시지가 (a) 자동 멘션 수집 + (b) 사용자가 emoji reaction 으로
    // 등록한 Inbox 양쪽에서 가져오는 케이스가 가능 (channelId+ts 일치). prompt 토큰 낭비 + LLM 의
    // 우선순위 중복 산정을 막기 위해 inbox 쪽을 우선 보존하고 mentions 에서 동일 항목을 제거한다.
    // Inbox 가 명시 신호 (사용자가 직접 reaction) 라 더 풍부한 의도성을 보유.
    const inboxKeys = new Set(
      inboxResult.entries.map(
        ({ channelId, messageTs }) => `${channelId}:${messageTs}`,
      ),
    );
    const slackMentions = slackMentionsRaw.filter(
      (mention) => !inboxKeys.has(`${mention.channelId}:${mention.ts}`),
    );
    if (slackMentions.length < slackMentionsRaw.length) {
      this.logger.log(
        `Slack mention dedup — ${slackMentionsRaw.length - slackMentions.length}건 Inbox 와 중복으로 제외`,
      );
    }

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
      waitingItems,
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

  // entries 는 dedup 키 (channelId + messageTs) 산출용 — 외부에 노출되지는 않고 collect() 안에서만 사용.
  private async fetchInboxItemsOrEmpty({
    slackUserId,
  }: {
    slackUserId: string;
  }): Promise<{
    texts: string[];
    ids: number[];
    entries: { channelId: string; messageTs: string }[];
  }> {
    try {
      const items = await this.slackInboxService.peekPending(slackUserId);
      return {
        texts: items.map((i) => i.text),
        ids: items.map((i) => i.id),
        entries: items.map((i) => ({
          channelId: i.channelId,
          messageTs: i.messageTs,
        })),
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Slack Inbox 수집 실패 (해당 컨텍스트 없이 계속 진행): ${error instanceof Error ? error.message : String(error)}`,
      );
      return { texts: [], ids: [], entries: [] };
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
