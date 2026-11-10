import { Inject, Injectable, Logger } from '@nestjs/common';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../slack/domain/port/slack-notifier.port';
import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import {
  CARD_COLLAGE_PORT,
  CardCollagePort,
} from '../domain/port/card-collage.port';
import {
  FORTUNE_CARD_IMAGE_PORT,
  FortuneCardImagePort,
} from '../domain/port/fortune-card-image.port';
import {
  RecentMission,
  SAJU_FORTUNE_DAY_REPOSITORY_PORT,
  SajuFortuneDayRepositoryPort,
  SentCard,
} from '../domain/port/saju-fortune-day.repository.port';
import { analyzeSajuDay, YearMonthPillars } from '../domain/saju-analysis';
import { buildSajuFortunePrompt } from '../domain/saju-fortune.prompt';
import {
  buildFortuneCardImagePrompt,
  FortuneCard,
  ParsedFortune,
  parseFortuneResponse,
} from '../domain/saju-fortune-card';
import { formatFortuneHeader } from '../domain/saju-fortune-chat';
import {
  MAXIMUM_FORTUNE_LENGTH,
  SAJU_FORTUNE_CRON_QUEUE,
  SajuFortuneRecipient,
  SENT_GUARD_TTL_SECONDS,
} from '../domain/saju-fortune-cron.type';
import { recentMissionPeriodOf } from '../domain/saju-fortune-period';
import {
  ComposedFortune,
  composeFortuneBody,
} from '../domain/saju-fortune-render';
import { Mission, pickMission } from '../domain/saju-mission';
import { FortuneGenerator, inspectBody } from './fortune-generator';

export interface DeliverDailyFortuneInput {
  recipient: SajuFortuneRecipient;
  todayKst: string;
  todayPillar: string;
  yearMonthPillars: YearMonthPillars;
}

// sent: 이번에 보냄 · already: 시작할 때 이미 보낸 상태 · raced: 다른 실행이 지금 키를 잡고 보내는 중.
// raced 면 추가 메시지를 건너뛴다 — 보내는 쪽 실행이 자기 2패스에서 추가를 보낸다(순서 역전 방지).
export enum DailyDeliveryResult {
  SENT = 'sent',
  ALREADY = 'already',
  RACED = 'raced',
}

interface UploadedCard {
  fileId: string;
  altText: string;
}

// 업로드한 카드와 그 PNG — 썸네일을 같은 그림으로 만들려고 함께 들고 다닌다(다시 그리지 않는다).
interface PreparedCard extends UploadedCard {
  title: string;
  png: Buffer;
}

interface PostFortuneInput {
  recipient: SajuFortuneRecipient;
  text: string;
  card: UploadedCard | undefined;
}

interface PostOrReleaseInput extends PostFortuneInput {
  guardKey: string;
}

// 그림이 실제로 붙어 나갔는지 — 첨부 실패로 글만 다시 보냈으면 false.
interface PostedFortune {
  withCard: boolean;
}

interface RecordSentInput {
  recipient: SajuFortuneRecipient;
  todayKst: string;
  mission: Mission;
  composed: ComposedFortune;
  // 그림이 실제로 붙어 나간 날만 있다.
  sentCard: PreparedCard | undefined;
}

// 길이 자르기는 그린 줄 몫을 뺀 예산으로 composeFortuneBody 가 줄 단위로 한다.
const parseDailyFortune = (text: string): ParsedFortune => {
  const parsed = parseFortuneResponse(text);
  if (parsed.body.length === 0) {
    throw new Error('운세 응답이 비어 있음');
  }
  return parsed;
};

// 한 사람의 아침 사주 운세 — 미션 고르기 → 글 생성 → 카드 → 조립 → 발송 → 하루 기록.
@Injectable()
export class DeliverDailyFortuneUsecase {
  private readonly logger = new Logger(DeliverDailyFortuneUsecase.name);

  constructor(
    private readonly generator: FortuneGenerator,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    @Inject(FORTUNE_CARD_IMAGE_PORT)
    private readonly cardImage: FortuneCardImagePort,
    @Inject(SAJU_FORTUNE_DAY_REPOSITORY_PORT)
    private readonly fortuneDays: SajuFortuneDayRepositoryPort,
    @Inject(CARD_COLLAGE_PORT)
    private readonly cardCollage: CardCollagePort,
  ) {}

