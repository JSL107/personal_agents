import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GenerateImpactReportUsecase } from '../../../agent/impact-reporter/application/generate-impact-report.usecase';
import { ImpactReporterException } from '../../../agent/impact-reporter/domain/impact-reporter.exception';
import { ImpactReporterErrorCode } from '../../../agent/impact-reporter/domain/impact-reporter-error-code.enum';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { formatImpactReport } from '../../../slack/format/impact-report.formatter';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// IMPACT_REPORT_RECENT_DAYS 의 유효 범위 (1~365).
const DAYS_MIN = 1;
const DAYS_MAX = 365;
const DAYS_DEFAULT = 7;

// Impact Report 이관 — 매주 토요일 09:00 KST `--recent <N>d` 본인 머지 PR 자동 종합.
// 기존 src/impact-report-cron/infrastructure/impact-report-cron.consumer.ts 의 핵심 로직을 task 로 옮김.
// days 는 IMPACT_REPORT_RECENT_DAYS env(기존 이름 유지, default 7)로 결정.
// RECENT_MODE_NO_RESULTS / RECENT_MODE_ENV_MISSING 은 graceful 안내문(skip=false).
// 발송은 오케스트레이터(T0) 가 담당 — 여기선 텍스트만 만든다.
@Injectable()
export class ImpactReportAutopilotTask implements AutopilotTask {
  readonly id = 'impact-report';

  private readonly logger = new Logger(ImpactReportAutopilotTask.name);

  constructor(
    private readonly generateImpactReportUsecase: GenerateImpactReportUsecase,
    private readonly configService: ConfigService,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const days = this.readDays();

    try {
      const outcome = await this.generateImpactReportUsecase.execute({
        subject: `--recent ${days}d`,
        slackUserId: ownerSlackUserId,
        triggerType: TriggerType.IMPACT_REPORT_RECENT_CRON,
      });
      const formatted = formatImpactReport(outcome.result);
      const text =
        `📊 *Impact Report — ${firedAtKst} (최근 ${days}일 자동 종합)*\n\n` +
        formatted.summary +
        '\n\n' +
        formatted.detail +
        formatModelFooter(outcome);
      return { skip: false, summaryText: text };
    } catch (error) {
      if (error instanceof ImpactReporterException) {
        if (
          error.impactReporterErrorCode ===
          ImpactReporterErrorCode.RECENT_MODE_NO_RESULTS
        ) {
          this.logger.warn(
            `Impact Report skip — 최근 ${days}일 머지·진행 중 PR 0건 (owner=${ownerSlackUserId})`,
          );
          return {
            skip: false,
            summaryText: `🪶 *Impact Report — ${firedAtKst} skip*\n_최근 ${days}일 머지·진행 중 PR 0건. 다음 실행에 다시 시도합니다._`,
          };
        }
        if (
          error.impactReporterErrorCode ===
          ImpactReporterErrorCode.RECENT_MODE_ENV_MISSING
        ) {
          this.logger.error(
            `Impact Report env 누락 (owner=${ownerSlackUserId}): ${error.message}`,
          );
          return {
            skip: false,
            summaryText: `⚠️ *Impact Report — ${firedAtKst} skip*\n_env 누락 (\`IMPACT_REPORT_GITHUB_AUTHOR\`) — cron 활성 상태에서 recent mode 사용 위해 봇 .env 확인 필요._`,
          };
        }
      }
      throw error;
    }
  }

  private readDays(): number {
    const raw = this.configService.get<string>('IMPACT_REPORT_RECENT_DAYS');
    if (!raw) {
      return DAYS_DEFAULT;
    }
    const parsed = Number.parseInt(raw.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < DAYS_MIN || parsed > DAYS_MAX) {
      this.logger.warn(
        `IMPACT_REPORT_RECENT_DAYS="${raw}" 비유효 — default ${DAYS_DEFAULT}일로 fallback.`,
      );
      return DAYS_DEFAULT;
    }
    return parsed;
  }
}
