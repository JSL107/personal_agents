import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import { GenerateImpactReportUsecase } from '../../agent/impact-reporter/application/generate-impact-report.usecase';
import { ImpactReporterException } from '../../agent/impact-reporter/domain/impact-reporter.exception';
import { ImpactReporterErrorCode } from '../../agent/impact-reporter/domain/impact-reporter-error-code.enum';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import {
  CRON_FAILURE_ALERT_PORT,
  CronFailureAlertPort,
} from '../../notification/domain/port/cron-failure-alert.port';
import { formatImpactReport } from '../../slack/format/impact-report.formatter';
import { formatModelFooter } from '../../slack/format/model-footer.formatter';
import {
  IMPACT_REPORT_CRON_QUEUE,
  ImpactReportCronJobData,
} from '../domain/impact-report-cron.type';

// 주 1회 자동 /impact-report --recent <N>d 종합 consumer.
// Daily Eval consumer 패턴 답습 — usecase 직접 호출 + Slack postMessage.
// usecase 의 RECENT_MODE_ENV_MISSING / NO_RESULTS 는 graceful skip + Slack 안내.
// 기타 예상 외 에러는 throw 해서 BullMQ 재시도 (attempts=2).
@Processor(IMPACT_REPORT_CRON_QUEUE)
export class ImpactReportCronConsumer extends WorkerHost {
  private readonly logger = new Logger(ImpactReportCronConsumer.name);

  constructor(
    private readonly generateImpactReportUsecase: GenerateImpactReportUsecase,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    @Optional()
    @Inject(CRON_FAILURE_ALERT_PORT)
    private readonly cronFailureAlerter?: CronFailureAlertPort,
  ) {
    super();
  }

  async process(job: Job<ImpactReportCronJobData>): Promise<void> {
    const { ownerSlackUserId, target, days } = job.data;
    this.logger.log(
      `Impact Report Cron 시작 — owner=${ownerSlackUserId} → target=${target}, days=${days}`,
    );

    const todayKst = getTodayKstDate();

    try {
      const outcome = await this.generateImpactReportUsecase.execute({
        subject: `--recent ${days}d`,
        slackUserId: ownerSlackUserId,
        triggerType: TriggerType.IMPACT_REPORT_RECENT_CRON,
      });
      const intro = `📊 *Impact Report — ${todayKst} (최근 ${days}일 자동 종합)*\n\n`;
      const text =
        intro + formatImpactReport(outcome.result) + formatModelFooter(outcome);
      await this.slackNotifier.postMessage({ target, text });
      this.logger.log(
        `Impact Report Cron 발송 완료 — target=${target}, agentRunId=${outcome.agentRunId}`,
      );
    } catch (error) {
      if (error instanceof ImpactReporterException) {
        if (
          error.impactReporterErrorCode ===
          ImpactReporterErrorCode.RECENT_MODE_NO_RESULTS
        ) {
          this.logger.warn(
            `Impact Report Cron skip — 최근 ${days}일 머지 PR 0건 (owner=${ownerSlackUserId})`,
          );
          await this.slackNotifier.postMessage({
            target,
            text: `🪶 *Impact Report — ${todayKst} skip*\n_최근 ${days}일 머지 PR 0건. 다음 주에 다시 시도합니다._`,
          });
          return;
        }
        if (
          error.impactReporterErrorCode ===
          ImpactReporterErrorCode.RECENT_MODE_ENV_MISSING
        ) {
          this.logger.error(
            `Impact Report Cron 비활성 상태 발화 — env 누락 (owner=${ownerSlackUserId}): ${error.message}`,
          );
          await this.slackNotifier.postMessage({
            target,
            text: `⚠️ *Impact Report — ${todayKst} skip*\n_env 누락 (\`IMPACT_REPORT_GITHUB_AUTHOR\`) — cron 활성 상태에서 recent mode 사용 위해 봇 .env 확인 필요._`,
          });
          return;
        }
      }
      this.logger.error(
        `Impact Report Cron 실패 — 예상 외 에러 (owner=${ownerSlackUserId})`,
        error,
      );
      this.notifyOwnerFailure(ownerSlackUserId, error);
      throw error;
    }
  }

  // fire-and-forget — 알람 자체 실패가 BullMQ 재시도 흐름을 막지 않게.
  private notifyOwnerFailure(ownerSlackUserId: string, error: unknown): void {
    if (!this.cronFailureAlerter) {
      return;
    }
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    void this.cronFailureAlerter
      .notifyCronFailure({
        cronName: 'Impact Report Cron',
        ownerSlackUserId,
        errorMessage,
      })
      .catch((alertError: unknown) => {
        this.logger.warn(
          `Impact Report Cron 실패 알람 발사 실패: ${alertError instanceof Error ? alertError.message : String(alertError)}`,
        );
      });
  }
}
