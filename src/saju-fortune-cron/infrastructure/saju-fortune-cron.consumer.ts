import { Processor } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { ObservedWorkerHost } from '../../common/queue/observed-worker-host';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { cronIncidentKey } from '../../notification/domain/notification.type';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../slack/domain/port/slack-notifier.port';
import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { dayPillarOf, pillarToHangul } from '../domain/day-pillar';
import { buildSajuFortunePrompt } from '../domain/saju-fortune.prompt';
import {
  parseSajuFortuneRecipients,
  SAJU_FORTUNE_CRON_QUEUE,
  SajuFortuneCronJobData,
  SajuFortuneRecipient,
} from '../domain/saju-fortune-cron.type';

// 발송 idempotency TTL — 25h. 다음 날 같은 시각 발사 전 만료되도록 하루보다 약간 길게.
const SENT_GUARD_TTL_SECONDS = 90_000;
// 6줄 지시를 어긴 장문이 DM 을 덮지 않게 자른다.
const MAXIMUM_FORTUNE_LENGTH = 1_200;
const INCIDENT_KEY = cronIncidentKey('Saju Fortune Cron');
// CJK 통합 한자. 받는 사람이 읽지 못한 「己土는 오늘 癸水를…」 같은 응답을 거른다.
const HANJA_PATTERN = /[\u4E00-\u9FFF]/;

interface DeliverFortuneInput {
  recipient: SajuFortuneRecipient;
  todayKst: string;
  todayPillar: string;
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
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<SajuFortuneCronJobData>): Promise<void> {
    const { recipientSlackUserIds } = job.data;
    // "오늘"은 한 번만 계산해 일진·헤더·발송 가드가 같은 날짜를 쓰게 한다.
    const todayKst = getTodayKstDate();
    const todayPillar = dayPillarOf(todayKst);
    // 이 잡이 맡은 시각의 사람만 보낸다. 사주는 env 에서 매 회차 다시 읽는다.
    const recipients = parseSajuFortuneRecipients(
      this.configService.get<string>('SAJU_FORTUNE_RECIPIENTS'),
    ).recipients.filter((recipient) =>
      recipientSlackUserIds.includes(recipient.slackUserId),
    );

    const failedNames: string[] = [];
    for (const recipient of recipients) {
      try {
        await this.deliverOnce({ recipient, todayKst, todayPillar });
      } catch (error) {
        this.logger.error(
          `Saju Fortune 발송 실패 (${recipient.slackUserId})`,
          error,
        );
        failedNames.push(recipient.name);
      }
    }

    if (failedNames.length > 0) {
      const error = new Error(
        `사주 운세 발송 실패 ${failedNames.length}/${recipients.length}명: ${failedNames.join(', ')}`,
      );
      this.notifyFailure(error);
      throw error;
    }
    this.notificationPublisher?.publishRecovery(INCIDENT_KEY);
  }

  // 사람별 하루 1회 가드. 가드는 LLM 응답을 받은 뒤 발송 직전에 잡는다 — 먼저 잡으면 LLM 호출 중
  // 프로세스가 강제 종료될 때 키만 남아 그날 DM 이 빠진다(isDone 주석 참조). 발송이 실패하면
  // 가드를 풀어 BullMQ 재시도가 다시 보내게 하고, 이미 보낸 사람은 isDone 에서 LLM 호출 전에 걸러진다.
  private async deliverOnce({
    recipient,
    todayKst,
    todayPillar,
  }: DeliverFortuneInput): Promise<void> {
    const guardKey = `cron:${SAJU_FORTUNE_CRON_QUEUE}:${recipient.slackUserId}:${todayKst}`;
    if (await this.cronIdempotency.isDone(guardKey)) {
      this.logger.warn(
        `Saju Fortune 중복 발송 차단 — ${recipient.slackUserId} ${todayKst} 이미 발송됨`,
      );
      return;
    }

    const fortune = await this.generateFortune({
      recipient,
      todayKst,
      todayPillar,
    });

    // stalled 재처리로 같은 사람이 동시에 두 번 처리되면 뒤쪽은 여기서 막힌다.
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
        text: `🔮 *오늘의 운세 — ${todayKst} (${pillarToHangul(todayPillar)}일)*\n\n${escapeSlackMrkdwn(fortune)}`,
      });
    } catch (error) {
      await this.cronIdempotency.release(guardKey);
      throw error;
    }
    this.logger.log(`Saju Fortune 발송 완료 — ${recipient.slackUserId}`);
  }

  // 한자 금지는 프롬프트 지시라 코드가 다시 본다. 섞였으면 한 번만 다시 만들고, 그래도 섞이면
  // 경고만 남기고 그대로 보낸다 — 그날 운세가 아예 안 가는 것보다 한자 몇 자가 낫다.
  private async generateFortune(input: DeliverFortuneInput): Promise<string> {
    const first = await this.requestFortune(input);
    if (!HANJA_PATTERN.test(first)) {
      return first;
    }
    const second = await this.requestFortune(input);
    if (HANJA_PATTERN.test(second)) {
      this.logger.warn(
        `Saju Fortune 한자 섞인 응답 — 재생성 후에도 남아 그대로 발송 (${input.recipient.slackUserId})`,
      );
    }
    return second;
  }

  private async requestFortune(input: DeliverFortuneInput): Promise<string> {
    const completion = await this.modelRouter.route({
      agentType: AgentType.PM,
      request: { prompt: buildSajuFortunePrompt(input) },
      noContractPreamble: true,
    });
    const fortune = completion.text.trim().slice(0, MAXIMUM_FORTUNE_LENGTH);
    if (fortune.length === 0) {
      throw new Error('운세 응답이 비어 있음');
    }
    return fortune;
  }

  // fire-and-forget — NotificationQueue 의 사건 단위 Slack DM. 수신자는 payload 가 아니라
  // CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID 로 정해진다(notification.consumer ownerId) — 받는 사람에겐 안 간다.
  // ownerSlackUserId 는 CronFailureJobData 의 필수 칸이지만 읽는 곳이 없어 비워 둔다.
  private notifyFailure(error: Error): void {
    if (!this.notificationPublisher) {
      return;
    }
    this.notificationPublisher.publishCronFailure({
      cronName: 'Saju Fortune Cron',
      incidentKey: INCIDENT_KEY,
      ownerSlackUserId: '',
      errorMessage: error.message,
    });
  }
}
