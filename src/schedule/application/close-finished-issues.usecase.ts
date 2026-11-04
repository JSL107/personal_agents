import { Inject, Injectable, Logger } from '@nestjs/common';

import { appendIntegrationHint } from '../../common/domain/integration-failure-hint';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
  PullRequestRef,
} from '../../github/domain/port/github-client.port';
import { AUTO_COMPLETE_CHECK_MAX } from '../domain/daily-todo.constant';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import { ScheduleActor } from '../domain/schedule.repository.type';
import {
  ScheduleEventKind,
  ScheduleItemRecord,
  ScheduleSource,
  ScheduleStatus,
} from '../domain/schedule.type';
import { toSourceCompletedAt } from '../domain/source-completed-at';

interface CloseFinishedIssuesInput {
  ownerId: string;
  now: Date;
}

const parseIssueUrl = (url: string): PullRequestRef | null => {
  const found = url.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/i,
  );
  return found ? { repo: found[1], number: Number(found[2]) } : null;
};

@Injectable()
export class CloseFinishedIssuesUsecase {
  private readonly logger = new Logger(CloseFinishedIssuesUsecase.name);
  private cursorId = 0;

  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
    @Inject(GITHUB_CLIENT_PORT) private readonly github: GithubClientPort,
  ) {}

  async execute({ ownerId, now }: CloseFinishedIssuesInput): Promise<void> {
    const items = await this.repository.findBySource({
      slackUserId: ownerId,
      source: ScheduleSource.GITHUB_ISSUE,
    });
    const candidates = items
      .filter(
        (item) =>
          item.status === ScheduleStatus.OPEN ||
          item.status === ScheduleStatus.IN_PROGRESS,
      )
      .sort((left, right) => left.id - right.id);
    const afterCursor = candidates.filter((item) => item.id > this.cursorId);
    const beforeCursor = candidates.filter((item) => item.id <= this.cursorId);
    const batch = [...afterCursor, ...beforeCursor].slice(
      0,
      AUTO_COMPLETE_CHECK_MAX,
    );

    for (const item of batch) {
      this.cursorId = item.id;
      await this.closeIfFinished({ item, ownerId, now });
    }
  }

  private async closeIfFinished({
    item,
    ownerId,
    now,
  }: CloseFinishedIssuesInput & { item: ScheduleItemRecord }): Promise<void> {
    if (!item.sourceKey) {
      return;
    }
    const ref = parseIssueUrl(item.sourceKey);
    if (!ref) {
      return;
    }
    try {
      const lifecycle = await this.github.getItemLifecycle(ref);
      if (lifecycle.state !== 'closed' || lifecycle.isPullRequest) {
        return;
      }
      const skipped =
        lifecycle.stateReason === 'not_planned' ||
        lifecycle.stateReason === 'duplicate';
      await this.repository.recordEventAndTransition({
        event: {
          scheduleItemId: item.id,
          kind: ScheduleEventKind.NOTE,
          payload: {
            text: skipped
              ? 'GitHub 이슈가 그만둔 일로 닫혔습니다.'
              : 'GitHub 이슈가 완료됐습니다.',
          },
          dedupeKey: `issue-closed:${item.sourceKey}:${lifecycle.closedAt ?? 'unknown'}`,
          occurredAt: now,
        },
        slackUserId: ownerId,
        transitionFrom: [ScheduleStatus.OPEN, ScheduleStatus.IN_PROGRESS],
        transitionTo: skipped ? ScheduleStatus.SKIPPED : ScheduleStatus.DONE,
        now,
        ...(!skipped
          ? {
              completedAt: toSourceCompletedAt({
                source: lifecycle.closedAt,
                now,
              }),
            }
          : {}),
        actor: ScheduleActor.COLLECTOR,
      });
    } catch (error) {
      this.logger.warn(
        appendIntegrationHint(
          `GitHub 이슈 상태 확인 실패(${item.sourceKey}): ${error instanceof Error ? error.message : String(error)}`,
          error,
        ),
      );
    }
  }
}
