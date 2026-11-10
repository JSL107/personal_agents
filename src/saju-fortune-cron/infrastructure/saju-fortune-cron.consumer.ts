import { Processor } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { match } from 'ts-pattern';

import { ObservedWorkerHost } from '../../common/queue/observed-worker-host';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { cronIncidentKey } from '../../notification/domain/notification.type';
import { CheckMissionsUsecase } from '../application/check-missions.usecase';
import { SendDailyFortunesUsecase } from '../application/send-daily-fortunes.usecase';
import {
  SAJU_FORTUNE_CRON_QUEUE,
  SajuFortuneCronJobData,
  SajuFortuneJobName,
  SajuMissionCheckJobData,
} from '../domain/saju-fortune-cron.type';

// 잡마다 실패 알림을 따로 연다 — 저녁 성공이 아침 실패 사건을 "복구"로 닫지 않게.
interface CronIncident {
  cronName: string;
  incidentKey: string;
}

const DAILY_INCIDENT: CronIncident = {
  cronName: 'Saju Fortune Cron',
  incidentKey: cronIncidentKey('Saju Fortune Cron'),
};
const MISSION_CHECK_INCIDENT: CronIncident = {
  cronName: 'Saju Mission Check',
  incidentKey: cronIncidentKey('Saju Mission Check'),
};

interface RunOutcome {
  incident: CronIncident;
  // 있으면 실패 — 알림을 보내고 잡을 실패시켜 BullMQ 가 재시도한다.
  failureMessage: string | undefined;
}

// 사주 운세 큐 소비자 — 잡 이름으로 아침 운세와 저녁 미션 확인을 나눠 유스케이스에 넘기고,
// 결과로 실패 알림·복구 알림만 한다. 발송 흐름은 application 유스케이스에 있다.
@Processor(SAJU_FORTUNE_CRON_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class SajuFortuneCronConsumer extends ObservedWorkerHost {
  private readonly logger = new Logger(SajuFortuneCronConsumer.name);

  constructor(
    private readonly sendDailyFortunes: SendDailyFortunesUsecase,
    private readonly checkMissions: CheckMissionsUsecase,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  // 같은 큐의 두 반복 잡. 잡 이름은 문자열이라 모르는 이름은 경고만 남긴다.
  async process(
    job: Job<SajuFortuneCronJobData | SajuMissionCheckJobData>,
  ): Promise<void> {
    const outcome = await match(job.name)
      .with(SajuFortuneJobName.DAILY, () => this.runDaily(job))
      .with(SajuFortuneJobName.MISSION_CHECK, () => this.runMissionCheck(job))
      .otherwise(async (name): Promise<RunOutcome | undefined> => {
        this.logger.warn(`Saju Fortune 알 수 없는 잡 이름 — 건너뜀: ${name}`);
        return undefined;
      });
    if (!outcome) {
      return;
    }
    this.report(outcome);
  }

  private async runDaily(
    job: Job<SajuFortuneCronJobData | SajuMissionCheckJobData>,
  ): Promise<RunOutcome> {
    const failureMessage = await this.sendDailyFortunes.execute(
      job.data as SajuFortuneCronJobData,
    );
    const outcome: RunOutcome = { incident: DAILY_INCIDENT, failureMessage };
    return outcome;
  }

  private async runMissionCheck(
    job: Job<SajuFortuneCronJobData | SajuMissionCheckJobData>,
  ): Promise<RunOutcome> {
    const failureMessage = await this.checkMissions.execute({
      scheduledMs: job.opts.prevMillis,
    });
    const outcome: RunOutcome = {
      incident: MISSION_CHECK_INCIDENT,
      failureMessage,
    };
    return outcome;
  }

  // 실패면 알리고 던져 BullMQ 가 재시도하게 한다(이미 보낸 사람은 유스케이스가 중복 방지 키로 건너뛴다).
  private report({ incident, failureMessage }: RunOutcome): void {
    if (!failureMessage) {
      this.notificationPublisher?.publishRecovery(incident.incidentKey);
      return;
    }
    // fire-and-forget — NotificationQueue 의 사건 단위 Slack DM. 수신자는 payload 가 아니라
    // CRON_FAILURE_ALERT_OWNER_SLACK_USER_ID 로 정해진다(notification.consumer ownerId) — 받는 사람에겐 안 간다.
    // ownerSlackUserId 는 CronFailureJobData 의 필수 칸이지만 읽는 곳이 없어 비워 둔다.
    this.notificationPublisher?.publishCronFailure({
      cronName: incident.cronName,
      incidentKey: incident.incidentKey,
      ownerSlackUserId: '',
      errorMessage: failureMessage,
    });
    throw new Error(failureMessage);
  }
}
