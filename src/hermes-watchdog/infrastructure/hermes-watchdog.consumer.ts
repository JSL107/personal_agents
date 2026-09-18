import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import {
  detectHermesCronIssues,
  formatHermesCronIssues,
} from '../domain/hermes-cron-health';
import {
  HERMES_WATCHDOG_QUEUE,
  HermesCronSnapshot,
  HermesWatchdogJobData,
} from '../domain/hermes-watchdog.type';
import { HermesJobsReader } from './hermes-jobs.reader';

// NotificationConsumer 의 cronName 별 30분 dedupe key. 하루 1회 점검이라 항상 통과하지만,
// 수동 재실행이 겹쳐도 같은 내용이 두 번 가지 않는다.
//
// 알람 제목은 NotificationConsumer 가 "⚠️ 이대리 cron 실패 — {cronName}" 로 고정 조립한다.
// 실제로 실패한 것은 이대리가 아니라 Hermes 이므로 이름과 본문 머리말로 그 구분을 드러낸다
// (알람 종류를 새로 파는 대신 — 배관은 그대로 쓴다).
const WATCHDOG_CRON_NAME = 'Hermes 외부 cron';
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

    const issues = detectHermesCronIssues({
      jobs: snapshot.jobs,
      nowMs: Date.now(),
    });

    if (issues.length === 0) {
      this.logger.log(
        `Hermes cron 이상 없음 (job ${snapshot.jobs.length}건 점검).`,
      );
      return;
    }

    this.logger.warn(`Hermes cron 이상 ${issues.length}건 — owner 알림 발송.`);
    this.notificationPublisher.publishCronFailure({
      cronName: WATCHDOG_CRON_NAME,
      ownerSlackUserId,
      errorMessage: `${WATCHDOG_MESSAGE_HEAD}\n${formatHermesCronIssues(issues)}`,
    });
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
        cronName: WATCHDOG_CRON_NAME,
        ownerSlackUserId,
        errorMessage: `${WATCHDOG_MESSAGE_HEAD}\nHermes cron 상태 파일을 읽지 못했습니다 — ${message}`,
      });
      return null;
    }
  }
}
