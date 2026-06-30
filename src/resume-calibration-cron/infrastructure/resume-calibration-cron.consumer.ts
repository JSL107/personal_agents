import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  HERMES_RUNNER_PORT,
  HermesRunnerPort,
} from '../../agent/blog/domain/port/hermes-runner.port';
import { CalibrateResumeUsecase } from '../../agent/career-mate/application/calibrate-resume.usecase';
import { CareerMateException } from '../../agent/career-mate/domain/career-mate.exception';
import { CareerMateErrorCode } from '../../agent/career-mate/domain/career-mate-error-code.enum';
import { formatCalibrationReport } from '../../agent/career-mate/infrastructure/career-mate.formatter';
import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import { HumanizeService } from '../../humanize/application/humanize.service';
import { humanizeCalibrationReport } from '../../humanize/application/humanize-report.adapter';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import {
  RESUME_CALIBRATION_CRON_QUEUE,
  RESUME_TREND_RESEARCH_PROMPT,
  ResumeCalibrationCronJobData,
} from '../domain/resume-calibration-cron.type';

// 발송 idempotency TTL — 25h. 다음 주기 발사 전 만료되도록 하루보다 약간 길게.
const SENT_GUARD_TTL_SECONDS = 90_000;

// 주 1회 자동 이력서 보정 점검 — CeoMetaCronConsumer 패턴 그대로.
// Hermes 웹리서치로 2026 트렌드를 끌어와 CalibrateResumeUsecase 에 webTrendsNote 로 augment.
// 역량 프로필/증거 없으면 NO_EVIDENCE — graceful skip + Slack 안내.
// Hermes 실패는 throw 안 함 (웹 없이 Claude 지식만으로 graceful degrade).
//
// 중복 발송 차단: BullMQ stalled 재처리로 같은 슬롯 2회 처리 시 deliverOnce 가 skip.
@Processor(RESUME_CALIBRATION_CRON_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class ResumeCalibrationCronConsumer extends WorkerHost {
  private readonly logger = new Logger(ResumeCalibrationCronConsumer.name);

  constructor(
    private readonly calibrateResume: CalibrateResumeUsecase,
    private readonly humanizeService: HumanizeService,
    @Inject(HERMES_RUNNER_PORT)
    private readonly hermesRunner: HermesRunnerPort,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<ResumeCalibrationCronJobData>): Promise<void> {
    const { ownerSlackUserId, target } = job.data;
    const todayKst = getTodayKstDate();
    this.logger.log(
      `Resume Calibration Cron 시작 — owner=${ownerSlackUserId} → target=${target}`,
    );

    try {
      const webTrendsNote = await this.safeResearch();
      const outcome = await this.calibrateResume.execute({
        slackUserId: ownerSlackUserId,
        webTrendsNote,
      });
      // 서술 필드(verdict/진단/액션) 윤문 — best-effort. 비활성/실패 시 원본 그대로 재조립된다.
      const humanizedResult = await humanizeCalibrationReport(
        outcome.result,
        this.humanizeService,
      );
      const text =
        `🔍 *이력서 보정 점검 — ${todayKst} (주간 자동${webTrendsNote ? ' · 웹 트렌드 반영' : ''})*\n\n` +
        formatCalibrationReport(humanizedResult);
      await this.deliverOnce(target, text);
    } catch (error) {
      if (
        error instanceof CareerMateException &&
        error.careerMateErrorCode === CareerMateErrorCode.NO_EVIDENCE
      ) {
        this.logger.warn(
          `Resume Calibration Cron skip — 역량 프로필/증거 없음 (owner=${ownerSlackUserId})`,
        );
        await this.deliverOnce(
          target,
          `🌙 *이력서 보정 점검 — ${todayKst} skip*\n_역량 프로필이 없어 점검을 건너뜁니다. "@이대리 프로필 정리해줘" 먼저 실행해주세요._`,
        );
        return;
      }
      this.logger.error(
        `Resume Calibration Cron 실패 (owner=${ownerSlackUserId})`,
        error,
      );
      this.notifyOwnerFailure(ownerSlackUserId, error);
      throw error;
    }
  }

  // Hermes 웹리서치 — 실패해도 throw 안 함(웹 없이 Claude 지식만으로 graceful degrade).
  private async safeResearch(): Promise<string | undefined> {
    try {
      const result = await this.hermesRunner.run(RESUME_TREND_RESEARCH_PROMPT);
      const note = result.stdout.trim();
      return note.length > 0 ? note : undefined;
    } catch (error) {
      this.logger.warn(
        `Hermes 이력서 트렌드 리서치 실패 — 웹 없이 진행: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  // 발송 idempotency 가드 — stalled 재처리로 같은 날 두 번째 처리가 오면 발송 skip.
  private async deliverOnce(target: string, text: string): Promise<void> {
    const dateKey = getTodayKstDate();
    const firstRun = await this.cronIdempotency.acquireOnce(
      `cron:${RESUME_CALIBRATION_CRON_QUEUE}:${dateKey}`,
      SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(
        `Resume Calibration Cron 중복 발송 차단 — ${dateKey} 이미 발송됨`,
      );
      return;
    }
    await this.slackNotifier.postMessage({ target, text });
    this.logger.log(`Resume Calibration Cron 발송 완료 — target=${target}`);
  }

  // fire-and-forget — NotificationQueue 로 enqueue. consumer 측 30분 dedupe + Slack DM.
  private notifyOwnerFailure(ownerSlackUserId: string, error: unknown): void {
    if (!this.notificationPublisher) {
      return;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.notificationPublisher.publishCronFailure({
      cronName: 'Resume Calibration Cron',
      ownerSlackUserId,
      errorMessage,
    });
  }
}
