import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebClient } from '@slack/web-api';

import { appendIntegrationHint } from '../../common/domain/integration-failure-hint';
import { toReadableSlackArgs } from '../../slack/format/message-blocks.builder';
import { formatScheduleRegisteredFromConsole } from '../../slack/format/schedule.formatter';
import { ScheduleItemRecord } from '../domain/schedule.type';

// schedule.module 의 useFactory 가 채우는 WebClient(토큰 미설정 시 null) 주입 토큰.
export const SCHEDULE_SLACK_WEB_CLIENT = Symbol('SCHEDULE_SLACK_WEB_CLIENT');

/**
 * 이 알림 전용 WebClient 설정.
 *
 * **기본값을 그대로 쓰면 안 된다.** `@slack/web-api` 의 기본은 `timeout: 0`(무제한) +
 * `tenRetriesInAboutThirtyMinutes`(10회, 약 30분)인데, 이 발송은 등록 **응답 경로 안**에 있다.
 * Slack 이 느리거나 429 를 주는 동안 그 기본값은 요청을 최대 30분 붙들고, 그 전에 콘솔 앱의
 * URLSession(기본 60초)이 먼저 끊는다 — 사용자는 등록이 실패한 줄 알고 다시 넣고, **이미
 * 저장된 일정이 둘이 된다.** 예외를 삼키는 것은 실패를 가릴 뿐 대기 시간을 줄이지 않는다.
 *
 * 지금 못 보낸 등록 알림은 30분 뒤에 보내도 쓸모가 없다(그때는 화면에 이미 일정이 보인다).
 * 한 번만 더 시도하고, 한도에 걸렸으면 기다리지 않고 실패로 받는다.
 */
export const SCHEDULE_SLACK_CLIENT_OPTIONS = {
  timeout: 3_000,
  retryConfig: { retries: 1 },
  rejectRateLimitedCalls: true,
} as const;

/**
 * 콘솔 캘린더에서 등록한 일정을 Slack DM 으로 알린다.
 *
 * **`SlackService`(`SLACK_NOTIFIER_PORT`)를 쓰지 않는다.** 모듈 의존이 이미
 * `SlackModule → RouterModule → ScheduleModule` 방향이라, 여기서 `SlackModule` 을 import 하면
 * 순환이 된다 — 이 레포에서 같은 순환이 NestJS InstanceLoader 를 조용히 멈춰 세운 전례가 있다
 * (`notification.type.ts` 주석). `BlogModule` 이 같은 이유로 자체 `WebClient` 어댑터를 둔다.
 *
 * **어떤 실패도 throw 하지 않는다.** 이 발송은 등록의 결과 통지이지 등록의 일부가 아니다 —
 * 토큰이 없거나 Slack 이 죽었다고 이미 저장된 일정의 응답을 실패로 만들면, 사용자는 등록이
 * 안 된 줄 알고 같은 일정을 다시 넣는다.
 */
@Injectable()
export class ScheduleSlackNotifier {
  private readonly logger = new Logger(ScheduleSlackNotifier.name);

  constructor(
    @Inject(SCHEDULE_SLACK_WEB_CLIENT)
    private readonly client: WebClient | null,
  ) {}

  async notifyRegistered(record: ScheduleItemRecord): Promise<void> {
    if (!this.client) {
      this.logger.warn(
        `SLACK_BOT_TOKEN 미설정 — 콘솔 일정 등록 알림 생략 (id=${record.id}).`,
      );
      return;
    }
    try {
      await this.client.chat.postMessage({
        channel: record.slackUserId,
        ...toReadableSlackArgs(formatScheduleRegisteredFromConsole(record)),
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      // 삼키는 경로라 로그가 유일한 단서다 — 다음에 무엇을 볼지까지 남긴다.
      this.logger.warn(
        appendIntegrationHint(
          `콘솔 일정 등록 알림 실패 (id=${record.id} target=${record.slackUserId}): ${reason}`,
          error,
        ),
      );
    }
  }
}
