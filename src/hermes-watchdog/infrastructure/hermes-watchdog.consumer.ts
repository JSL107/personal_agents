import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import {
  HERMES_SCHEDULER_INCIDENT_KEY,
  HERMES_SNAPSHOT_INCIDENT_KEY,
  hermesJobIncidentKey,
} from '../../notification/domain/notification.type';
import {
  formatHermesCronIssues,
  groupHermesCronIssues,
} from '../domain/hermes-cron-health';
import {
  HERMES_WATCHDOG_QUEUE,
  HermesCronSnapshot,
  HermesWatchdogJobData,
} from '../domain/hermes-watchdog.type';
import { HermesJobsReader } from './hermes-jobs.reader';

const SNAPSHOT_CRON_NAME = 'Hermes cron 상태 파일';
const SCHEDULER_CRON_NAME = 'Hermes scheduler';
const WATCHDOG_MESSAGE_HEAD =
  'Hermes(별도 프로세스)의 cron 점검 결과입니다. 이대리 자신의 cron 실패가 아닙니다.';

// Hermes cron 건강 점검. 자기 프로세스 밖(별도 프로세스인 Hermes)을 보는 것이 요점이다 —
// Hermes 가 통째로 죽어도 이대리는 살아 있으므로 알림이 나간다.
//
// lockDuration 을 LONG_RUNNING_WORKER_OPTIONS 로 늘리지 않는다: 이 worker 는 LLM 을 부르지
// 않고 파일 하나를 읽을 뿐이라 BullMQ 기본 lock 으로 충분하고, 늘리면 실제 hang 시 stalled
// 복구만 늦어진다.
@Processor(HERMES_WATCHDOG_QUEUE)
export class HermesWatchdogConsumer extends WorkerHost {
  private readonly logger = new Logger(HermesWatchdogConsumer.name);

  constructor(
    private readonly hermesJobsReader: HermesJobsReader,
    private readonly notificationPublisher: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<HermesWatchdogJobData>): Promise<void> {
    const { ownerSlackUserId } = job.data;

    const snapshot = await this.readSnapshotOrNotify(ownerSlackUserId);
    if (snapshot === null) {
      return;
    }
    this.notificationPublisher.publishRecovery(HERMES_SNAPSHOT_INCIDENT_KEY);

    const grouped = groupHermesCronIssues({
      jobs: snapshot.jobs,
      nowMs: Date.now(),
    });
    const issueCount =
      grouped.schedulerIssues.length +
      grouped.jobs.reduce((count, entry) => count + entry.issues.length, 0);

    if (issueCount === 0) {
      this.logger.log(
        `Hermes cron 이상 없음 (job ${snapshot.jobs.length}건 점검).`,
      );
    } else {
      this.logger.warn(`Hermes cron 이상 ${issueCount}건 — owner 알림 발송.`);
    }

    for (const entry of grouped.jobs) {
      // 현재 owner 는 한 명이며 사건 key 에 owner 를 넣지 않는다.
      const incidentKey = hermesJobIncidentKey(entry.identifier);
      if (entry.issues.length === 0) {
        this.notificationPublisher.publishRecovery(incidentKey);
      } else {
        this.notificationPublisher.publishCronFailure({
          cronName: `Hermes ${entry.label}`,
          incidentKey,
          ownerSlackUserId,
          errorMessage: `${WATCHDOG_MESSAGE_HEAD}\n${formatHermesCronIssues(entry.issues)}`,
        });
      }
    }

    if (grouped.schedulerIssues.length === 0) {
      this.notificationPublisher.publishRecovery(HERMES_SCHEDULER_INCIDENT_KEY);
    } else {
      this.notificationPublisher.publishCronFailure({
        cronName: SCHEDULER_CRON_NAME,
        incidentKey: HERMES_SCHEDULER_INCIDENT_KEY,
        ownerSlackUserId,
        errorMessage: `${WATCHDOG_MESSAGE_HEAD}\n${formatHermesCronIssues(grouped.schedulerIssues)}`,
      });
    }
  }

  // 스냅샷을 못 읽는 것 자체가 알려야 할 상태다(Hermes 미설치·경로 변경·파일 손상).
  // 알림을 이미 보냈으므로 throw 하지 않는다 — 재시도해도 결과는 같고 알림만 겹친다.
  private async readSnapshotOrNotify(
    ownerSlackUserId: string,
  ): Promise<HermesCronSnapshot | null> {
    try {
      return await this.hermesJobsReader.read();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Hermes cron 스냅샷 읽기 실패: ${message}`);
      this.notificationPublisher.publishCronFailure({
        cronName: SNAPSHOT_CRON_NAME,
        incidentKey: HERMES_SNAPSHOT_INCIDENT_KEY,
        ownerSlackUserId,
        errorMessage: `${WATCHDOG_MESSAGE_HEAD}\nHermes cron 상태 파일을 읽지 못했습니다 — ${message}`,
      });
      return null;
    }
  }
}
