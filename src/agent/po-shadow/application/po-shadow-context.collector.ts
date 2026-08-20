import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { FailedRunDetail } from '../../../agent-run/domain/port/agent-run.repository.port';
import { ClassifyPullRequestEngagementUsecase } from '../../../github/application/classify-pr-engagement.usecase';
import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
import {
  AssignedTasks,
  GithubPullRequestSummary,
} from '../../../github/domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { ListActiveTasksUsecase } from '../../../notion/application/list-active-tasks.usecase';
import { NotionTask } from '../../../notion/domain/notion.type';
import { ListMyMentionsUsecase } from '../../../slack-collector/application/list-my-mentions.usecase';
import { SlackMention } from '../../../slack-collector/domain/slack-collector.type';
import { PoShadowContext } from '../domain/po-shadow.type';

const MIN_MENTION_SINCE_HOURS = 1;
const MAX_MENTION_SINCE_HOURS = 12;
const MINUTES_PER_DAY = 1440;
const MILLISECONDS_PER_HOUR = 3_600_000;
// 반나절치 머지 상한. Impact Reporter 의 하루 상한(20)과 같은 자릿수로 두되, 정오까지의
// 창이라 더 짧다.
const MERGED_PULL_REQUEST_LIMIT = 20;

const DEGRADED_SOURCE_LABEL = {
  ASSIGNED: 'GitHub 담당 목록',
  MERGED: 'GitHub 머지 목록',
  MENTIONS: 'Slack 멘션',
  NOTION: 'Notion 태스크',
  FAILED_RUNS: '실행 원장',
} as const;

export interface CollectPoShadowContextInput {
  slackUserId: string;
  planEndedAt: Date;
}

@Injectable()
export class PoShadowContextCollector {
  private readonly logger = new Logger(PoShadowContextCollector.name);

