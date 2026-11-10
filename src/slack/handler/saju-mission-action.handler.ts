import { Inject, Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import {
  addDaysTo,
  utcMidnightOf,
  weekdayOf,
} from '../../common/util/kst-date.util';
import {
  MissionResult,
  SAJU_FORTUNE_DAY_REPOSITORY_PORT,
  SajuFortuneDayRepositoryPort,
} from '../../saju-fortune-cron/domain/port/saju-fortune-day.repository.port';
import { SajuCardCollageRenderer } from '../../saju-fortune-cron/infrastructure/saju-card-collage.renderer';
import {
  buildMissionCheckBlocks,
  missionCheckFallbackText,
  MissionCheckView,
  SAJU_CARD_COLLECTION_ACTION,
  SAJU_MISSION_DONE_ACTION,
  SAJU_MISSION_NOT_DONE_ACTION,
} from '../../saju-fortune-cron/infrastructure/saju-mission-check.formatter';
import {
  extractActionMessageRef,
  extractActionUserId,
  extractActionValue,
} from '../bolt/action-body.parser';
import { SlackHandler } from '../domain/port/slack-handler.port';

const ANSWER_ACTIONS: ReadonlyArray<readonly [string, MissionResult]> = [
  [SAJU_MISSION_DONE_ACTION, MissionResult.DONE],
  [SAJU_MISSION_NOT_DONE_ACTION, MissionResult.NOT_DONE],
];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface ActionTarget {
  slackUserId: string;
  fortuneDate: string;
  channel: string;
  ts: string;
}

type Respond = (message: Record<string, unknown>) => Promise<unknown>;

// 버튼 값은 우리가 보낸 날짜지만 오래된 메시지·형식 변경을 대비해 실제 달력 날짜인지 본다.
const isCalendarDate = (value: string): boolean => {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const date = utcMidnightOf(value);
  const valid =
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  return valid;
};

// 그 날짜가 속한 주의 월요일.
const mondayOf = (date: string): string => {
  const daysSinceMonday = (weekdayOf(date) + 6) % 7;
  const monday = addDaysTo(date, -daysSinceMonday);
  return monday;
};

const targetOf = (body: unknown): ActionTarget | null => {
  const slackUserId = extractActionUserId(body);
  const fortuneDate = extractActionValue(body) ?? '';
  const messageRef = extractActionMessageRef(body);
  if (!slackUserId || !messageRef || !isCalendarDate(fortuneDate)) {
    return null;
  }
  const target: ActionTarget = { slackUserId, fortuneDate, ...messageRef };
  return target;
};

const ephemeral = (respond: Respond, text: string): Promise<unknown> =>
  respond({ response_type: 'ephemeral', replace_original: false, text });

// 저녁 미션 확인 메시지의 「했어」·「못 했어」·「N월 카드 모음」 버튼.
// 행은 (누른 사람, 버튼 날짜) 로만 찾는다 — 1:1 DM 이고 키에 누른 사람이 들어가 남의 기록은 건드릴 수 없다.
// Slack 업로드·갱신은 SlackService 가 아니라 Bolt 의 client 로 한다 — SlackService 는 모든 핸들러를 주입받아 순환이 된다.
@Injectable()
export class SajuMissionActionHandler implements SlackHandler {
  private readonly logger = new Logger(SajuMissionActionHandler.name);
  // 메시지별 "저장 → 조회 → 갱신" 줄. 두 클릭이 겹쳐도 마지막 화면이 마지막 저장값과 같게 한다.
  // ponytail: 프로세스 안 직렬화라 앱을 여러 개 띄우면 다시 겹칠 수 있다 — 그때는 메시지 단위 버전 검사로.
  private readonly answerChains = new Map<string, Promise<void>>();

  constructor(
    @Inject(SAJU_FORTUNE_DAY_REPOSITORY_PORT)
    private readonly fortuneDays: SajuFortuneDayRepositoryPort,
    private readonly cardCollage: SajuCardCollageRenderer,
  ) {}

  register(app: App): void {
    for (const [actionId, result] of ANSWER_ACTIONS) {
      app.action(actionId, async ({ ack, body, respond, client }) => {
        await ack();
        const target = targetOf(body);
        if (!target) {
          this.logger.warn(`사주 미션 버튼 해석 실패 (${actionId})`);
          await ephemeral(respond, '이 버튼은 더는 쓸 수 없어');
          return;
        }
        await this.serializeByMessage(target.ts, () =>
          this.answer({ target, result, respond, client }),
        );
      });
    }
    app.action(
      SAJU_CARD_COLLECTION_ACTION,
      async ({ ack, body, respond, client }) => {
        await ack();
        const target = targetOf(body);
        if (!target) {
          this.logger.warn('사주 카드 모음 버튼 해석 실패');
          await ephemeral(respond, '이 버튼은 더는 쓸 수 없어');
          return;
        }
        await this.postCollection({ target, respond, client });
      },
    );
  }

  private async answer({
    target,
    result,
    respond,
    client,
  }: {
    target: ActionTarget;
    result: MissionResult;
    respond: Respond;
    client: App['client'];
  }): Promise<void> {
    const { slackUserId, fortuneDate } = target;
    try {
      const answered = await this.fortuneDays.answerMission({
        slackUserId,
        fortuneDate,
        result,
      });
      if (!answered) {
        await ephemeral(respond, '이 날 미션을 찾지 못했어');
        return;
      }
    } catch (error) {
      this.logger.warn(
        `사주 미션 답 저장 실패 (${slackUserId} ${fortuneDate}): ${messageOf(error)}`,
      );
      await ephemeral(respond, '저장하지 못했어, 다시 눌러 줘');
      return;
    }
    // 저장은 끝났다. 다시 그리기가 실패해도 답은 남아 있다 — 다시 누르면 화면이 맞춰진다.
    try {
      await this.redraw({ target, client });
    } catch (error) {
      this.logger.warn(
        `사주 미션 메시지 갱신 실패 (저장은 완료) — ${slackUserId} ${fortuneDate}: ${messageOf(error)}`,
      );
    }
  }

  // 누른 버튼이 아니라 저장된 답으로 그린다.
  private async redraw({
    target,
    client,
  }: {
    target: ActionTarget;
    client: App['client'];
  }): Promise<void> {
    const { slackUserId, fortuneDate, channel, ts } = target;
    const day = await this.fortuneDays.findMissionDay({
      slackUserId,
      fortuneDate,
    });
    if (!day) {
      return;
    }
    const view: MissionCheckView = {
      fortuneDate,
      missionText: day.missionText,
      result: day.missionResult,
      weekDone: await this.fortuneDays.countWeekDone({
        slackUserId,
        monday: mondayOf(fortuneDate),
      }),
    };
    await client.chat.update({
      channel,
      ts,
      text: missionCheckFallbackText(view),
      blocks: buildMissionCheckBlocks(view) as never,
    });
  }

  // 그달 받은 카드를 한 장으로 모아 그 확인 메시지의 스레드에 올린다. 누를 때마다 새로 만든다.
  private async postCollection({
    target,
    respond,
    client,
  }: {
    target: ActionTarget;
    respond: Respond;
    client: App['client'];
  }): Promise<void> {
    const { slackUserId, fortuneDate, channel, ts } = target;
    const month = fortuneDate.slice(0, 7);
    await ephemeral(respond, '모으는 중이야…');
    try {
      const cards = await this.fortuneDays.findMonthCards({
        slackUserId,
        month,
      });
      if (cards.length === 0) {
        await ephemeral(respond, '아직 모은 카드가 없어');
        return;
      }
      const collage = await this.cardCollage.renderMonth(cards);
      await client.filesUploadV2({
        channel_id: channel,
        thread_ts: ts,
        file: collage,
        filename: `saju-cards-${month}.png`,
        title: `🃏 ${Number(month.slice(5))}월 카드 모음 ${cards.length}장`,
      });
    } catch (error) {
      this.logger.warn(
        `사주 카드 모음 실패 (${slackUserId} ${month}): ${messageOf(error)}`,
      );
      await ephemeral(respond, '지금은 못 만들었어, 잠시 뒤 다시 눌러 줘');
    }
  }

  private serializeByMessage(
    messageTs: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const previous = this.answerChains.get(messageTs) ?? Promise.resolve();
    const current = previous.then(task);
    // 앞 차례가 실패해도 뒤 차례는 돌아야 한다 — 줄에는 실패를 삼킨 꼬리만 남긴다.
    const tail = current.catch(() => undefined);
    this.answerChains.set(messageTs, tail);
    void tail.then(() => {
      if (this.answerChains.get(messageTs) === tail) {
        this.answerChains.delete(messageTs);
      }
    });
    return current;
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
