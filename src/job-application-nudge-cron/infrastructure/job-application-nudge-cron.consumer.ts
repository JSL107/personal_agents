import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  JOB_APPLICATION_REPOSITORY_PORT,
  JobApplicationRepositoryPort,
} from '../../agent/job-application/domain/port/job-application.repository.port';
import { formatNudge } from '../../agent/job-application/infrastructure/job-application.formatter';
import { todayInKst } from '../../agent/vacation/domain/plain-date';
import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import {
  JOB_APPLICATION_NUDGE_CRON_QUEUE,
  JobApplicationNudgeCronJobData,
  NUDGE_DEADLINE_WITHIN_DAYS,
} from '../domain/job-application-nudge-cron.type';

// 발송 idempotency TTL — 25h. 다음 날 같은 시각 발사 전 만료되도록 하루보다 약간 길게.
const SENT_GUARD_TTL_SECONDS = 90_000;

// 매일 자동 지원 넛지 — CeoMetaCronConsumer 패턴 그대로.
// 마감 임박(≤3일) / 팔로업 지난 진행 중 지원 건을 SQL 로 조회 → Slack DM.
// due 0건이면 조용히 skip (매일 빈 DM 방지).
//
// 중복 발송 차단: BullMQ stalled 재처리로 같은 슬롯 2회 처리 시 deliverOnce 가 skip.
@Processor(JOB_APPLICATION_NUDGE_CRON_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class JobApplicationNudgeCronConsumer extends WorkerHost {
  private readonly logger = new Logger(JobApplicationNudgeCronConsumer.name);

  constructor(
    @Inject(JOB_APPLICATION_REPOSITORY_PORT)
    private readonly repository: JobApplicationRepositoryPort,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<JobApplicationNudgeCronJobData>): Promise<void> {
    const { ownerSlackUserId, target } = job.data;
    const todayKst = getTodayKstDate();
    this.logger.log(
      `Job Application Nudge Cron 시작 — owner=${ownerSlackUserId} → target=${target}`,
    );

    try {
      const due = await this.repository.findDueNudges({
        slackUserId: ownerSlackUserId,
        today: todayInKst(new Date()),
        deadlineWithinDays: NUDGE_DEADLINE_WITHIN_DAYS,
      });
      if (due.length === 0) {
        this.logger.log(
          `Job Application Nudge — due 0건, skip (${ownerSlackUserId})`,
        );
        // 조용히 skip — 매일 빈 DM 방지.
        return;
      }
      const text = `📌 *지원 넛지 — ${todayKst}*\n\n` + formatNudge(due);
      await this.deliverOnce(target, text);
    } catch (error) {
      this.logger.error(
        `Job Application Nudge Cron 실패 (owner=${ownerSlackUserId})`,
        error,
      );
      this.notifyOwnerFailure(ownerSlackUserId, error);
      throw error;
    }
  }

  // 발송 idempotency 가드 — stalled 재처리로 같은 날 두 번째 처리가 오면 발송 skip.
  private async deliverOnce(target: string, text: string): Promise<void> {
    const dateKey = getTodayKstDate();
    const firstRun = await this.cronIdempotency.acquireOnce(
      `cron:${JOB_APPLICATION_NUDGE_CRON_QUEUE}:${dateKey}`,
      SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(
        `Job Application Nudge Cron 중복 발송 차단 — ${dateKey} 이미 발송됨`,
      );
      return;
    }
    await this.slackNotifier.postMessage({ target, text });
    this.logger.log(`Job Application Nudge Cron 발송 완료 — target=${target}`);
  }

  // fire-and-forget — NotificationQueue 로 enqueue. consumer 측 30분 dedupe + Slack DM.
  private notifyOwnerFailure(ownerSlackUserId: string, error: unknown): void {
    if (!this.notificationPublisher) {
      return;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.notificationPublisher.publishCronFailure({
      cronName: 'Job Application Nudge Cron',
      ownerSlackUserId,
      errorMessage,
    });
  }
}
