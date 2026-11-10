import { Inject, Injectable, Logger } from '@nestjs/common';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { formatKstDateTime } from '../../common/util/kst-date.util';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../slack/domain/port/slack-notifier.port';
import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import {
  buildExtraFortunePrompt,
  expectedSectionCount,
} from '../domain/saju-extra-fortune.prompt';
import {
  formatExtraFortuneHeader,
  FortuneMessageKind,
} from '../domain/saju-fortune-chat';
import {
  MAXIMUM_FORTUNE_LENGTH,
  SAJU_FORTUNE_CRON_QUEUE,
  SajuFortuneRecipient,
  SENT_GUARD_TTL_SECONDS,
} from '../domain/saju-fortune-cron.type';
import {
  composeExtraBody,
  EXTRA_SECTION_SEPARATOR,
  splitExtraSections,
} from '../domain/saju-fortune-render';
import { renderSpecialDayLine, specialDaysOf } from '../domain/special-day';
import {
  DailyScores,
  isMondayKst,
  renderWeeklyStarLine,
} from '../domain/weekly-fortune';
import {
  FortuneGenerator,
  FortuneInspection,
  inspectBody,
} from './fortune-generator';
import { specialDayContextOf } from './special-day-calendar';
import { weeklyScoresOf } from './weekly-scores';

export interface DeliverExtraFortuneInput {
  recipient: SajuFortuneRecipient;
  todayKst: string;
  todayPillar: string;
}

// 추가 메시지는 구간 수가 어긋나는 것도 위반이다(코드가 고칠 수 없는 쪽).
const inspectExtra = ({
  text,
  expected,
}: {
  text: string;
  expected: number;
}): FortuneInspection => {
  if (text.trim().length === 0) {
    throw new Error('추가 운세 응답이 비어 있음');
  }
  const { kinds, unremovable } = inspectBody(text);
  const sectionsMatch = splitExtraSections({ text, expected }) !== null;
  if (sectionsMatch) {
    const inspection: FortuneInspection = { kinds, unremovable };
    return inspection;
  }
  const mismatched: FortuneInspection = {
    kinds: [...kinds, 'sections'],
    unremovable: unremovable + 1,
  };
  return mismatched;
};

const withoutSeparators = (text: string): string => {
  const lines = text
    .split('\n')
    .filter((line) => line.trim() !== EXTRA_SECTION_SEPARATOR);
  const joined = lines.join('\n');
  return joined;
};

// 월요일에만 이번 주 7일 별점을 계산한다.
const weekOf = ({
  recipient,
  todayKst,
}: {
  recipient: SajuFortuneRecipient;
  todayKst: string;
}): DailyScores[] | undefined => {
  if (!isMondayKst(todayKst)) {
    return undefined;
  }
  const week = weeklyScoresOf({
    natalPillars: recipient.natalPillars,
    mondayKst: todayKst,
  });
  return week;
};

// 한 사람의 월요일 주간·특별한 날 특집 — 일일 뒤 한 통. 보낼 것이 없는 날(대부분)은 LLM·키 없이 끝난다.
// 키·발송·release 규칙은 일일과 같고 키만 따로다. 계산·생성 예외는 호출부가 그 사람의 추가 실패로만 센다.
@Injectable()
export class DeliverExtraFortuneUsecase {
  private readonly logger = new Logger(DeliverExtraFortuneUsecase.name);

  constructor(
    private readonly generator: FortuneGenerator,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
  ) {}

  async deliver({
    recipient,
    todayKst,
    todayPillar,
  }: DeliverExtraFortuneInput): Promise<void> {
    const context = specialDayContextOf(todayKst);
    const specialDays = specialDaysOf({
      todayKst,
      birthday: recipient.birthday,
      context,
    });
    const week = weekOf({ recipient, todayKst });
    if (specialDays.length === 0 && !week) {
      return;
    }
    const guardKey = `cron:${SAJU_FORTUNE_CRON_QUEUE}:extra:${recipient.slackUserId}:${todayKst}`;
    if (await this.cronIdempotency.isDone(guardKey)) {
      return;
    }

    const expected = expectedSectionCount({ specialDays, week });
    const text = await this.generator.generateWithRetry({
      prompt: buildExtraFortunePrompt({
        recipient,
        todayKst,
        todayPillar,
        nowKst: formatKstDateTime(new Date()).slice(-'HH:MM'.length),
        specialDays,
        context,
        week,
      }),
      parse: (completion) => completion,
      inspect: (completion) => inspectExtra({ text: completion, expected }),
      slackUserId: recipient.slackUserId,
    });
    // 두 번 다 구간 수가 어긋나면 구분줄을 지우고 한 덩어리로 쓴다(코드 줄은 모두 맨 앞).
    const sections = splitExtraSections({ text, expected }) ?? [
      withoutSeparators(text),
    ];
    const body = composeExtraBody({
      sections,
      specialLines: specialDays.map((day) =>
        renderSpecialDayLine({ day, name: recipient.name }),
      ),
      weeklyStarLine: week ? renderWeeklyStarLine(week) : undefined,
      maximum: MAXIMUM_FORTUNE_LENGTH,
    });
    const header = formatExtraFortuneHeader({
      kind: week ? FortuneMessageKind.WEEKLY : FortuneMessageKind.SPECIAL,
      todayKst,
      todayPillar,
    });
    const message = `${header}\n\n${escapeSlackMrkdwn(body)}`;

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
        target: recipient.slackUserId,
        text: message,
      });
    } catch (error) {
      await this.cronIdempotency.release(guardKey);
      throw error;
    }
    this.logger.log(
      `Saju Fortune 추가 메시지 발송 완료 — ${recipient.slackUserId}`,
    );
  }
}
