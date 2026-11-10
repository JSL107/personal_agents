import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { readNonEmptyConfig } from '../../common/queue/missed-repeatable-run';
import {
  formatKstDateTime,
  getKstDateOf,
} from '../../common/util/kst-date.util';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../slack/domain/port/slack-notifier.port';
import {
  SAJU_FORTUNE_DAY_REPOSITORY_PORT,
  SajuFortuneDayRepositoryPort,
} from '../domain/port/saju-fortune-day.repository.port';
import {
  DEFAULT_SAJU_MISSION_CHECK_CRON,
  MISSION_CHECK_DISABLED,
  MISSION_CHECK_WINDOW_MS,
  parseSajuFortuneRecipients,
  SAJU_FORTUNE_CRON_QUEUE,
  SajuFortuneRecipient,
  SENT_GUARD_TTL_SECONDS,
} from '../domain/saju-fortune-cron.type';
import {
  isMissionCheckDue,
  MissionCheckView,
} from '../domain/saju-mission-check';
import {
  buildMissionCheckBlocks,
  missionCheckFallbackText,
} from './saju-mission-check.formatter';

export interface CheckMissionsInput {
  // 이 회차의 예정 시각(BullMQ job.opts.prevMillis). 없으면 지금.
  scheduledMs: number | undefined;
}

interface CheckMissionOnceInput {
  recipient: SajuFortuneRecipient;
  fortuneDate: string;
  nowMs: number;
}

// 저녁 미션 확인 — 그날 아침 운세를 받은 사람에게 미션을 했는지 버튼 DM 으로 묻는다.
// 날짜는 실행 시각이 아니라 예정 시각으로 정한다 — 자정을 넘겨 도는 보충 잡도 전날을 본다
// (autopilot.consumer 와 같은 방식). 예정보다 너무 늦게 돌면 그날은 건너뛴다.
// 한 사람이 실패해도 나머지는 보낸다. 실패가 있으면 문구를 돌려준다(알림·재시도는 호출부).
@Injectable()
export class CheckMissionsUsecase {
  private readonly logger = new Logger(CheckMissionsUsecase.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(SAJU_FORTUNE_DAY_REPOSITORY_PORT)
    private readonly fortuneDays: SajuFortuneDayRepositoryPort,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
  ) {}

  async execute({
    scheduledMs,
  }: CheckMissionsInput): Promise<string | undefined> {
    // 끄기는 여기서 본다 — 부팅 보충·대기 중·수동 투입 잡이 모두 이 길을 지난다. 스케줄러만 보면
    // 켜진 채 등록된 회차를 off 로 다시 켠 부팅의 보충 잡이 그대로 보낸다.
    const cron = readNonEmptyConfig({
      configService: this.configService,
      key: 'SAJU_MISSION_CHECK_CRON',
      fallback: DEFAULT_SAJU_MISSION_CHECK_CRON,
    });
    if (cron === MISSION_CHECK_DISABLED) {
      this.logger.log('Saju Mission Check 꺼짐 — 잡을 건너뜀');
      return undefined;
    }
    const nowMs = Date.now();
    const plannedMs = scheduledMs ?? nowMs;
    if (nowMs - plannedMs > MISSION_CHECK_WINDOW_MS) {
      this.logger.log(
        `Saju Mission Check 발송 창을 지나 건너뜀 — 예정 ${formatKstDateTime(new Date(plannedMs))} KST`,
      );
      return undefined;
    }
    const fortuneDate = getKstDateOf(new Date(plannedMs));
    const { recipients } = parseSajuFortuneRecipients(
      this.configService.get<string>('SAJU_FORTUNE_RECIPIENTS'),
    );
    const failedNames: string[] = [];
    for (const recipient of recipients) {
      try {
        await this.checkOnce({ recipient, fortuneDate, nowMs });
      } catch (error) {
        this.logger.error(
          `Saju Mission Check 실패 (${recipient.slackUserId})`,
          error,
        );
        failedNames.push(recipient.name);
      }
    }
    if (failedNames.length === 0) {
      return undefined;
    }
    const failureMessage = `사주 미션 확인 실패 ${failedNames.length}/${recipients.length}명: ${failedNames.join(', ')}`;
    return failureMessage;
  }

  // 키·발송·release 규칙은 일일과 같다.
  private async checkOnce({
    recipient,
    fortuneDate,
    nowMs,
  }: CheckMissionOnceInput): Promise<void> {
    const { slackUserId } = recipient;
    const day = await this.fortuneDays.findMissionDay({
      slackUserId,
      fortuneDate,
    });
    // 행이 없으면 그날 운세가 나가지 않은 것이다.
    if (!day || !isMissionCheckDue({ day, nowMs })) {
      return;
    }
    const guardKey = `cron:${SAJU_FORTUNE_CRON_QUEUE}:mission:${slackUserId}:${fortuneDate}`;
    if (await this.cronIdempotency.isDone(guardKey)) {
      return;
    }
    const view: MissionCheckView = {
      fortuneDate,
      missionText: day.missionText,
      weekDone: 0,
    };
    const firstRun = await this.cronIdempotency.acquireOnce(
      guardKey,
      SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      return;
    }
    try {
      await this.slackNotifier.postMessage({
        kind: 'saju-fortune',
        target: slackUserId,
        text: missionCheckFallbackText(view),
        blocks: buildMissionCheckBlocks(view),
      });
    } catch (error) {
      await this.cronIdempotency.release(guardKey);
      throw error;
    }
    this.logger.log(`Saju Mission Check 발송 완료 — ${slackUserId}`);
  }
}