  constructor(
    private readonly listAssignedTasksUsecase: ListAssignedTasksUsecase,
    private readonly classifyEngagement: ClassifyPullRequestEngagementUsecase,
    private readonly listMyMentionsUsecase: ListMyMentionsUsecase,
    private readonly listActiveTasksUsecase: ListActiveTasksUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly configService: ConfigService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async collect({
    slackUserId,
    planEndedAt,
  }: CollectPoShadowContextInput): Promise<PoShadowContext> {
    const sinceHours = this.calculateSinceHours({ planEndedAt });
    const degradedSources: string[] = [];
    const [
      assignedTasks,
      mergedPullRequests,
      newMentions,
      notionTasks,
      failedRunsToday,
    ] = await Promise.all([
      this.fetchAssignedTasksOrNull({ degradedSources }),
      this.fetchMergedPullRequestsOrEmpty({ planEndedAt, degradedSources }),
      this.fetchMentionsOrEmpty({ slackUserId, sinceHours, degradedSources }),
      this.fetchNotionTasksOrEmpty({ degradedSources }),
      this.fetchFailedRunsOrEmpty({ degradedSources }),
    ]);

    const githubContext = await this.classifyPullRequests({ assignedTasks });

    return {
      assignedTasks,
      activePullRequests: githubContext.activePullRequests,
      waitingItems: githubContext.waitingItems,
      mergedPullRequests,
      newMentions,
      notionTasks,
      failedRunsToday,
      degradedSources,
    };
  }

  private calculateSinceHours({ planEndedAt }: { planEndedAt: Date }): number {
    const elapsedHours = Math.ceil(
      (Date.now() - planEndedAt.getTime()) / MILLISECONDS_PER_HOUR,
    );
    return Math.min(
      MAX_MENTION_SINCE_HOURS,
      Math.max(MIN_MENTION_SINCE_HOURS, elapsedHours),
    );
  }

  private async fetchAssignedTasksOrNull({
    degradedSources,
  }: {
    degradedSources: string[];
  }): Promise<AssignedTasks | null> {
    try {
      return await this.listAssignedTasksUsecase.execute();
    } catch (error: unknown) {
      degradedSources.push(DEGRADED_SOURCE_LABEL.ASSIGNED);
      this.logger.warn(
        `GitHub assigned tasks 수집 실패 (해당 컨텍스트 없이 계속 진행): ${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  // 담당 목록(`listMyAssignedTasks`)은 open 만 돌려준다. 계획한 PR 을 오전에 머지하면
  // 그 목록에서 사라지므로, 머지 조회가 없으면 "계획대로 끝낸 항목" 이 곧바로
  // PLANNED_NOT_FOUND 로 잡혀 일을 끝낼수록 지적이 늘어난다.
  // author 는 Impact Reporter 와 같은 env 를 재사용한다 — 미설정이면 조회를 건너뛰되
  // 실패로는 세지 않는다(설정 안 한 것과 조회가 죽은 것은 다르다).
  private async fetchMergedPullRequestsOrEmpty({
    planEndedAt,
    degradedSources,
  }: {
    planEndedAt: Date;
    degradedSources: string[];
  }): Promise<GithubPullRequestSummary[]> {
    const author = this.configService
      .get<string>('IMPACT_REPORT_GITHUB_AUTHOR')
      ?.trim();
    if (!author) {
      return [];
    }

    try {
      return await this.githubClient.listAuthorMergedPullRequestsSince({
        repo:
          this.configService.get<string>('IMPACT_REPORT_GITHUB_REPO')?.trim() ||
          null,
        author,
        sinceIsoDate: planEndedAt.toISOString(),
        limit: MERGED_PULL_REQUEST_LIMIT,
      });
    } catch (error: unknown) {
      degradedSources.push(DEGRADED_SOURCE_LABEL.MERGED);
      this.logger.warn(
        `GitHub 머지 PR 수집 실패 (해당 컨텍스트 없이 계속 진행): ${this.errorMessage(error)}`,
      );
      return [];
    }
  }

  private async fetchMentionsOrEmpty({
    slackUserId,
    sinceHours,
    degradedSources,
  }: {
    slackUserId: string;
    sinceHours: number;
    degradedSources: string[];
  }): Promise<SlackMention[]> {
    try {
      return await this.listMyMentionsUsecase.execute({
        slackUserId,
        sinceHours,
      });
    } catch (error: unknown) {
      degradedSources.push(DEGRADED_SOURCE_LABEL.MENTIONS);
      this.logger.warn(
        `Slack 멘션 수집 실패 (해당 컨텍스트 없이 계속 진행): ${this.errorMessage(error)}`,
      );
      return [];
    }
  }

  private async fetchNotionTasksOrEmpty({
    degradedSources,
  }: {
    degradedSources: string[];
  }): Promise<NotionTask[]> {
    try {
      return await this.listActiveTasksUsecase.execute();
    } catch (error: unknown) {
      degradedSources.push(DEGRADED_SOURCE_LABEL.NOTION);
      this.logger.warn(
        `Notion task 수집 실패 (해당 컨텍스트 없이 계속 진행): ${this.errorMessage(error)}`,
      );
      return [];
    }
  }

  private async fetchFailedRunsOrEmpty({
    degradedSources,
  }: {
    degradedSources: string[];
  }): Promise<FailedRunDetail[]> {
    try {
      return await this.agentRunService.findFailedRunsSince({
        withinMinutes: MINUTES_PER_DAY,
      });
    } catch (error: unknown) {
      degradedSources.push(DEGRADED_SOURCE_LABEL.FAILED_RUNS);
      this.logger.warn(
        `실패 AgentRun 수집 실패 (해당 컨텍스트 없이 계속 진행): ${this.errorMessage(error)}`,
      );
      return [];
    }
  }

  private async classifyPullRequests({
    assignedTasks,
  }: {
    assignedTasks: AssignedTasks | null;
  }): Promise<Pick<PoShadowContext, 'activePullRequests' | 'waitingItems'>> {
    if (!assignedTasks) {
      return { activePullRequests: [], waitingItems: [] };
    }

    try {
      return await this.classifyEngagement.execute(assignedTasks.pullRequests);
    } catch (error: unknown) {
      this.logger.warn(
        `PR engagement 분류 실패 (원본 PR로 계속 진행): ${this.errorMessage(error)}`,
      );
      return {
        activePullRequests: assignedTasks.pullRequests,
        waitingItems: [],
      };
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
