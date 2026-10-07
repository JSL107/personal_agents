import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  ClaudeAuthSuspectJobData,
  CronFailureJobData,
  IncidentRecoveredJobData,
  NOTIFICATION_JOB,
  NOTIFICATION_QUEUE,
  NotificationJobData,
} from '../domain/notification.type';

// NotificationModule 의 Producer 단면 — Queue 만 의존 (Redis), Slack 의존 X.
// 호출자가 본 service 를 주입받아 fire-and-forget 으로 알람 발사.
// 실제 Slack 발송은 NotificationConsumer 가 별도 worker process 에서 처리.
@Injectable()
export class NotificationPublisher {
  private readonly logger = new Logger(NotificationPublisher.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly queue: Queue<NotificationJobData>,
  ) {}

  // ModelRouterUsecase 의 ClaudeAuthSuspectException catch path 호출.
  // 사건 판정은 consumer 측에서 — fire-and-forget.
  publishClaudeAuthSuspect(payload: ClaudeAuthSuspectJobData): void {
    void this.queue
      .add(NOTIFICATION_JOB.CLAUDE_AUTH_SUSPECT, payload, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 50,
        removeOnFail: 50,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `claude 인증 의심 알람 enqueue 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  // cron 및 task 실패 경로에서 호출. 사건 판정은 consumer 측에서.
  publishCronFailure(payload: CronFailureJobData): void {
    void this.queue
      .add(NOTIFICATION_JOB.CRON_FAILURE, payload, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 50,
        removeOnFail: 50,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `cron 실패 알람 enqueue 실패 (cron=${payload.cronName}): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  publishRecovery(incidentKey: string): void {
    void this.queue
      .add(
        NOTIFICATION_JOB.INCIDENT_RECOVERED,
        { incidentKey, succeededAt: Date.now() },
        {
          // 같은 key 의 대기 job 은 하나만 둔다(3분 주기 task 의 성공마다 쌓이지 않게).
          // 처리 중인 job 이 있으면 최신 신호를 보관했다가 끝난 뒤 이어서 넣는다.
          deduplication: {
            id: `recovery:${incidentKey}`,
            keepLastIfActive: true,
          },
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: 50,
        },
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `사건 해결 신호 enqueue 실패 (key=${incidentKey}): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  // 조용한 시간(30분)이 덜 지난 해결 신호를 남은 시간 뒤로 다시 넣는다. NotificationConsumer 가 쓴다 —
  // 큐 토큰은 이 모듈 밖으로 내보내지 않으므로 consumer 가 큐를 직접 주입받으면 부팅이 실패한다.
  // 지연 확인에는 중복 제거를 걸지 않는다. 걸면 대기 중인 지연 job 이 키를 쥐고 있는 동안 더 최신
  // 성공 신호가 버려진다. 실패는 호출자가 BullMQ 재시도를 받도록 그대로 던진다.
  async publishDelayedRecovery(
    data: IncidentRecoveredJobData,
    delayMs: number,
  ): Promise<void> {
    await this.queue.add(NOTIFICATION_JOB.INCIDENT_RECOVERED, data, {
      delay: delayMs,
      attempts: 2,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}
