import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { appendIntegrationHint } from '../../../common/domain/integration-failure-hint';
import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
  PullRequestRef,
} from '../../../github/domain/port/github-client.port';
import { resolveCollectionLowerBound } from '../../../schedule/application/collection-window';
import {
  normalizeGithubIssueUrl,
  normalizeGithubPullRequestUrl,
} from '../../../schedule/domain/github-source-url';
import { matchPullRequest } from '../../../schedule/domain/match-pull-request';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../../../schedule/domain/port/schedule.repository.port';
import {
  SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT,
  ScheduleCollectionStateRepositoryPort,
} from '../../../schedule/domain/port/schedule-collection-state.repository.port';
import { ScheduleActor } from '../../../schedule/domain/schedule.repository.type';
import {
  ScheduleEventKind,
  ScheduleSource,
  ScheduleStatus,
} from '../../../schedule/domain/schedule.type';
import {
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';
import {
  ApplyLifecycleInput,
  CollectIssueInput,
  CollectPullRequestInput,
  LifecycleObservation,
  OwnedScheduleInput,
  RecordPrEventInput,
  SourceEditInput,
  TransitionCollectedInput,
} from '../../domain/schedule-collect-github.type';

@Injectable()
export class ScheduleCollectGithubAutopilotTask implements AutopilotTask {
  readonly id = 'schedule-collect-github';
  private readonly logger = new Logger(ScheduleCollectGithubAutopilotTask.name);

  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    @Inject(SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT)
    private readonly stateRepository: ScheduleCollectionStateRepositoryPort,
    private readonly assigned: ListAssignedTasksUsecase,
    @Inject(GITHUB_CLIENT_PORT) private readonly github: GithubClientPort,
    private readonly config: ConfigService,
  ) {}

  async run(): Promise<AutopilotTaskResult> {
    const ownerId = this.config.get<string>('CONSOLE_OWNER_SLACK_USER_ID');
    if (!ownerId) {
      this.logger.warn(
        'CONSOLE_OWNER_SLACK_USER_ID 미설정: GitHub 업무 수집 건너뜀',
      );
      return { skip: true };
    }
    const now = new Date();
    const author = this.config.get<string>('IMPACT_REPORT_GITHUB_AUTHOR');
    try {
      const issueLowerBound = resolveCollectionLowerBound({
        lastSucceededAt: null,
        now,
      });
      const prLowerBound = author
        ? resolveCollectionLowerBound({
            lastSucceededAt: await this.stateRepository.get(
              ScheduleSource.GITHUB_PR,
            ),
            now,
          })
        : null;
      // 모든 GitHub 조회를 먼저 끝낸다. 부분 응답을 닫힌 PR로 오인하지 않는다.
      const assignedTasks = await this.assigned.execute({
        updatedSinceIsoDate: new Date(issueLowerBound.getTime() + 9 * 3_600_000)
          .toISOString()
          .slice(0, 10),
        limit: 100,
      });
      const openPullRequests =
        author && prLowerBound
          ? await this.github.listAuthorOpenPullRequests({
              repo: null,
              author,
              sinceIsoDate: prLowerBound.toISOString(),
              limit: 100,
              throwOnDetailFailure: true,
              includeDraft: true,
            })
          : [];
      const mergedPullRequests =
        author && prLowerBound
          ? await this.github.listAuthorMergedPullRequestsSince({
              repo: null,
              author,
              sinceIsoDate: prLowerBound.toISOString(),
              limit: 100,
              throwOnDetailFailure: true,
            })
          : [];
      const prItems = author
        ? await this.repository.findBySource({
            slackUserId: ownerId,
            source: ScheduleSource.GITHUB_PR,
          })
        : [];
      const openKeys = new Set(
        openPullRequests.map((pullRequest) =>
          normalizeGithubPullRequestUrl({
            repo: pullRequest.repo,
            number: pullRequest.number,
          }).toLowerCase(),
        ),
      );
      const mergedKeys = new Set(
        mergedPullRequests.map((pullRequest) =>
          normalizeGithubPullRequestUrl({
            repo: pullRequest.repo,
            number: pullRequest.number,
          }).toLowerCase(),
        ),
      );
      const lifecycleObservations: LifecycleObservation[] = [];
      for (const item of prItems) {
        if (
          item.status !== ScheduleStatus.IN_PROGRESS ||
          !item.sourceKey ||
          openKeys.has(item.sourceKey.toLowerCase()) ||
          mergedKeys.has(item.sourceKey.toLowerCase())
        ) {
          continue;
        }
        const ref = parsePullRequestUrl(item.sourceKey);
        if (!ref) {
          continue;
        }
        // 조회 실패는 닫힘이 아니다 — 그 PR 만 건너뛰고 다음 회차가 다시 확인한다. 전체를
        // 실패시키면 지워진 레포의 PR 하나가 매 회차 GitHub 수집을 통째로 막는다.
        try {
          lifecycleObservations.push({
            item,
            lifecycle: await this.github.getItemLifecycle(ref),
          });
        } catch (error) {
          this.logger.warn(
            appendIntegrationHint(
              `PR 상태 확인 실패(${item.sourceKey}): ${error instanceof Error ? error.message : String(error)}`,
              error,
            ),
          );
        }
      }
      for (const issue of assignedTasks.issues) {
        await this.collectIssue({ issue, ownerId, now });
      }
      if (author) {
        const candidates = await this.repository.findAllByOwner(ownerId);
        for (const pullRequest of [
          ...openPullRequests,
          ...mergedPullRequests,
        ]) {
          await this.collectPullRequest({
            pullRequest,
            ownerId,
            now,
            candidates,
          });
        }
        for (const observation of lifecycleObservations) {
          await this.applyLifecycle({ ...observation, ownerId, now });
        }
      }
      await this.stateRepository.markSucceeded(
        ScheduleSource.GITHUB_ISSUE,
        now,
      );
      if (author) {
        await this.stateRepository.markSucceeded(ScheduleSource.GITHUB_PR, now);
      }
    } catch (error) {
      this.logger.warn(
        appendIntegrationHint(
          `GitHub 업무 수집 실패: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
      );
    }
    return { skip: true };
  }

  private async collectIssue({
    issue,
    ownerId,
    now,
  }: CollectIssueInput): Promise<void> {
    const sourceKey = normalizeGithubIssueUrl({
      repo: issue.repo,
      number: issue.number,
    });
    const title = repoTitle(issue.repo, issue.title);
    const found = await this.repository.findBySourceKey({
      slackUserId: ownerId,
      source: ScheduleSource.GITHUB_ISSUE,
      sourceKey,
    });
    if (found) {
      await this.noteSourceEdit({ item: found, title, now });
      return;
    }
    await this.repository.createCollected({
      slackUserId: ownerId,
      title,
      dueDate: null,
      source: ScheduleSource.GITHUB_ISSUE,
      sourceKey,
      sourceUrl: sourceKey,
      status: ScheduleStatus.OPEN,
    });
  }

  private async collectPullRequest({
    pullRequest,
    ownerId,
    now,
    candidates,
  }: CollectPullRequestInput): Promise<void> {
    const sourceKey = normalizeGithubPullRequestUrl({
      repo: pullRequest.repo,
      number: pullRequest.number,
    });
    const found = await this.repository.findBySourceKey({
      slackUserId: ownerId,
      source: ScheduleSource.GITHUB_PR,
      sourceKey,
    });
    if (found) {
      await this.noteSourceEdit({
        item: found,
        title: repoTitle(pullRequest.repo, pullRequest.title),
        now,
      });
      if (pullRequest.state === 'merged') {
        await this.recordPrEvent({
          item: found,
          pullRequest,
          kind: ScheduleEventKind.PR_MERGED,
          ownerId,
          now,
        });
      } else if (
        found.status === ScheduleStatus.SKIPPED &&
        (await this.wasCollectorSkipped({ item: found, ownerId }))
      ) {
        const recorded = await this.repository.addEvent({
          scheduleItemId: found.id,
          kind: ScheduleEventKind.NOTE,
          payload: { text: 'PR이 다시 열렸습니다.' },
          dedupeKey: `pr-reopened:${sourceKey}`,
          occurredAt: now,
        });
        if (recorded !== 'DUPLICATE') {
          await this.transition({
            item: found,
            to: ScheduleStatus.IN_PROGRESS,
            ownerId,
            now,
          });
        }
      }
      return;
    }
    const matched = matchPullRequest({ pullRequest, items: candidates });
    if (matched.kind === 'AMBIGUOUS') {
      return;
    }
    if (matched.kind === 'ONE') {
      await this.recordPrEvent({
        item: matched.item,
        pullRequest,
        kind:
          pullRequest.state === 'merged'
            ? ScheduleEventKind.PR_MERGED
            : ScheduleEventKind.PR_LINKED,
        ownerId,
        now,
      });
      return;
    }
    const created = await this.repository.createCollected({
      slackUserId: ownerId,
      title: repoTitle(pullRequest.repo, pullRequest.title),
      dueDate: null,
      source: ScheduleSource.GITHUB_PR,
      sourceKey,
      sourceUrl: sourceKey,
      status: ScheduleStatus.IN_PROGRESS,
      startedAt: pullRequest.createdAt ? new Date(pullRequest.createdAt) : now,
    });
    if (created !== 'DUPLICATE' && pullRequest.state === 'merged') {
      await this.recordPrEvent({
        item: { ...created, status: ScheduleStatus.IN_PROGRESS },
        pullRequest,
        kind: ScheduleEventKind.PR_MERGED,
        ownerId,
        now,
      });
    }
  }

  private async recordPrEvent({
    item,
    pullRequest,
    kind,
    ownerId,
    now,
  }: RecordPrEventInput): Promise<void> {
    const sourceKey = normalizeGithubPullRequestUrl({
      repo: pullRequest.repo,
      number: pullRequest.number,
    });
    const recorded = await this.repository.addEvent({
      scheduleItemId: item.id,
      kind,
      payload: {
        number: pullRequest.number,
        url: sourceKey,
        repo: pullRequest.repo,
      },
      dedupeKey: sourceKey,
      occurredAt: now,
    });
    if (recorded === 'DUPLICATE') {
      return;
    }
    const to =
      kind === ScheduleEventKind.PR_LINKED
        ? ScheduleStatus.IN_PROGRESS
        : ScheduleStatus.DONE;
    const allowed =
      kind === ScheduleEventKind.PR_LINKED
        ? [ScheduleStatus.OPEN, ScheduleStatus.CANDIDATE]
        : [ScheduleStatus.OPEN, ScheduleStatus.IN_PROGRESS];
    const current = await this.repository.findById(item.id);
    if (current?.slackUserId === ownerId && allowed.includes(current.status)) {
      await this.transition({ item: current, to, ownerId, now });
    }
  }

  private async applyLifecycle({
    item,
    lifecycle,
    ownerId,
    now,
  }: ApplyLifecycleInput): Promise<void> {
    if (
      !lifecycle.isPullRequest ||
      lifecycle.state !== 'closed' ||
      !item.sourceKey
    ) {
      return;
    }
    if (lifecycle.mergedAt) {
      const recorded = await this.repository.addEvent({
        scheduleItemId: item.id,
        kind: ScheduleEventKind.PR_MERGED,
        payload: { url: item.sourceKey },
        dedupeKey: item.sourceKey,
        occurredAt: now,
      });
      if (recorded !== 'DUPLICATE') {
        await this.transition({ item, to: ScheduleStatus.DONE, ownerId, now });
      }
      return;
    }
    const recorded = await this.repository.addEvent({
      scheduleItemId: item.id,
      kind: ScheduleEventKind.NOTE,
      payload: { text: 'PR이 머지 없이 닫혔습니다.' },
      dedupeKey: `pr-closed:${item.sourceKey}`,
      occurredAt: now,
    });
    if (recorded !== 'DUPLICATE') {
      await this.transition({ item, to: ScheduleStatus.SKIPPED, ownerId, now });
    }
  }

  private async wasCollectorSkipped({
    item,
    ownerId,
  }: OwnedScheduleInput): Promise<boolean> {
    const detail = await this.repository.findDetail({
      id: item.id,
      slackUserId: ownerId,
    });
    const latestStatus = detail?.events.find(
      (event) => event.kind === ScheduleEventKind.STATUS_CHANGED,
    );
    const payload = latestStatus?.payload;
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'actor' in payload &&
      'to' in payload &&
      payload.actor === ScheduleActor.COLLECTOR &&
      payload.to === ScheduleStatus.SKIPPED
    );
  }

  private async noteSourceEdit({
    item,
    title,
    now,
  }: SourceEditInput): Promise<void> {
    if (item.title === title) {
      return;
    }
    const hash = createHash('sha256').update(title).digest('hex');
    await this.repository.addEvent({
      scheduleItemId: item.id,
      kind: ScheduleEventKind.NOTE,
      payload: { text: `원천 업무 변경: ${title}`.slice(0, 500) },
      dedupeKey: `source-edit:${hash}`,
      occurredAt: now,
    });
  }

  private async transition({
    item,
    to,
    ownerId,
    now,
  }: TransitionCollectedInput): Promise<void> {
    await this.repository.transition({
      id: item.id,
      slackUserId: ownerId,
      from: item.status,
      to,
      now,
      actor: ScheduleActor.COLLECTOR,
    });
  }
}

const repoTitle = (repo: string, title: string): string =>
  `[${repo.split('/').at(-1) ?? repo}] ${title}`.slice(0, 200);

const parsePullRequestUrl = (url: string): PullRequestRef | null => {
  const found = url.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/i,
  );
  return found ? { repo: found[1], number: Number(found[2]) } : null;
};
