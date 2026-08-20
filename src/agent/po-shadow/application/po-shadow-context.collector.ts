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
  ENGAGEMENT: 'GitHub PR 진행 신호',
  MENTIONS: 'Slack 멘션',
  NOTION: 'Notion 태스크',
  FAILED_RUNS: '실행 원장',
} as const;

interface MergedPullRequestLookup {
  pullRequests: GithubPullRequestSummary[];
  // 조회를 실제로 했는지. false 면 "머지된 게 없다" 가 아니라 "확인하지 못했다" 다.
  available: boolean;
}

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
      mergedLookup,
      newMentions,
      notionTasks,
      failedRunsToday,
    ] = await Promise.all([
      this.fetchAssignedTasksOrNull({ degradedSources }),
      this.fetchMergedPullRequestsOrEmpty({ planEndedAt, degradedSources }),
      this.fetchMentionsOrEmpty({
        slackUserId,
        sinceHours,
        planEndedAt,
        degradedSources,
      }),
      this.fetchNotionTasksOrEmpty({ degradedSources }),
      this.fetchFailedRunsOrEmpty({ slackUserId, degradedSources }),
    ]);

    const githubContext = await this.classifyPullRequests({
      assignedTasks,
      degradedSources,
    });

    return {
      assignedTasks,
      activePullRequests: githubContext.activePullRequests,
      waitingItems: githubContext.waitingItems,
      mergedPullRequests: mergedLookup.pullRequests,
      mergedLookupAvailable: mergedLookup.available,
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
  }): Promise<MergedPullRequestLookup> {
    const author = this.configService
      .get<string>('IMPACT_REPORT_GITHUB_AUTHOR')
      ?.trim();
    // author 를 모르면 조회 자체를 못 한다. 빈 배열을 "머지된 게 없다" 로 쓰면 계획대로
    // 끝낸 PR 이 곧바로 미발견으로 잡히므로, 확인하지 못했다는 사실을 그대로 넘긴다.
    if (!author) {
      return { pullRequests: [], available: false };
    }

    try {
      const pullRequests =
        await this.githubClient.listAuthorMergedPullRequestsSince({
          repo:
            this.configService
              .get<string>('IMPACT_REPORT_GITHUB_REPO')
              ?.trim() || null,
          author,
          sinceIsoDate: planEndedAt.toISOString(),
          limit: MERGED_PULL_REQUEST_LIMIT,
        });
      return { pullRequests, available: true };
    } catch (error: unknown) {
      degradedSources.push(DEGRADED_SOURCE_LABEL.MERGED);
      this.logger.warn(
        `GitHub 머지 PR 수집 실패 (해당 컨텍스트 없이 계속 진행): ${this.errorMessage(error)}`,
      );
      return { pullRequests: [], available: false };
    }
  }

  // sinceHours 는 시간 단위 올림이라 조회 창이 계획 시각보다 앞선다. 그대로 두면 아침 계획
  // 전에 온 멘션이 "계획 이후 새 멘션" 으로 카드에 오른다 — 조회 창을 넓게 잡되 결과는
  // 계획 종료 시각으로 다시 자른다.
  private async fetchMentionsOrEmpty({
    slackUserId,
    sinceHours,
    planEndedAt,
    degradedSources,
  }: {
    slackUserId: string;
    sinceHours: number;
    planEndedAt: Date;
    degradedSources: string[];
  }): Promise<SlackMention[]> {
    try {
      const mentions = await this.listMyMentionsUsecase.execute({
        slackUserId,
        sinceHours,
      });
      return mentions.filter((mention) =>
        isPostedAfter({ mention, planEndedAt }),
      );
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

  // 이 검토는 한 사람의 계획을 본다. 사용자를 한정하지 않으면 다른 사용자의 실패가
  // WORKER_FAILED 사실로 들어가 남의 실패 사유가 카드와 원장 evidence 에 실린다
  // (PM 조회를 slackUserId 로 한정한 것과 같은 이유).
  private async fetchFailedRunsOrEmpty({
    slackUserId,
    degradedSources,
  }: {
    slackUserId: string;
    degradedSources: string[];
  }): Promise<FailedRunDetail[]> {
    try {
      return await this.agentRunService.findFailedRunsSince({
        withinMinutes: MINUTES_PER_DAY,
        slackUserId,
      });
    } catch (error: unknown) {
      degradedSources.push(DEGRADED_SOURCE_LABEL.FAILED_RUNS);
      this.logger.warn(
        `실패 AgentRun 수집 실패 (해당 컨텍스트 없이 계속 진행): ${this.errorMessage(error)}`,
      );
      return [];
    }
  }

  // 분류가 실패하면 원본 PR 은 남지만 "방치" 판정이 통째로 사라진다 — 대기 중인 PR 이
  // 있어도 사실표에 STALLED 가 없어 조용한 회차로 나갈 수 있다. 원본 보존만으로는
  // 복구되지 않는 손실이므로 조회 실패로 기록한다.
  private async classifyPullRequests({
    assignedTasks,
    degradedSources,
  }: {
    assignedTasks: AssignedTasks | null;
    degradedSources: string[];
  }): Promise<Pick<PoShadowContext, 'activePullRequests' | 'waitingItems'>> {
    if (!assignedTasks) {
      return { activePullRequests: [], waitingItems: [] };
    }

    try {
      return await this.classifyEngagement.execute(assignedTasks.pullRequests);
    } catch (error: unknown) {
      degradedSources.push(DEGRADED_SOURCE_LABEL.ENGAGEMENT);
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

// Slack ts 는 "1787072400.000100" 처럼 epoch 초를 담은 문자열이다. 파싱이 안 되면
// 버리지 않고 남긴다 — 형식 변화로 새 멘션이 통째로 사라지는 쪽이 더 위험하다.
const isPostedAfter = ({
  mention,
  planEndedAt,
}: {
  mention: SlackMention;
  planEndedAt: Date;
}): boolean => {
  const postedAtSeconds = Number.parseFloat(mention.ts);
  if (!Number.isFinite(postedAtSeconds)) {
    return true;
  }
  return postedAtSeconds * 1000 >= planEndedAt.getTime();
};
