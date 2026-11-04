import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { appendIntegrationHint } from '../../../common/domain/integration-failure-hint';
import { ListAssignedTasksUsecase } from '../../../github/application/list-assigned-tasks.usecase';
import { CloseFinishedIssuesUsecase } from '../../../schedule/application/close-finished-issues.usecase';
import { resolveCollectionLowerBound } from '../../../schedule/application/collection-window';
import { GenerateShortTitlesUsecase } from '../../../schedule/application/generate-short-titles.usecase';
import { ReconcilePullRequestsUsecase } from '../../../schedule/application/reconcile-pull-requests.usecase';
import { normalizeGithubIssueUrl } from '../../../schedule/domain/github-source-url';
import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../../../schedule/domain/port/schedule.repository.port';
import {
  SCHEDULE_COLLECTION_STATE_REPOSITORY_PORT,
  ScheduleCollectionStateRepositoryPort,
} from '../../../schedule/domain/port/schedule-collection-state.repository.port';
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
  CollectIssueInput,
  SourceEditInput,
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
    private readonly reconcilePullRequests: ReconcilePullRequestsUsecase,
    private readonly config: ConfigService,
    private readonly closeFinishedIssues: CloseFinishedIssuesUsecase,
    private readonly generateShortTitles: GenerateShortTitlesUsecase,
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
      const assignedTasks = await this.assigned.execute({
        updatedSinceIsoDate: new Date(issueLowerBound.getTime() + 9 * 3_600_000)
          .toISOString()
          .slice(0, 10),
        limit: 100,
      });
      const prepared = await this.reconcilePullRequests.prepare({
        ownerId,
        now,
      });
      if (!prepared) {
        return { skip: true };
      }
      for (const issue of assignedTasks.issues) {
        await this.collectIssue({ issue, ownerId, now });
      }
      const reconciled = await this.reconcilePullRequests.apply(prepared);
      if (!reconciled.ok) {
        return { skip: true };
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
    } finally {
      try {
        await this.closeFinishedIssues.execute({ ownerId, now });
      } catch (error) {
        this.logger.warn(
          appendIntegrationHint(
            `GitHub 이슈 완료 확인 실패: ${error instanceof Error ? error.message : String(error)}`,
            error,
          ),
        );
      }
      try {
        await this.generateShortTitles.execute({ ownerId });
      } catch (error) {
        this.logger.warn(
          `짧은 업무 이름 생성 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
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
