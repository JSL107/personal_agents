import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { appendIntegrationHint } from '../../common/domain/integration-failure-hint';
import { GithubPullRequestSummary } from '../../github/domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
  GithubItemLifecycle,
} from '../../github/domain/port/github-client.port';
import {
  normalizeGithubPullRequestUrl,
  parsePullRequestUrl,
} from '../domain/github-source-url';
import { matchPullRequest } from '../domain/match-pull-request';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import {
  SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT,
  ScheduleCollectionStateRepositoryPort,
} from '../domain/port/schedule-collection-state.repository.port';
import { ScheduleActor } from '../domain/schedule.repository.type';
import {
  ScheduleEventKind,
  ScheduleItemRecord,
  ScheduleSource,
  ScheduleStatus,
} from '../domain/schedule.type';
import { toSourceCompletedAt } from '../domain/source-completed-at';
import { resolveCollectionLowerBound } from './collection-window';

interface ReconcileInput {
  ownerId: string;
  now: Date;
}
export interface ReconcileResult {
  ok: boolean;
}
export interface PreparedPullRequests {
  ownerId: string;
  now: Date;
  authorConfigured: boolean;
  openPullRequests: GithubPullRequestSummary[];
  mergedPullRequests: GithubPullRequestSummary[];
  lifecycleObservations: LifecycleObservation[];
}
interface LifecycleObservation {
  item: ScheduleItemRecord;
  lifecycle: GithubItemLifecycle;
}
interface CollectPullRequestInput {
  pullRequest: GithubPullRequestSummary;
  ownerId: string;
  now: Date;
  candidates: ScheduleItemRecord[];
}
interface RecordPrEventInput {
  item: ScheduleItemRecord;
  pullRequest: GithubPullRequestSummary;
  kind: ScheduleEventKind.PR_LINKED | ScheduleEventKind.PR_MERGED;
  ownerId: string;
  now: Date;
}
interface ApplyLifecycleInput extends LifecycleObservation {
  ownerId: string;
  now: Date;
}
interface OwnedScheduleInput {
  item: ScheduleItemRecord;
  ownerId: string;
}
interface SourceEditInput {
  item: ScheduleItemRecord;
  title: string;
  now: Date;
}

