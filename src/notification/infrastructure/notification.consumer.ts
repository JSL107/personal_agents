import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlertIncident } from '@prisma/client';
import { Job } from 'bullmq';

import { ObservedWorkerHost } from '../../common/queue/observed-worker-host';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DeliveryKind,
  SLACK_DELIVERY_SUPPRESS_REASON,
} from '../../slack/domain/slack-delivery.type';
import { SlackService } from '../../slack/slack.service';
import { NotificationPublisher } from '../application/notification-publisher.service';
import {
  decideOnFailure,
  formatIncidentDuration,
  INCIDENT_QUIET_MS,
  normalizeIncidentCause,
} from '../domain/alert-incident.policy';
import {
  CLAUDE_AUTH_INCIDENT_KEY,
  ClaudeAuthSuspectJobData,
  CronFailureJobData,
  cronIncidentKey,
  IncidentRecoveredJobData,
  NOTIFICATION_JOB,
  NOTIFICATION_QUEUE,
  NotificationJobData,
  NotificationJobName,
} from '../domain/notification.type';

const DEDUPE_WINDOW_MS = 30 * 60 * 1000;
const DATABASE_FALLBACK_MARKER = '_사건 원장 접근 실패 — 중복 억제 없이 발송_';

export const shouldFireAlert = ({
  lastFiredAtMs,
  nowMs,
  windowMs = DEDUPE_WINDOW_MS,
}: {
  lastFiredAtMs: number | null;
  nowMs: number;
  windowMs?: number;
}): boolean => {
  if (lastFiredAtMs === null) {
    return true;
  }
  return nowMs - lastFiredAtMs >= windowMs;
};

export const ALERT_OWNER_ENV_KEYS = [
  'CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID',
  'CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID',
] as const;

export const findMissingAlertOwnerKeys = (
  values: Record<string, string | undefined>,
): string[] => {
  return ALERT_OWNER_ENV_KEYS.filter((key) => {
    const value = values[key];
    return !value || value.trim().length === 0;
  });
};

interface FailureAlert {
  key: string;
  label: string;
  errorMessage: string;
  ownerId: string;
  kind: DeliveryKind;
}

// job 생성 시각. BullMQ 가 항상 채우지만 테스트·수동 호출에 대비해 현재 시각으로 떨어진다.
const readOccurredAt = (job: Job<NotificationJobData>): Date =>
  new Date(job.timestamp ?? Date.now());

