import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { getTodayKstDate } from '../../common/util/kst-date.util';
import { dayPillarOf } from '../domain/day-pillar';
import {
  parseSajuFortuneRecipients,
  SajuFortuneCronJobData,
  SajuFortuneRecipient,
} from '../domain/saju-fortune-cron.type';
import {
  DailyDeliveryResult,
  DeliverDailyFortuneUsecase,
} from './deliver-daily-fortune.usecase';
import { DeliverExtraFortuneUsecase } from './deliver-extra-fortune.usecase';
import { yearMonthPillarsOf } from './year-month-pillar';

interface FailureCounts {
  failedNames: string[];
  failedExtras: string[];
  total: number;
}

// 일일 실패 문구는 그대로 두고(재시도·알림이 읽는다) 추가 실패가 있으면 뒤에 붙인다.
// 같은 사람이 일일·추가 둘 다면 일일만 센다 — 일일이 실패한 사람은 추가를 시도하지 않는다.
const failureMessageOf = ({
  failedNames,
  failedExtras,
  total,
}: FailureCounts): string => {
  const failedList = failedNames.join(', ');
  const dailyPart =
    failedNames.length > 0
      ? `사주 운세 발송 실패 ${failedNames.length}/${total}명: ${failedList}`
      : '사주 운세';
  const extraPart =
    failedExtras.length > 0 ? ` / 추가 실패: ${failedExtras.join(', ')}` : '';
  const message = `${dailyPart}${extraPart}`;
  return message;
};

// 한 회차(같은 발송 시각)의 사주 운세 — 받는 사람마다 아침 운세, 이어서 월요일·특별한 날 추가 메시지.
// 한 사람이 실패해도 나머지는 보낸다. 실패가 있으면 문구를 돌려준다(알림·재시도는 호출부).
@Injectable()
export class SendDailyFortunesUsecase {
  private readonly logger = new Logger(SendDailyFortunesUsecase.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly deliverDaily: DeliverDailyFortuneUsecase,
    private readonly deliverExtra: DeliverExtraFortuneUsecase,
  ) {}

  async execute({
    recipientSlackUserIds,
  }: SajuFortuneCronJobData): Promise<string | undefined> {
    // "오늘"은 한 번만 계산해 일진·헤더·발송 가드가 같은 날짜를 쓰게 한다.
    const todayKst = getTodayKstDate();
    const todayPillar = dayPillarOf(todayKst);
    const yearMonthPillars = yearMonthPillarsOf(todayKst);
    // 이 잡이 맡은 시각의 사람만 보낸다. 사주는 env 에서 매 회차 다시 읽는다.
    const recipients = parseSajuFortuneRecipients(
      this.configService.get<string>('SAJU_FORTUNE_RECIPIENTS'),
    ).recipients.filter((recipient) =>
      recipientSlackUserIds.includes(recipient.slackUserId),
    );

    // 2패스 — 같은 시각 받는 사람의 일일이 다른 사람의 추가 메시지 LLM 호출 뒤로 밀리지 않게 일일을 먼저 다 보낸다.
    const failedNames: string[] = [];
    const dailyDone: SajuFortuneRecipient[] = [];
    for (const recipient of recipients) {
      try {
        const result = await this.deliverDaily.deliver({
          recipient,
          todayKst,
          todayPillar,
          yearMonthPillars,
        });
        if (result !== DailyDeliveryResult.RACED) {
          dailyDone.push(recipient);
        }
      } catch (error) {
        this.logger.error(
          `Saju Fortune 발송 실패 (${recipient.slackUserId})`,
          error,
        );
        failedNames.push(recipient.name);
      }
    }

    const failedExtras: string[] = [];
    for (const recipient of dailyDone) {
      try {
        await this.deliverExtra.deliver({ recipient, todayKst, todayPillar });
      } catch (error) {
        this.logger.error(
          `Saju Fortune 추가 메시지 실패 (${recipient.slackUserId})`,
          error,
        );
        failedExtras.push(recipient.name);
      }
    }

    if (failedNames.length === 0 && failedExtras.length === 0) {
      return undefined;
    }
    const failureMessage = failureMessageOf({
      failedNames,
      failedExtras,
      total: recipients.length,
    });
    return failureMessage;
  }
}