@Injectable()
export class ReconcilePullRequestsUsecase {
  private readonly logger = new Logger(ReconcilePullRequestsUsecase.name);
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    @Inject(SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT)
    private readonly stateRepository: ScheduleCollectionStateRepositoryPort,
    @Inject(GITHUB_CLIENT_PORT) private readonly github: GithubClientPort,
    private readonly config: ConfigService,
  ) {}

  async execute(input: ReconcileInput): Promise<ReconcileResult> {
    const prepared = await this.prepare(input);
    if (!prepared) {
      return { ok: false };
    }
    return await this.apply(prepared);
  }

  async prepare({
    ownerId,
    now,
  }: ReconcileInput): Promise<PreparedPullRequests | null> {
    try {
      const author = this.config.get<string>('IMPACT_REPORT_GITHUB_AUTHOR');
      if (!author) {
        return {
          ownerId,
          now,
          authorConfigured: false,
          openPullRequests: [],
          mergedPullRequests: [],
          lifecycleObservations: [],
        };
      }
      const prLowerBound = resolveCollectionLowerBound({
        lastSucceededAt: await this.stateRepository.get(
          ScheduleSource.GITHUB_PR,
        ),
        now,
      });
      const openPullRequests = prLowerBound
        ? await this.github.listAuthorOpenPullRequests({
            repo: null,
            author,
            sinceIsoDate: prLowerBound.toISOString(),
            limit: 100,
            throwOnDetailFailure: true,
            includeDraft: true,
          })
        : [];
      const mergedPullRequests = prLowerBound
        ? await this.github.listAuthorMergedPullRequestsSince({
            repo: null,
            author,
            sinceIsoDate: prLowerBound.toISOString(),
            limit: 100,
            throwOnDetailFailure: true,
          })
        : [];
      const prItems = await this.repository.findBySource({
        slackUserId: ownerId,
        source: ScheduleSource.GITHUB_PR,
      });
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
      return {
        ownerId,
        now,
        authorConfigured: true,
        openPullRequests,
        mergedPullRequests,
        lifecycleObservations,
      };
    } catch (error) {
      this.logger.warn(
        appendIntegrationHint(
          `PR 정합 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
      );
      return null;
    }
  }

  async apply({
    ownerId,
    now,
    authorConfigured,
    openPullRequests,
    mergedPullRequests,
    lifecycleObservations,
  }: PreparedPullRequests): Promise<ReconcileResult> {
    if (!authorConfigured) {
      return { ok: true };
    }
    try {
      const candidates = await this.repository.findAllByOwner(ownerId);
      for (const pullRequest of [...openPullRequests, ...mergedPullRequests]) {
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
      return { ok: true };
    } catch (error) {
      this.logger.warn(
        appendIntegrationHint(
          `PR 정합 실패: ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
      );
      return { ok: false };
    }
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
        await this.repository.recordEventAndTransition({
          event: {
            scheduleItemId: found.id,
            kind: ScheduleEventKind.NOTE,
            payload: { text: 'PR이 다시 열렸습니다.' },
            dedupeKey: `pr-reopened:${sourceKey}`,
            occurredAt: now,
          },
          slackUserId: ownerId,
          transitionFrom: [ScheduleStatus.SKIPPED],
          transitionTo: ScheduleStatus.IN_PROGRESS,
          now,
          actor: ScheduleActor.COLLECTOR,
        });
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
    const to =
      kind === ScheduleEventKind.PR_LINKED
        ? ScheduleStatus.IN_PROGRESS
        : ScheduleStatus.DONE;
    const allowed =
      kind === ScheduleEventKind.PR_LINKED
        ? [ScheduleStatus.OPEN, ScheduleStatus.CANDIDATE]
        : [ScheduleStatus.OPEN, ScheduleStatus.IN_PROGRESS];
    await this.repository.recordEventAndTransition({
      event: {
        scheduleItemId: item.id,
        kind,
        payload: {
          number: pullRequest.number,
          url: sourceKey,
          repo: pullRequest.repo,
        },
        dedupeKey: sourceKey,
        occurredAt: now,
      },
      slackUserId: ownerId,
      transitionFrom: allowed,
      transitionTo: to,
      now,
      ...(kind === ScheduleEventKind.PR_MERGED && pullRequest.mergedAt
        ? {
            completedAt: toSourceCompletedAt({
              source: pullRequest.mergedAt,
              now,
            }),
          }
        : {}),
      actor: ScheduleActor.COLLECTOR,
    });
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
      await this.repository.recordEventAndTransition({
        event: {
          scheduleItemId: item.id,
          kind: ScheduleEventKind.PR_MERGED,
          payload: { url: item.sourceKey },
          dedupeKey: item.sourceKey,
          occurredAt: now,
        },
        slackUserId: ownerId,
        transitionFrom: [ScheduleStatus.OPEN, ScheduleStatus.IN_PROGRESS],
        transitionTo: ScheduleStatus.DONE,
        now,
        completedAt: toSourceCompletedAt({ source: lifecycle.mergedAt, now }),
        actor: ScheduleActor.COLLECTOR,
      });
      return;
    }
    await this.repository.recordEventAndTransition({
      event: {
        scheduleItemId: item.id,
        kind: ScheduleEventKind.NOTE,
        payload: { text: 'PR이 머지 없이 닫혔습니다.' },
        dedupeKey: `pr-closed:${item.sourceKey}`,
        occurredAt: now,
      },
      slackUserId: ownerId,
      transitionFrom: [ScheduleStatus.IN_PROGRESS],
      transitionTo: ScheduleStatus.SKIPPED,
      now,
      actor: ScheduleActor.COLLECTOR,
    });
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
    if (typeof payload !== 'object' || payload === null) {
      return false;
    }
    const actor = 'actor' in payload ? payload.actor : undefined;
    const to = 'to' in payload ? payload.to : undefined;
    const skippedByCollector =
      actor === ScheduleActor.COLLECTOR && to === ScheduleStatus.SKIPPED;
    return skippedByCollector;
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
}

const repoTitle = (repo: string, title: string): string =>
  `[${repo.split('/').at(-1) ?? repo}] ${title}`.slice(0, 200);
