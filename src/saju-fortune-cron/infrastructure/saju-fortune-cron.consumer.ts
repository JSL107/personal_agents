import { Processor } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { match } from 'ts-pattern';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { readNonEmptyConfig } from '../../common/queue/missed-repeatable-run';
import { ObservedWorkerHost } from '../../common/queue/observed-worker-host';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import {
  formatKstDateTime,
  getKstDateOf,
  getTodayKstDate,
} from '../../common/util/kst-date.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { cronIncidentKey } from '../../notification/domain/notification.type';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../slack/domain/port/slack-notifier.port';
import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { specialDayContextOf } from '../application/special-day-calendar';
import { weeklyScoresOf } from '../application/weekly-scores';
import { yearMonthPillarsOf } from '../application/year-month-pillar';
import { dayPillarOf } from '../domain/day-pillar';
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
} from '../domain/port/saju-fortune-day.repository.port';
import { analyzeSajuDay, YearMonthPillars } from '../domain/saju-analysis';
import {
  buildExtraFortunePrompt,
  expectedSectionCount,
} from '../domain/saju-extra-fortune.prompt';
import { buildSajuFortunePrompt } from '../domain/saju-fortune.prompt';
import {
  buildFortuneCardImagePrompt,
  FortuneCard,
  ParsedFortune,
  parseFortuneResponse,
} from '../domain/saju-fortune-card';
import {
  formatExtraFortuneHeader,
  formatFortuneHeader,
  FortuneMessageKind,
} from '../domain/saju-fortune-chat';
import {
  DEFAULT_SAJU_MISSION_CHECK_CRON,
  MISSION_CHECK_DISABLED,
  MISSION_CHECK_WINDOW_MS,
  parseSajuFortuneRecipients,
  SAJU_FORTUNE_CRON_QUEUE,
  SajuFortuneCronJobData,
  SajuFortuneJobName,
  SajuFortuneRecipient,
  SajuMissionCheckJobData,
} from '../domain/saju-fortune-cron.type';
import { recentMissionPeriodOf } from '../domain/saju-fortune-period';
import {
  ComposedFortune,
  composeExtraBody,
  composeFortuneBody,
  countUnremovableViolations,
  EXTRA_SECTION_SEPARATOR,
  findFortuneViolations,
  splitExtraSections,
} from '../domain/saju-fortune-render';
import { Mission, pickMission } from '../domain/saju-mission';
import {
  isMissionCheckDue,
  MissionCheckView,
} from '../domain/saju-mission-check';
import { renderSpecialDayLine, specialDaysOf } from '../domain/special-day';
import { isMondayKst, renderWeeklyStarLine } from '../domain/weekly-fortune';
import {
  buildMissionCheckBlocks,
  missionCheckFallbackText,
} from './saju-mission-check.formatter';

// 발송 idempotency TTL — 25h. 다음 날 같은 시각 발사 전 만료되도록 하루보다 약간 길게.
const SENT_GUARD_TTL_SECONDS = 90_000;
// 12줄 지시를 어긴 장문이 DM 을 덮지 않게 자른다. 카드 두 줄을 떼고 별점·아이템 줄을 붙인 본문 기준.
const MAXIMUM_FORTUNE_LENGTH = 1_500;
const DAILY_CRON_NAME = 'Saju Fortune Cron';
const INCIDENT_KEY = cronIncidentKey(DAILY_CRON_NAME);
// 저녁 미션 확인은 사건을 따로 연다 — 저녁 성공이 아침 실패 사건을 "복구"로 닫지 않게.
const MISSION_CHECK_CRON_NAME = 'Saju Mission Check';
const MISSION_CHECK_INCIDENT_KEY = cronIncidentKey(MISSION_CHECK_CRON_NAME);

interface DeliverFortuneInput {
  recipient: SajuFortuneRecipient;
  todayKst: string;
  todayPillar: string;
  yearMonthPillars: YearMonthPillars;
}

// sent: 이번에 보냄 · already: 시작할 때 이미 보낸 상태 · raced: 다른 실행이 지금 키를 잡고 보내는 중.
// raced 면 추가 메시지를 건너뛴다 — 보내는 쪽 실행이 자기 2패스에서 추가를 보낸다(순서 역전 방지).
enum DailyDeliveryResult {
  SENT = 'sent',
  ALREADY = 'already',
  RACED = 'raced',
}