  // 사람별 하루 1회 가드. 가드는 LLM 응답을 받은 뒤 발송 직전에 잡는다 — 먼저 잡으면 LLM 호출 중
  // 프로세스가 강제 종료될 때 키만 남아 그날 DM 이 빠진다(isDone 주석 참조). 발송이 실패하면
  // 가드를 풀어 BullMQ 재시도가 다시 보내게 하고, 이미 보낸 사람은 isDone 에서 LLM 호출 전에 걸러진다.
  async deliver(input: DeliverDailyFortuneInput): Promise<DailyDeliveryResult> {
    const { recipient, todayKst, todayPillar, yearMonthPillars } = input;
    const guardKey = `cron:${SAJU_FORTUNE_CRON_QUEUE}:${recipient.slackUserId}:${todayKst}`;
    if (await this.cronIdempotency.isDone(guardKey)) {
      this.logger.warn(
        `Saju Fortune 중복 발송 차단 — ${recipient.slackUserId} ${todayKst} 이미 발송됨`,
      );
      return DailyDeliveryResult.ALREADY;
    }

    // 별점·행운 아이템·미션은 프롬프트와 같은 입력으로 계산해 코드가 그린다(같은 입력 → 같은 값).
    const analysis = analyzeSajuDay({
      natalPillars: recipient.natalPillars,
      todayPillar,
      yearMonthPillars,
    });
    const mission = pickMission({
      analysis,
      recent: await this.findRecentMissions({ recipient, todayKst }),
      fortuneDate: todayKst,
    });
    const fortune = await this.generateFortune(input);
    // 업로드는 채널에 공유되지 않는 파일만 만든다 — 발송이 아니라서 가드 앞에 둔다.
    const card = await this.prepareCard({ recipient, card: fortune.card });

    // 조립은 가드 앞에서 한다 — 키를 잡은 뒤 조립이 던지면 키만 남아 그날 일일이 빠진다.
    const composed = composeFortuneBody({
      body: fortune.body,
      analysis,
      mission,
      maximum: MAXIMUM_FORTUNE_LENGTH,
    });
    const text = `${formatFortuneHeader({ todayKst, todayPillar })}\n\n${escapeSlackMrkdwn(composed.body)}`;

    // stalled 재처리로 같은 사람이 동시에 두 번 처리되면 뒤쪽은 여기서 막힌다.
    const firstRun = await this.cronIdempotency.acquireOnce(
      guardKey,
      SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      return DailyDeliveryResult.RACED;
    }
    const { withCard } = await this.postOrRelease({
      guardKey,
      recipient,
      text,
      card,
    });
    this.logger.log(`Saju Fortune 발송 완료 — ${recipient.slackUserId}`);
    // 기록은 발송이 끝난 뒤, 키를 푸는 경로 밖에서 — 기록 실패가 키를 풀면 같은 운세가 두 번 나간다.
    await this.recordSentSafely({
      recipient,
      todayKst,
      mission,
      composed,
      sentCard: withCard ? card : undefined,
    });
    return DailyDeliveryResult.SENT;
  }

  // 본문과 카드는 같은 응답의 것을 함께 쓴다. 별·행운 숫자는 조립 함수가 마지막에 걷어 낸다.
  private async generateFortune(
    input: DeliverDailyFortuneInput,
  ): Promise<ParsedFortune> {
    const fortune = await this.generator.generateWithRetry({
      prompt: buildSajuFortunePrompt(input),
      parse: parseDailyFortune,
      inspect: ({ body }) => inspectBody(body),
      slackUserId: input.recipient.slackUserId,
    });
    return fortune;
  }

  // 발송이 실패하면 가드를 풀어 BullMQ 재시도가 다시 보내게 한다.
  private async postOrRelease({
    guardKey,
    recipient,
    text,
    card,
  }: PostOrReleaseInput): Promise<PostedFortune> {
    try {
      return await this.postFortune({ recipient, text, card });
    } catch (error) {
      await this.cronIdempotency.release(guardKey);
      throw error;
    }
  }