@Injectable()
@Processor(NOTIFICATION_QUEUE, {
  concurrency: 1,
  ...LONG_RUNNING_WORKER_OPTIONS,
})
export class NotificationConsumer
  extends ObservedWorkerHost
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(NotificationConsumer.name);
  private readonly lastFiredAtByKey = new Map<string, number>();

  constructor(
    private readonly slackService: SlackService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly notificationPublisher: NotificationPublisher,
  ) {
    super();
  }

  onApplicationBootstrap(): void {
    const missing = findMissingAlertOwnerKeys({
      CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID: this.configService.get<string>(
        'CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID',
      ),
      CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID: this.configService.get<string>(
        'CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID',
      ),
    });
    if (missing.length > 0) {
      this.logger.warn(
        `알람 owner 미설정 — 해당 알람은 발송되지 않습니다: ${missing.join(', ')}`,
      );
      if (missing.includes('CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID')) {
        this.logger.warn(
          'Autopilot task 실패는 DM 전용이므로 CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID 없이는 보이지 않습니다.',
        );
      }
    }
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const name = job.name as NotificationJobName;
    switch (name) {
      case NOTIFICATION_JOB.CLAUDE_AUTH_SUSPECT:
        await this.handleFailure(
          this.claudeFailure(job.data as ClaudeAuthSuspectJobData),
          readOccurredAt(job),
        );
        return;
      case NOTIFICATION_JOB.CRON_FAILURE:
        await this.handleFailure(
          this.cronFailure(job.data as CronFailureJobData),
          readOccurredAt(job),
        );
        return;
      case NOTIFICATION_JOB.INCIDENT_RECOVERED:
        await this.handleRecovery(job as Job<IncidentRecoveredJobData>);
        return;
      default:
        this.logger.warn(`알 수 없는 notification job name: ${name}`);
    }
  }

  private claudeFailure(payload: ClaudeAuthSuspectJobData): FailureAlert {
    return {
      key: CLAUDE_AUTH_INCIDENT_KEY,
      label: 'claude CLI 인증 의심',
      errorMessage: payload.exitMessage,
      ownerId: this.ownerId(CLAUDE_AUTH_INCIDENT_KEY),
      kind: 'alert:claude-auth',
    };
  }

  private cronFailure(payload: CronFailureJobData): FailureAlert {
    return {
      key: payload.incidentKey ?? cronIncidentKey(payload.cronName),
      label: payload.cronName,
      errorMessage: payload.errorMessage,
      ownerId: this.ownerId(cronIncidentKey(payload.cronName)),
      kind: 'alert:cron-failure',
    };
  }

  private ownerId(key: string): string {
    const envKey =
      key === CLAUDE_AUTH_INCIDENT_KEY
        ? 'CLAUDE_AUTH_ALERT_OWNER_SLACK_USER_ID'
        : 'CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID';
    return this.configService.get<string>(envKey)?.trim() ?? '';
  }

  // occurredAt 은 실패가 신고된 시각(job 생성 시각)이다. 처리 시각을 쓰면 큐에서 기다린 시간만큼
  // 실패가 늦게 난 것처럼 기록돼, 그 사이 들어온 성공 신호가 낡은 것으로 버려진다.
  private async handleFailure(
    alert: FailureAlert,
    occurredAt: Date,
  ): Promise<void> {
    if (!alert.ownerId) {
      this.logger.warn(`알람 owner 미설정 — 고장 알림 생략. key=${alert.key}`);
      return;
    }
    let incident: AlertIncident | null;
    try {
      incident = await this.prisma.alertIncident.findUnique({
        where: { key: alert.key },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `사건 원장 조회 실패 (key=${alert.key}): ${String(error)}`,
      );
      await this.sendFallback(alert);
      return;
    }
    const now = occurredAt;
    const cause = normalizeIncidentCause(alert.errorMessage);
    const decision = decideOnFailure({ incident, key: alert.key, now });
    if (decision.action === 'OPEN') {
      const text = this.openText(alert, decision.expiredPrevious);
      const sent = await this.sendOrLog(alert, text);
      if (!sent) {
        return;
      }
      try {
        await this.prisma.alertIncident.upsert({
          where: { key: alert.key },
          create: {
            key: alert.key,
            label: alert.label,
            openedAt: now,
            lastSeenAt: now,
            lastNotifiedAt: now,
            occurrences: 1,
            lastError: alert.errorMessage,
            causes: [cause],
          },
          update: {
            label: alert.label,
            openedAt: now,
            lastSeenAt: now,
            lastNotifiedAt: now,
            occurrences: 1,
            lastError: alert.errorMessage,
            causes: [cause],
            resolvedAt: null,
          },
        });
      } catch (error: unknown) {
        this.logger.warn(
          `사건 원장 시작 기록 실패 (key=${alert.key}): ${String(error)}`,
        );
      }
      return;
    }
    if (!incident) {
      return;
    }
    const causes = incident.causes.includes(cause)
      ? incident.causes
      : [...incident.causes, cause].slice(-5);
    const data = {
      // 재시도로 늦게 처리된 옛 실패가 lastSeenAt 을 되돌리지 않게 한다.
      lastSeenAt:
        incident.lastSeenAt.getTime() > now.getTime()
          ? incident.lastSeenAt
          : now,
      lastError: alert.errorMessage,
      occurrences: incident.occurrences + 1,
      causes,
    };
    let reminderSent = false;
    if (decision.action === 'REMIND') {
      const text = this.remindText(
        alert,
        decision.dayCount,
        incident.occurrences + 1,
      );
      reminderSent = await this.sendOrLog(alert, text);
      if (reminderSent) {
        Object.assign(data, { lastNotifiedAt: now });
      }
    }
    try {
      await this.prisma.alertIncident.update({
        where: { key: alert.key },
        data,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `사건 원장 실패 기록 실패 (key=${alert.key}): ${String(error)}`,
      );
      if (!reminderSent) {
        await this.sendFallback(alert);
      }
    }
  }

  private async handleRecovery(
    job: Job<IncidentRecoveredJobData>,
  ): Promise<void> {
    const key = job.data.incidentKey;
    let incident: AlertIncident | null;
    try {
      incident = await this.prisma.alertIncident.findUnique({ where: { key } });
    } catch (error: unknown) {
      // 삼키면 job 이 성공 처리돼 재시도가 없고, 성공이 드문 claude 같은 사건은 오래 열린 채 남는다.
      this.logger.warn(
        `사건 원장 해결 조회 실패 — 재시도 (key=${key}): ${String(error)}`,
      );
      throw error;
    }
    if (!incident || incident.resolvedAt) {
      return;
    }
    // 이 성공보다 나중에 실패가 있었다면 낡은 신호다. 버리고 다음 성공 신호를 기다린다 —
    // 지연 재등록된 job 이 계속 실패 중인 사건을 옛 성공으로 닫지 않게 하는 장치다.
    const succeededAt = job.data.succeededAt ?? job.timestamp ?? Date.now();
    if (incident.lastSeenAt.getTime() >= succeededAt) {
      this.logger.debug(`낡은 해결 신호 무시 (key=${key})`);
      return;
    }
    const now = new Date();
    const elapsed = now.getTime() - incident.lastSeenAt.getTime();
    if (elapsed < INCIDENT_QUIET_MS) {
      // 성공마다 자기 지연 확인을 갖고, 먼저 조건을 채운 것이 닫는다(나머지는 이미 닫힌 사건을 보고
      // 끝난다). 중복 제거를 걸지 않는 이유는 publishDelayedRecovery 주석 참조.
      try {
        await this.notificationPublisher.publishDelayedRecovery(
          job.data,
          INCIDENT_QUIET_MS - elapsed,
        );
      } catch (error: unknown) {
        this.logger.warn(
          `사건 해결 지연 등록 실패 (key=${key}): ${String(error)}`,
        );
        throw error;
      }
      return;
    }
    // 해결은 DM 으로 보내지 않는다 — 다음 아침 브리핑이 `resolvedAt` 을 읽어 "✅ 해결" 한 줄로
    // 싣는다(평일 6통 목표, 2026-10-22 사용자 결정). 고친 뒤에 오는 알림은 할 일이 아니라서
    // 따로 울릴 이유가 없다. 원장에는 전문을 남겨 콘솔에서 볼 수 있게 한다. 기록 실패가 해결을
    // 막으면 사건이 열린 채로 남아 아침마다 "장애" 로 뜨므로, 실패는 로그만 남기고 닫는다.
    const ownerId = this.ownerId(key);
    if (!ownerId) {
      this.logger.warn(
        `해결 기록 owner 미설정 — 사건을 조용히 닫습니다. key=${key}`,
      );
    } else {
      const kind: DeliveryKind =
        key === CLAUDE_AUTH_INCIDENT_KEY
          ? 'alert:claude-auth'
          : 'alert:cron-failure';
      try {
        await this.slackService.recordSuppressedDelivery({
          kind,
          target: ownerId,
          text: this.resolveText(incident, now),
          reason: SLACK_DELIVERY_SUPPRESS_REASON.CONSOLE_ROUTE,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `해결 원장 기록 실패 — 사건은 닫는다 (key=${key}): ${String(error)}`,
        );
      }
    }
    try {
      await this.prisma.alertIncident.update({
        where: { key },
        data: { resolvedAt: now },
      });
    } catch (error: unknown) {
      this.logger.warn(
        `사건 원장 해결 기록 실패 (key=${key}): ${String(error)}`,
      );
    }
  }

  private openText(alert: FailureAlert, expiredPrevious: boolean): string {
    const lines = [
      `⚠️ *고장 발생* — ${alert.label}`,
      `오류: ${alert.errorMessage.slice(0, 1500)}`,
      '_같은 고장이 이어지는 동안은 하루 1번만 다시 알립니다. 정상으로 돌면 다음 아침 브리핑에 해결로 적습니다._',
    ];
    if (expiredPrevious) {
      lines.push(
        '_이전 사건은 24시간 동안 재발이 없어 닫았습니다(해결 확인은 아님)._',
      );
    }
    if (alert.key === CLAUDE_AUTH_INCIDENT_KEY) {
      lines.push(
        '_조치: `claude` 를 대화형으로 한 번 실행해 재인증하거나 쿼터 reset window 를 확인하세요._',
      );
    }
    return lines.join('\n');
  }

  private remindText(
    alert: FailureAlert,
    dayCount: number,
    occurrences: number,
  ): string {
    return `🔁 *아직 고장 중* — ${alert.label} · ${dayCount}일째, ${occurrences}회 발생\n오류: ${alert.errorMessage.slice(0, 1500)}`;
  }

  private resolveText(incident: AlertIncident, now: Date): string {
    const duration = formatIncidentDuration(
      now.getTime() - incident.openedAt.getTime(),
    );
    return `✅ *해결* — ${incident.label} · ${duration} 지속, ${incident.occurrences}회 발생\n원인: ${incident.causes.join(' / ')}`;
  }

  private async sendFallback(alert: FailureAlert): Promise<void> {
    const lastFiredAtMs = this.lastFiredAtByKey.get(alert.key) ?? null;
    const nowMs = Date.now();
    if (!shouldFireAlert({ lastFiredAtMs, nowMs })) {
      return;
    }
    const text = `${this.openText(alert, false)}\n${DATABASE_FALLBACK_MARKER}`;
    const sent = await this.sendOrLog(alert, text);
    if (sent) {
      this.lastFiredAtByKey.set(alert.key, nowMs);
    }
  }

  private async sendOrLog(alert: FailureAlert, text: string): Promise<boolean> {
    try {
      await this.slackService.postMessage({
        kind: alert.kind,
        target: alert.ownerId,
        text,
      });
      this.logger.log(`알람 전송 — ${alert.key} → owner=${alert.ownerId}`);
      return true;
    } catch (error: unknown) {
      this.logger.error(
        `알람 전송 실패 (${alert.key}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
