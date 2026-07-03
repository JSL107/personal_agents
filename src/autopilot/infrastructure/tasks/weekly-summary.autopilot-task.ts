import { Injectable, Logger } from '@nestjs/common';

import { GenerateCeoMetaUsecase } from '../../../agent/ceo/application/generate-ceo-meta.usecase';
import { CeoException } from '../../../agent/ceo/domain/ceo.exception';
import { CeoErrorCode } from '../../../agent/ceo/domain/ceo-error-code.enum';
import { coerceToDailyPlan } from '../../../agent/pm/domain/prompt/previous-plan-formatter';
import { GenerateWorklogUsecase } from '../../../agent/work-reviewer/application/generate-worklog.usecase';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { formatCeoMetaOutput } from '../../../slack/format/ceo-meta.formatter';
import { formatDailyReview } from '../../../slack/format/daily-review.formatter';
import { FormattedReport } from '../../../slack/format/formatted-report.type';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// Weekly Summary 이관 — 매주 금요일 17:00 KST worklog(주간 7일 PM runs) + CEO meta 체인.
// 기존 src/weekly-summary/infrastructure/weekly-summary.consumer.ts 의 핵심 로직을 task 로 옮김.
// worklog / CEO meta 각각 요약은 summaryText(메인), 근거 detail 은 detailText(스레드)로 분리 반환 —
// 오케스트레이터(T0)가 메인 발송 후 detailText 를 스레드 댓글로 붙인다.
// CEO meta 실패 시(NO_PO_EVAL_RUN 등) graceful 안내문(detail 없음)으로 대체해 worklog 발송은 보장.
@Injectable()
export class WeeklySummaryAutopilotTask implements AutopilotTask {
  readonly id = 'weekly-summary';

  private readonly logger = new Logger(WeeklySummaryAutopilotTask.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly generateWorklogUsecase: GenerateWorklogUsecase,
    private readonly generateCeoMetaUsecase: GenerateCeoMetaUsecase,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const runs = await this.agentRunService.findRecentSucceededRuns({
      agentType: AgentType.PM,
      slackUserId: ownerSlackUserId,
      sinceDays: 7,
      limit: 7,
    });

    if (runs.length === 0) {
      return {
        skip: false,
        summaryText: `_📋 Weekly Summary — ${firedAtKst} skip_\n이번 주 PM AgentRun 기록이 없습니다. Weekly Summary 를 생성하지 않습니다.`,
      };
    }

    const planLines = runs
      .map((run) => {
        const plan = coerceToDailyPlan(run.output);
        if (!plan) {
          return null;
        }
        const allTasks = [plan.topPriority, ...plan.morning, ...plan.afternoon];
        const taskTitles = allTasks.map((task) => `- ${task.title}`).join('\n');
        return `[${run.endedAt.toISOString().slice(0, 10)}]\n${taskTitles}`;
      })
      .filter((line): line is string => line !== null);

    const workText = `이번 주 일일 plan 요약 (자동 생성):\n\n${planLines.join('\n\n')}`;

    const worklogOutcome = await this.generateWorklogUsecase.execute({
      workText,
      slackUserId: ownerSlackUserId,
      triggerType: TriggerType.WEEKLY_SUMMARY_CRON,
    });

    // worklog / CEO meta 각각 summary(메인) / detail(스레드 = 근거) 로 분리.
    // 메인 = worklog 요약 + CEO 요약(구분자로 이음), 스레드 = 각 detail(+model 푸터) 을 이어 1개 댓글로.
    const worklogFormatted = formatDailyReview(worklogOutcome.result);
    const worklogSummary =
      `📝 *Weekly Summary — ${firedAtKst} (금 17:00 KST 자동 주간 worklog)*\n\n` +
      worklogFormatted.summary;
    const worklogDetail =
      worklogFormatted.detail + formatModelFooter(worklogOutcome);

    const ceo = await this.buildCeoMeta(ownerSlackUserId, firedAtKst);

    const summaryText = `${worklogSummary}\n\n────────\n\n${ceo.summary}`;
    const detailParts = [worklogDetail];
    if (ceo.detail.trim().length > 0) {
      detailParts.push(ceo.detail);
    }
    const detailText = detailParts.join('\n\n────────\n\n');

    return { skip: false, summaryText, detailText };
  }

  // CEO meta (P5) 는 worklog (P4) 직후 체인. PO_EVAL run 부재 시 graceful 안내문(detail 없음)으로 대체.
  private async buildCeoMeta(
    ownerSlackUserId: string,
    firedAtKst: string,
  ): Promise<FormattedReport> {
    try {
      const ceoOutcome = await this.generateCeoMetaUsecase.execute({
        slackUserId: ownerSlackUserId,
        range: 'WEEK',
        triggerType: TriggerType.WEEKLY_CEO_META_CRON,
      });
      const ceoFormatted = formatCeoMetaOutput(ceoOutcome.result);
      return {
        summary:
          `🧭 *CEO Meta — ${firedAtKst} (주간 자동 메타 회고)*\n\n` +
          ceoFormatted.summary,
        detail: ceoFormatted.detail + formatModelFooter(ceoOutcome),
      };
    } catch (error) {
      if (
        error instanceof CeoException &&
        error.ceoErrorCode === CeoErrorCode.NO_PO_EVAL_RUN
      ) {
        this.logger.warn(
          `Weekly Summary CEO meta skip — PO_EVAL run 없음 (owner=${ownerSlackUserId}): ${(error as Error).message}`,
        );
        return {
          summary: `_🧭 CEO Meta — ${firedAtKst} skip_\n_이번 주 PO_EVAL run 부재로 메타 회고 대상 없음. \`/po-eval\` 을 먼저 실행해주세요._`,
          detail: '',
        };
      }
      this.logger.error(
        `Weekly Summary CEO meta 실패 — 예상 외 에러 (owner=${ownerSlackUserId})`,
        error,
      );
      return {
        summary: `_🧭 CEO Meta — ${firedAtKst} 실패_\n_예상 외 에러로 CEO 메타 회고를 생성하지 못했습니다. 로그를 확인해주세요._`,
        detail: '',
      };
    }
  }
}