// 응답 하나의 위반 — 종류 목록과 코드가 못 지우는 위반 수.
interface FortuneInspection {
  kinds: string[];
  unremovable: number;
}

interface GuardedRequest<T> {
  prompt: string;
  parse: (text: string) => T;
  inspect: (result: T) => FortuneInspection;
  slackUserId: string;
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

interface RecordSentInput {
  recipient: SajuFortuneRecipient;
  todayKst: string;
  mission: Mission;
  composed: ComposedFortune;
  // 그림이 실제로 붙어 나간 날만 있다.
  sentCard: PreparedCard | undefined;
}

// 매일 사주 운세 DM — 받는 사람마다 LLM 1회 + DM 1회. 한 사람이 실패해도 나머지는 보낸다.
// LLM 은 provider 선택만을 위해 PM 을 빌린다(fact-answer 와 같은 방식) — 새 AgentType 을 만들면
// 슬래시·재실행·응답코드 체크리스트가 따라오는데 이 기능은 원장(agent_run)에 남길 일이 아니다.
@Processor(SAJU_FORTUNE_CRON_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class SajuFortuneCronConsumer extends ObservedWorkerHost {
  private readonly logger = new Logger(SajuFortuneCronConsumer.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    @Inject(FORTUNE_CARD_IMAGE_PORT)
    private readonly cardImage: FortuneCardImagePort,
    @Inject(SAJU_FORTUNE_DAY_REPOSITORY_PORT)
    private readonly fortuneDays: SajuFortuneDayRepositoryPort,
    @Inject(CARD_COLLAGE_PORT)
    private readonly cardCollage: CardCollagePort,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  // 같은 큐의 두 반복 잡 — 아침 운세와 저녁 미션 확인. 잡 이름은 문자열이라 모르는 이름은 경고만 남긴다.
  async process(
    job: Job<SajuFortuneCronJobData | SajuMissionCheckJobData>,
  ): Promise<void> {
    await match(job.name)
      .with(SajuFortuneJobName.DAILY, () =>
        this.processDaily(job.data as SajuFortuneCronJobData),
      )
      .with(SajuFortuneJobName.MISSION_CHECK, () =>
        this.checkMissions(job.opts.prevMillis),
      )
      .otherwise((name) => {
        this.logger.warn(`Saju Fortune 알 수 없는 잡 이름 — 건너뜀: ${name}`);
        return Promise.resolve();
      });
  }

  private async processDaily({
    recipientSlackUserIds,
  }: SajuFortuneCronJobData): Promise<void> {
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
        const result = await this.deliverOnce({
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
        await this.deliverExtraOnce({ recipient, todayKst, todayPillar });
      } catch (error) {
        this.logger.error(
          `Saju Fortune 추가 메시지 실패 (${recipient.slackUserId})`,
          error,
        );
        failedExtras.push(recipient.name);
      }
    }

    if (failedNames.length > 0 || failedExtras.length > 0) {
      const error = new Error(
        failureMessageOf({
          failedNames,
          failedExtras,
          total: recipients.length,
        }),
      );
      this.notifyFailure({
        cronName: DAILY_CRON_NAME,
        incidentKey: INCIDENT_KEY,
        error,
      });
      throw error;
    }
    this.notificationPublisher?.publishRecovery(INCIDENT_KEY);
  }

  // 저녁 미션 확인. 날짜는 실행 시각이 아니라 예정 시각으로 정한다 — 자정을 넘겨 도는 보충 잡도
  // 전날을 본다(autopilot.consumer 와 같은 방식). 예정보다 너무 늦게 돌면 그날은 건너뛴다.
  private async checkMissions(prevMillis: number | undefined): Promise<void> {
    // 끄기는 여기서 본다 — 부팅 보충·대기 중·수동 투입 잡이 모두 이 길을 지난다. 스케줄러만 보면
    // 켜진 채 등록된 회차를 off 로 다시 켠 부팅의 보충 잡이 그대로 보낸다.
    const cron = readNonEmptyConfig({
      configService: this.configService,
      key: 'SAJU_MISSION_CHECK_CRON',
      fallback: DEFAULT_SAJU_MISSION_CHECK_CRON,
    });
    if (cron === MISSION_CHECK_DISABLED) {
      this.logger.log('Saju Mission Check 꺼짐 — 잡을 건너뜀');
      return;
    }
    const nowMs = Date.now();
    const scheduledMs = prevMillis ?? nowMs;
    if (nowMs - scheduledMs > MISSION_CHECK_WINDOW_MS) {
      this.logger.log(
        `Saju Mission Check 발송 창을 지나 건너뜀 — 예정 ${new Date(scheduledMs).toISOString()}`,
      );
      return;
    }
    const fortuneDate = getKstDateOf(new Date(scheduledMs));
    const { recipients } = parseSajuFortuneRecipients(
      this.configService.get<string>('SAJU_FORTUNE_RECIPIENTS'),
    );
    const failedNames: string[] = [];
    for (const recipient of recipients) {
      try {
        await this.checkMissionOnce({ recipient, fortuneDate, nowMs });
      } catch (error) {
        this.logger.error(
          `Saju Mission Check 실패 (${recipient.slackUserId})`,
          error,
        );
        failedNames.push(recipient.name);
      }
    }
    if (failedNames.length > 0) {
      const error = new Error(
        `사주 미션 확인 실패 ${failedNames.length}/${recipients.length}명: ${failedNames.join(', ')}`,
      );
      this.notifyFailure({
        cronName: MISSION_CHECK_CRON_NAME,
        incidentKey: MISSION_CHECK_INCIDENT_KEY,
        error,
      });
      throw error;
    }
    this.notificationPublisher?.publishRecovery(MISSION_CHECK_INCIDENT_KEY);
  }

  // 그날 운세가 나갔고(행 있음), 아직 답하지 않았고, 아침에서 충분히 지난 사람에게만 묻는다.
  // 키·발송·release 규칙은 일일과 같다.
  private async checkMissionOnce({
    recipient,
    fortuneDate,
    nowMs,
  }: {
    recipient: SajuFortuneRecipient;
    fortuneDate: string;
    nowMs: number;
  }): Promise<void> {
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

  // 사람별 하루 1회 가드. 가드는 LLM 응답을 받은 뒤 발송 직전에 잡는다 — 먼저 잡으면 LLM 호출 중
  // 프로세스가 강제 종료될 때 키만 남아 그날 DM 이 빠진다(isDone 주석 참조). 발송이 실패하면
  // 가드를 풀어 BullMQ 재시도가 다시 보내게 하고, 이미 보낸 사람은 isDone 에서 LLM 호출 전에 걸러진다.
  private async deliverOnce({
    recipient,
    todayKst,
    todayPillar,
    yearMonthPillars,
  }: DeliverFortuneInput): Promise<DailyDeliveryResult> {
    const guardKey = `cron:${SAJU_FORTUNE_CRON_QUEUE}:${recipient.slackUserId}:${todayKst}`;
    if (await this.cronIdempotency.isDone(guardKey)) {
      this.logger.warn(
        `Saju Fortune 중복 발송 차단 — ${recipient.slackUserId} ${todayKst} 이미 발송됨`,
      );
      return DailyDeliveryResult.ALREADY;
    }

    // 별점·행운 아이템·미션은 프롬프트와 같은 입력으로 계산해 코드가 그린다(같은 입력 → 같은 값).
    const analysis = analyzeSajuDay(
      recipient.natalPillars,
      todayPillar,
      yearMonthPillars,
    );
    const mission = pickMission({
      analysis,
      recent: await this.findRecentMissions({ recipient, todayKst }),
      fortuneDate: todayKst,
    });
    const fortune = await this.generateFortune({
      recipient,
      todayKst,
      todayPillar,
      yearMonthPillars,
    });
    // 업로드는 채널에 공유되지 않는 파일만 만든다 — 발송이 아니라서 가드 앞에 둔다.
    const card = fortune.card
      ? await this.prepareCard(recipient, fortune.card)
      : undefined;

    // 조립은 가드 앞에서 한다 — 키를 잡은 뒤 조립이 던지면 키만 남아 그날 일일이 빠진다.
    const composed = composeFortuneBody({
      body: fortune.body,
      analysis,
      mission,
      maximum: MAXIMUM_FORTUNE_LENGTH,
    });
    const text = `${formatFortuneHeader(todayKst, todayPillar)}\n\n${escapeSlackMrkdwn(composed.body)}`;

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

  // 발송이 실패하면 가드를 풀어 BullMQ 재시도가 다시 보내게 한다.
  private async postOrRelease({
    guardKey,
    recipient,
    text,
    card,
  }: {
    guardKey: string;
    recipient: SajuFortuneRecipient;
    text: string;
    card: UploadedCard | undefined;
  }): Promise<{ withCard: boolean }> {
    try {
      return await this.postFortune({ recipient, text, card });
    } catch (error) {
      await this.cronIdempotency.release(guardKey);
      throw error;
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
        `Saju Fortune 최근 미션 조회 실패 — 반복 회피 없이 고름 (${recipient.slackUserId}): ${messageOf(error)}`,
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
        `Saju Fortune 하루 기록 실패 — 저녁 확인·카드 모음에서 빠짐 (${recipient.slackUserId}): ${messageOf(error)}`,
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
  }): Promise<{ title: string; thumbnail: Buffer } | undefined> {
    if (!sentCard) {
      return undefined;
    }
    try {
      const thumbnail = await this.cardCollage.toThumbnail(sentCard.png);
      const cardRecord = { title: sentCard.title, thumbnail };
      return cardRecord;
    } catch (error) {
      this.logger.warn(
        `Saju Fortune 카드 썸네일 실패 — 카드 없이 기록 (${recipient.slackUserId}): ${messageOf(error)}`,
      );
      return undefined;
    }
  }

  // 월요일 주간·특별한 날 특집 — 일일 뒤 한 통. 보낼 것이 없는 날(대부분)은 LLM·키 없이 끝난다.
  // 키·발송·release 규칙은 일일과 같고 키만 따로다. 계산·생성 예외는 호출부가 그 사람의 추가 실패로만 센다.
  private async deliverExtraOnce({
    recipient,
    todayKst,
    todayPillar,
  }: {
    recipient: SajuFortuneRecipient;
    todayKst: string;
    todayPillar: string;
  }): Promise<void> {
    const context = specialDayContextOf(todayKst);
    const specialDays = specialDaysOf({
      todayKst,
      birthday: recipient.birthday,
      context,
    });
    const week = isMondayKst(todayKst)
      ? weeklyScoresOf({
          natalPillars: recipient.natalPillars,
          mondayKst: todayKst,
        })
      : undefined;
    if (specialDays.length === 0 && !week) {
      return;
    }
    const guardKey = `cron:${SAJU_FORTUNE_CRON_QUEUE}:extra:${recipient.slackUserId}:${todayKst}`;
    if (await this.cronIdempotency.isDone(guardKey)) {
      return;
    }

    const expected = expectedSectionCount({ specialDays, week });
    const text = await this.generateWithRetry({
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

  // 그림이 붙은 메시지가 실패하면 글만 한 번 더 보낸다 — 그림 블록 문제로 재시도까지 계속
  // 실패하면 그날 운세가 아예 안 간다. 글만 보내도 실패하면 예외(호출부가 가드를 풀어 재시도).
  private async postFortune({
    recipient,
    text,
    card,
  }: {
    recipient: SajuFortuneRecipient;
    text: string;
    card: UploadedCard | undefined;
  }): Promise<{ withCard: boolean }> {
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
        `Saju Fortune 카드 첨부 발송 실패 — 글만 다시 보냄 (${recipient.slackUserId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.slackNotifier.postMessage(message);
      return { withCard: false };
    }
  }

  // 한자·명리 용어·AI 가 쓴 별·행운 숫자는 프롬프트 지시라 코드가 다시 본다. 걸리면 한 번만 다시 만들고,
  // 둘 다 걸리면 코드가 못 지우는 위반(한자·용어)이 적은 쪽(같으면 두 번째)을 보낸다 — 그날 운세가 아예 안 가는 것보다 낫다.
  // 별·행운 숫자는 조립 함수가 마지막에 걷어 낸다. 본문과 카드는 같은 응답의 것을 함께 쓴다.
  private generateFortune(input: DeliverFortuneInput): Promise<ParsedFortune> {
    return this.generateWithRetry({
      prompt: buildSajuFortunePrompt(input),
      parse: parseDailyFortune,
      inspect: ({ body }) => inspectBody(body),
      slackUserId: input.recipient.slackUserId,
    });
  }

  private async generateWithRetry<T>({
    prompt,
    parse,
    inspect,
    slackUserId,
  }: GuardedRequest<T>): Promise<T> {
    const first = parse(await this.complete(prompt));
    const firstInspection = inspect(first);
    if (firstInspection.kinds.length === 0) {
      return first;
    }
    const second = parse(await this.complete(prompt));
    const secondInspection = inspect(second);
    const prefersSecond =
      secondInspection.unremovable <= firstInspection.unremovable;
    const [chosen, remaining] = prefersSecond
      ? [second, secondInspection]
      : [first, firstInspection];
    if (remaining.kinds.length > 0) {
      this.logger.warn(
        `Saju Fortune 위반 응답(${remaining.kinds.join(',')}) — 재생성 후에도 남아 그대로 발송 (${slackUserId})`,
      );
    }
    return chosen;
  }

  private async complete(prompt: string): Promise<string> {
    const completion = await this.modelRouter.route({
      agentType: AgentType.PM,
      request: { prompt },
      noContractPreamble: true,
    });
    return completion.text;
  }

  // 카드 그림은 덤이다 — 생성·업로드가 실패하면 경고만 남기고 글만 보낸다.
  private async prepareCard(
    recipient: SajuFortuneRecipient,
    card: FortuneCard,
  ): Promise<PreparedCard | undefined> {
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
        `Saju Fortune 카드 그림 실패 — 글만 발송 (${recipient.slackUserId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
  }

  // fire-and-forget — NotificationQueue 의 사건 단위 Slack DM. 수신자는 payload 가 아니라
  // CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID 로 정해진다(notification.consumer ownerId) — 받는 사람에겐 안 간다.
  // ownerSlackUserId 는 CronFailureJobData 의 필수 칸이지만 읽는 곳이 없어 비워 둔다.
  private notifyFailure({
    cronName,
    incidentKey,
    error,
  }: {
    cronName: string;
    incidentKey: string;
    error: Error;
  }): void {
    if (!this.notificationPublisher) {
      return;
    }
    this.notificationPublisher.publishCronFailure({
      cronName,
      incidentKey,
      ownerSlackUserId: '',
      errorMessage: error.message,
    });
  }
}

// 길이 자르기는 그린 줄 몫을 뺀 예산으로 composeFortuneBody 가 줄 단위로 한다.
const parseDailyFortune = (text: string): ParsedFortune => {
  const parsed = parseFortuneResponse(text);
  if (parsed.body.length === 0) {
    throw new Error('운세 응답이 비어 있음');
  }
  return parsed;
};

const inspectBody = (body: string): FortuneInspection => {
  const kinds = findFortuneViolations(body);
  const inspection: FortuneInspection = {
    kinds,
    unremovable: countUnremovableViolations(kinds),
  };
  return inspection;
};

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
  const inspection: FortuneInspection = sectionsMatch
    ? { kinds, unremovable }
    : { kinds: [...kinds, 'sections'], unremovable: unremovable + 1 };
  return inspection;
};

const withoutSeparators = (text: string): string => {
  const lines = text
    .split('\n')
    .filter((line) => line.trim() !== EXTRA_SECTION_SEPARATOR);
  return lines.join('\n');
};

// 일일 실패 문구는 그대로 두고(재시도·알림이 읽는다) 추가 실패가 있으면 뒤에 붙인다.
// 같은 사람이 일일·추가 둘 다면 일일만 센다 — 일일이 실패한 사람은 추가를 시도하지 않는다.
const failureMessageOf = ({
  failedNames,
  failedExtras,
  total,
}: {
  failedNames: string[];
  failedExtras: string[];
  total: number;
}): string => {
  const dailyPart =
    failedNames.length > 0
      ? `사주 운세 발송 실패 ${failedNames.length}/${total}명: ${failedNames.join(', ')}`
      : '사주 운세';
  const extraPart =
    failedExtras.length > 0 ? ` / 추가 실패: ${failedExtras.join(', ')}` : '';
  return `${dailyPart}${extraPart}`;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