  // 그림이 붙은 메시지가 실패하면 글만 한 번 더 보낸다 — 그림 블록 문제로 재시도까지 계속
  // 실패하면 그날 운세가 아예 안 간다. 글만 보내도 실패하면 예외(호출부가 가드를 풀어 재시도).
  private async postFortune({
    recipient,
    text,
    card,
  }: PostFortuneInput): Promise<PostedFortune> {
    const message = {
      kind: 'saju-fortune' as const,
      target: recipient.slackUserId,
      text,
    };
    if (!card) {
      await this.slackNotifier.postMessage(message);
      return { withCard: false };
    }
    try {
      await this.slackNotifier.postMessage({
        ...message,
        image: { fileId: card.fileId, altText: card.altText },
      });
      return { withCard: true };
    } catch (error) {
      this.logger.warn(
        `Saju Fortune 카드 첨부 발송 실패 — 글만 다시 보냄 (${recipient.slackUserId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.slackNotifier.postMessage(message);
      return { withCard: false };
    }
  }

  // 최근 미션은 반복을 피하는 데만 쓴다 — 조회가 실패하면 반복 회피만 포기하고 보낸다.
  private async findRecentMissions({
    recipient,
    todayKst,
  }: {
    recipient: SajuFortuneRecipient;
    todayKst: string;
  }): Promise<RecentMission[]> {
    try {
      return await this.fortuneDays.findMissionKeys({
        slackUserId: recipient.slackUserId,
        period: recentMissionPeriodOf({ today: todayKst }),
      });
    } catch (error) {
      this.logger.warn(
        `Saju Fortune 최근 미션 조회 실패 — 반복 회피 없이 고름 (${recipient.slackUserId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // 기록은 덤이다 — 저녁 확인·카드 모음이 그날을 놓칠 뿐 발송에는 영향이 없다.
  private async recordSentSafely({
    recipient,
    todayKst,
    mission,
    composed,
    sentCard,
  }: RecordSentInput): Promise<void> {
    try {
      await this.fortuneDays.recordSent({
        slackUserId: recipient.slackUserId,
        fortuneDate: todayKst,
        missionKey: mission.key,
        missionText: mission.text,
        aiBody: composed.aiBody,
        card: await this.cardRecordOf({ recipient, sentCard }),
      });
    } catch (error) {
      this.logger.warn(
        `Saju Fortune 하루 기록 실패 — 저녁 확인·카드 모음에서 빠짐 (${recipient.slackUserId}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 썸네일을 못 만들면 카드 없이 남긴다 — 제목만 남기면 모음 장수 기준이 둘이 된다.
  private async cardRecordOf({
    recipient,
    sentCard,
  }: {
    recipient: SajuFortuneRecipient;
    sentCard: PreparedCard | undefined;
  }): Promise<SentCard | undefined> {
    if (!sentCard) {
      return undefined;
    }
    try {
      const thumbnail = await this.cardCollage.toThumbnail(sentCard.png);
      const cardRecord: SentCard = { title: sentCard.title, thumbnail };
      return cardRecord;
    } catch (error) {
      this.logger.warn(
        `Saju Fortune 카드 썸네일 실패 — 카드 없이 기록 (${recipient.slackUserId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  // 카드 그림은 덤이다 — 생성·업로드가 실패하면 경고만 남기고 글만 보낸다.
  private async prepareCard({
    recipient,
    card,
  }: {
    recipient: SajuFortuneRecipient;
    card?: FortuneCard;
  }): Promise<PreparedCard | undefined> {
    if (!card) {
      return undefined;
    }
    try {
      const png = await this.cardImage.generate(
        buildFortuneCardImagePrompt(card),
      );
      const altText = `오늘의 운세 카드 — ${card.title}`;
      const { fileId } = await this.slackNotifier.uploadImageFile({
        png,
        filename: 'fortune-card.png',
        title: altText,
      });
      const prepared: PreparedCard = {
        fileId,
        altText,
        title: card.title,
        png,
      };
      return prepared;
    } catch (error) {
      this.logger.warn(
        `Saju Fortune 카드 그림 실패 — 글만 발송 (${recipient.slackUserId}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}
