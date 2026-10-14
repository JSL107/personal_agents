import { Processor } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  addDays,
  plainDateToIso,
  todayInKst,
} from '../../agent/vacation/domain/plain-date';
import {
  ART_JOB_POSTING_REPOSITORY_PORT,
  ArtJobPostingRepositoryPort,
} from '../../art-job-feed/domain/port/art-job-posting.repository.port';
import { formatArtJobDeadlineReminder } from '../../art-job-feed/infrastructure/art-job-feed.formatter';
import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { ObservedWorkerHost } from '../../common/queue/observed-worker-host';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { cronIncidentKey } from '../../notification/domain/notification.type';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../slack/domain/port/slack-notifier.port';
import {
  ART_JOB_DEADLINE_CRON_QUEUE,
  ArtJobDeadlineCronJobData,
  REMIND_GAP_HOURS,
} from '../domain/art-job-deadline-cron.type';

const CRON_NAME = 'Art Job Deadline Cron';
const INCIDENT_KEY = cronIncidentKey(CRON_NAME);
const HOUR_MS = 60 * 60 * 1000;
// 한 회차 안의 동시 처리(stalled 재처리)만 막는다 — 다음 회차(4시간 뒤) 전에 만료.
const SLOT_GUARD_TTL_SECONDS = REMIND_GAP_HOURS * 60 * 60;

// 「관심 있음」 공고 중 내일 마감인 것을 받는 사람에게 DM 한 통으로. 0건이면 보내지 않는다.
//
// 장부 기록(markReminded)은 발송 **뒤에** 한다 — 기록이 실패하면 한 번 더 갈 수 있지만,
// 먼저 기록하고 발송이 실패하면 그 알림은 영영 안 간다. 중복이 유실보다 낫다.
@Processor(ART_JOB_DEADLINE_CRON_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class ArtJobDeadlineCronConsumer extends ObservedWorkerHost {
  private readonly logger = new Logger(ArtJobDeadlineCronConsumer.name);

  constructor(
    @Inject(ART_JOB_POSTING_REPOSITORY_PORT)
    private readonly repository: ArtJobPostingRepositoryPort,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<ArtJobDeadlineCronJobData>): Promise<void> {
    const { recipient, ownerSlackUserId } = job.data;
    try {
      const completed = await this.run(recipient, new Date());
      // 가드에 막혀 건너뛴 회차는 해결 신호를 보내지 않는다 — 발송 뒤 장부 기록이 실패해 재시도된
      // 경우, 아무것도 안 한 재시도가 방금 낸 실패 알림을 덮어 버린다.
      if (completed) {
        this.notificationPublisher?.publishRecovery(INCIDENT_KEY);
      }
    } catch (error) {
      this.logger.error(`${CRON_NAME} 실패 (recipient=${recipient})`, error);
      this.notifyOwnerFailure(ownerSlackUserId, error);
      throw error;
    }
  }

  // 이 회차를 끝까지 처리했으면 true, 이미 처리된 회차라 건너뛰었으면 false.
  private async run(recipient: string, now: Date): Promise<boolean> {
    const today = todayInKst(now);
    const due = await this.repository.findDueReminders(
      addDays(today, 1),
      new Date(now.getTime() - REMIND_GAP_HOURS * HOUR_MS),
    );
    this.logger.log(`${CRON_NAME} — 내일 마감 관심 공고 ${due.length}건`);
    if (due.length === 0) {
      return true;
    }

    const kstHour = new Date(now.getTime() + 9 * HOUR_MS).getUTCHours();
    const slotKey = `cron:${ART_JOB_DEADLINE_CRON_QUEUE}:${recipient}:${plainDateToIso(today)}T${kstHour}`;
    const firstRun = await this.cronIdempotency.acquireOnce(
      slotKey,
      SLOT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(`${CRON_NAME} 중복 발송 차단 — 이 회차는 이미 처리됨`);
      return false;
    }
    try {
      await this.slackNotifier.postMessage({
        kind: 'art-job-deadline',
        target: recipient,
        text: formatArtJobDeadlineReminder(due),
        unfurlLinks: false,
      });
    } catch (error) {
      // 가드를 쥔 채 실패하면 BullMQ 재시도가 "이미 처리됨" 으로 끝나 이 회차 알림이 빠진다.
      await this.cronIdempotency.release(slotKey);
      throw error;
    }
    // 여기서 실패하면 가드는 쥔 채로 둔다 — 풀면 재시도가 같은 DM 을 한 번 더 보낸다.
    // 기록이 빠져도 같은 회차는 가드가 막고, 다음 회차 발송은 원래 의도한 두 번째 알림이다.
    await this.repository.markReminded(
      due.map((posting) => posting.id),
      now,
    );
    return true;
  }

  private notifyOwnerFailure(
    ownerSlackUserId: string | null,
    error: unknown,
  ): void {
    if (!this.notificationPublisher || !ownerSlackUserId) {
      return;
    }
    this.notificationPublisher.publishCronFailure({
      cronName: CRON_NAME,
      incidentKey: INCIDENT_KEY,
      ownerSlackUserId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
