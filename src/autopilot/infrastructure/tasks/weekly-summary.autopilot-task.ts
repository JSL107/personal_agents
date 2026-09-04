import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { GenerateCeoMetaUsecase } from '../../../agent/ceo/application/generate-ceo-meta.usecase';
import { CeoException } from '../../../agent/ceo/domain/ceo.exception';
import { CeoErrorCode } from '../../../agent/ceo/domain/ceo-error-code.enum';
import { coerceToDailyPlan } from '../../../agent/pm/domain/prompt/previous-plan-formatter';
import { GenerateWorklogUsecase } from '../../../agent/work-reviewer/application/generate-worklog.usecase';
import {
  buildWorklogInput,
  formatPlanLines,
} from '../../../agent/work-reviewer/domain/prompt/worklog-input.formatter';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { GithubPullRequestSummary } from '../../../github/domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import {
  humanizeDailyReview,
  humanizeMetaOutput,
} from '../../../humanize/application/humanize-report.adapter';
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

const WEEKLY_MERGED_PULL_REQUEST_LIMIT = 60;
const WEEKLY_LOOKBACK_DAYS_AGO = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

interface WorklogEvidenceQueryResult {
  mergedPullRequests: GithubPullRequestSummary[];
  evidenceUnavailableReason: string | null;
  retriable: boolean;
}

// Weekly Summary 이관 — 매주 금요일 17:00 KST worklog(주간 7일 PM runs) + CEO meta 체인.
// 기존 src/weekly-summary/infrastructure/weekly-summary.consumer.ts 의 핵심 로직을 task 로 옮김.
// worklog / CEO meta 각각 요약은 summaryText(메인), 근거 detail 은 detailText(스레드)로 분리 반환 —
// 오케스트레이터(T0)가 메인 발송 후 detailText 를 스레드 댓글로 붙인다.
// CEO meta 실패 시(NO_PO_EVAL_RUN 등) graceful 안내문(detail 없음)으로 대체해 worklog 발송은 보장.
// plan과 실적이 모두 없으면 skip 안내를 반환하되, 재시도 가능한 조회 실패는 throw 한다.
@Injectable()
export class WeeklySummaryAutopilotTask implements AutopilotTask {
  readonly id = 'weekly-summary';

  private readonly logger = new Logger(WeeklySummaryAutopilotTask.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly generateWorklogUsecase: GenerateWorklogUsecase,
    private readonly generateCeoMetaUsecase: GenerateCeoMetaUsecase,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly humanizeService: HumanizeService,
    private readonly configService: ConfigService,
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

    const plannedLines =
      runs.length === 0
        ? ['- (이번 주 PM plan 없음)']
        : runs.flatMap((run) => {
            const plan = coerceToDailyPlan(run.output);
            if (!plan) {
              return [];
            }
            return [
              `[${KST_DATE_FORMATTER.format(run.endedAt)}]`,
              ...formatPlanLines(plan),
            ];
          });

    // 재시도가 자정을 넘어도 회고 기간과 조회 경계가 바뀌지 않도록 job의 KST 날짜에 고정한다.
    const periodEnd = new Date(`${firedAtKst}T00:00:00+09:00`);
    const since = new Date(
      periodEnd.getTime() - WEEKLY_LOOKBACK_DAYS_AGO * DAY_MS,
    );
    const until = new Date(periodEnd.getTime() + DAY_MS);
    const evidence = await this.loadEvidence(
      since.toISOString(),
      until.toISOString(),
    );
    if (runs.length === 0 && evidence.mergedPullRequests.length === 0) {
      if (evidence.retriable) {
        // 조회 실패를 "실적 0건" 으로 확정하면 정상 완료로 처리돼 멱등 가드가 소비되고
        // BullMQ 재시도까지 막힌다. 실패로 끊어 다음 슬롯에서 다시 시도하게 한다.
        throw new Error(
          `Weekly Summary 실적 조회 실패로 회고 생성을 보류합니다: ${evidence.evidenceUnavailableReason}`,
        );
      }
      const evidenceReason = evidence.evidenceUnavailableReason
        ? ` ${evidence.evidenceUnavailableReason}`
        : '';
      return {
        skip: false,
        summaryText: `_📋 Weekly Summary — ${firedAtKst} skip_\n이번 주 PM AgentRun 기록이 없습니다. Weekly Summary 를 생성하지 않습니다.${evidenceReason}`,
      };
    }

    const sinceLabel = KST_DATE_FORMATTER.format(since);
    const workText = buildWorklogInput({
      periodLabel: `${sinceLabel} ~ ${firedAtKst}`,
      plannedLines,
      mergedPullRequestLimit: WEEKLY_MERGED_PULL_REQUEST_LIMIT,
      mergedPullRequests: evidence.mergedPullRequests,
      evidenceUnavailableReason: evidence.evidenceUnavailableReason,
    });

    const worklogOutcome = await this.generateWorklogUsecase.execute({
      workText,
      slackUserId: ownerSlackUserId,
      triggerType: TriggerType.WEEKLY_SUMMARY_CRON,
    });

    // worklog / CEO meta 각각 summary(메인) / detail(스레드 = 근거) 로 분리.
    // 메인 = worklog 요약 + CEO 요약(구분자로 이음), 스레드 = 각 detail(+model 푸터) 을 이어 1개 댓글로.
    //
    // 퇴근 worklog(work-reviewer task)는 윤문을 거치는데 같은 산출물을 쓰는 이 주간 경로만
    // 빠져 있었다. 사람이 읽는 텍스트는 같으므로 맞춘다.
    const worklogFormatted = formatDailyReview(
      await humanizeDailyReview(worklogOutcome.result, this.humanizeService),
    );
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

  private async loadEvidence(
    sinceIsoDate: string,
    untilIsoDate: string,
  ): Promise<WorklogEvidenceQueryResult> {
    // Impact Report 와 동일 사용자의 동일 GitHub 활동을 조회하므로 기존 env 를 재사용한다.
    const author = this.configService
      .get<string>('IMPACT_REPORT_GITHUB_AUTHOR')
      ?.trim();
    if (!author) {
      return {
        mergedPullRequests: [],
        evidenceUnavailableReason: 'env IMPACT_REPORT_GITHUB_AUTHOR 미설정',
        retriable: false,
      };
    }

    const repository =
      this.configService.get<string>('IMPACT_REPORT_GITHUB_REPO')?.trim() ||
      null;
    try {
      const mergedPullRequests =
        await this.githubClient.listAuthorMergedPullRequestsSince({
          repo: repository,
          author,
          sinceIsoDate,
          untilIsoDate,
          limit: WEEKLY_MERGED_PULL_REQUEST_LIMIT,
          throwOnDetailFailure: true,
        });
      return {
        mergedPullRequests,
        evidenceUnavailableReason: null,
        retriable: false,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Weekly Summary GitHub 실적 조회 실패: ${message}`);
      return {
        mergedPullRequests: [],
        evidenceUnavailableReason: `GitHub 조회 실패: ${message}`,
        retriable: true,
      };
    }
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
      const ceoFormatted = formatCeoMetaOutput(
        await humanizeMetaOutput(ceoOutcome.result, this.humanizeService),
      );
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
