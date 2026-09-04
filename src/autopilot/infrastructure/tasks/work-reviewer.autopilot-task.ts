import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { coerceToDailyPlan } from '../../../agent/pm/domain/prompt/previous-plan-formatter';
import { GenerateWorklogUsecase } from '../../../agent/work-reviewer/application/generate-worklog.usecase';
import {
  buildWorklogInput,
  formatPlanLines,
} from '../../../agent/work-reviewer/domain/prompt/worklog-input.formatter';
import { WorkReviewerException } from '../../../agent/work-reviewer/domain/work-reviewer.exception';
import { WorkReviewerErrorCode } from '../../../agent/work-reviewer/domain/work-reviewer-error-code.enum';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { GithubPullRequestSummary } from '../../../github/domain/github.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeDailyReview } from '../../../humanize/application/humanize-report.adapter';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { formatDailyReview } from '../../../slack/format/daily-review.formatter';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const DAILY_MERGED_PULL_REQUEST_LIMIT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

interface WorklogEvidenceQueryResult {
  mergedPullRequests: GithubPullRequestSummary[];
  evidenceUnavailableReason: string | null;
  retriable: boolean;
}

// 퇴근 자동 worklog — 오늘 PM plan과 GitHub 머지 실적을 소스로 WorkReviewer 를 자동 실행.
// plan과 실적이 모두 없으면 graceful 안내문을 반환하되, 재시도 가능한 조회 실패는 throw 한다.
// EMPTY_WORK_INPUT 은 기존대로 graceful 안내문을 반환한다(skip=false).
// 발송은 오케스트레이터(T0)가 담당 — 여기선 텍스트만 만든다.
@Injectable()
export class WorkReviewerAutopilotTask implements AutopilotTask {
  readonly id = 'work-reviewer';
  private readonly logger = new Logger(WorkReviewerAutopilotTask.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly generateWorklog: GenerateWorklogUsecase,
    private readonly humanizeService: HumanizeService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly configService: ConfigService,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const runs = await this.agentRunService.findRecentSucceededRuns({
      agentType: AgentType.PM,
      slackUserId: ownerSlackUserId,
      sinceDays: 1,
      limit: 1,
    });

    const latestRun = runs[0] ?? null;
    const plan = latestRun ? coerceToDailyPlan(latestRun.output) : null;
    // 재시도가 자정을 넘어도 회고 기간과 조회 경계가 바뀌지 않도록 job의 KST 날짜에 고정한다.
    const periodStart = new Date(`${firedAtKst}T00:00:00+09:00`);
    const sinceIsoDate = periodStart.toISOString();
    const untilIsoDate = new Date(periodStart.getTime() + DAY_MS).toISOString();
    const evidence = await this.loadEvidence(sinceIsoDate, untilIsoDate);

    if (latestRun === null && evidence.mergedPullRequests.length === 0) {
      if (evidence.retriable) {
        // 조회 실패를 "실적 0건" 으로 확정하면 정상 완료로 처리돼 멱등 가드가 소비되고
        // BullMQ 재시도까지 막힌다. 실패로 끊어 조용한 유실 대신 실패로 드러낸다.
        // 다만 evening 그룹은 같은 슬롯의 다른 task(daily-eval 등)가 산출물을 내면
        // orchestrator 의 부분 성공 정책상 job 이 성공 처리돼 재시도가 보장되지는 않는다.
        throw new Error(
          `Work Reviewer 실적 조회 실패로 회고 생성을 보류합니다: ${evidence.evidenceUnavailableReason}`,
        );
      }
      const evidenceReason = evidence.evidenceUnavailableReason
        ? ` ${evidence.evidenceUnavailableReason}`
        : '';
      return {
        skip: false,
        summaryText: `_📋 Work Reviewer — ${firedAtKst} skip_\n오늘 작성된 PM plan 이 없어 worklog 자동 생성을 건너뜁니다. \`/today\` 로 plan 을 먼저 만들어주세요.${evidenceReason}`,
      };
    }

    const workText = this.buildWorkText(
      plan,
      latestRun !== null,
      firedAtKst,
      evidence,
    );

    try {
      const outcome = await this.generateWorklog.execute({
        workText,
        slackUserId: ownerSlackUserId,
        triggerType: TriggerType.DAILY_EVAL_CRON,
      });
      const humanized = await humanizeDailyReview(
        outcome.result,
        this.humanizeService,
      );
      const formatted = formatDailyReview(humanized);
      const summaryText =
        `📝 *Work Reviewer — ${firedAtKst} (19:00 KST 자동 worklog)*\n\n` +
        formatted.summary;
      const detailText = formatted.detail + formatModelFooter(outcome);
      return { skip: false, summaryText, detailText };
    } catch (error) {
      if (
        error instanceof WorkReviewerException &&
        error.workReviewerErrorCode === WorkReviewerErrorCode.EMPTY_WORK_INPUT
      ) {
        return {
          skip: false,
          summaryText: `_📋 Work Reviewer — ${firedAtKst} skip_\n오늘 worklog 작업 입력이 비어 있습니다. \`/worklog <오늘 한 일>\` 로 직접 입력해주세요.`,
        };
      }
      throw error;
    }
  }

  private buildWorkText(
    plan: ReturnType<typeof coerceToDailyPlan>,
    hasPlanRun: boolean,
    periodLabel: string,
    evidence: WorklogEvidenceQueryResult,
  ): string {
    const plannedLines = plan
      ? formatPlanLines(plan)
      : hasPlanRun
        ? []
        : ['- (오늘 작성된 PM plan 없음)'];
    return buildWorklogInput({
      periodLabel,
      plannedLines,
      mergedPullRequestLimit: DAILY_MERGED_PULL_REQUEST_LIMIT,
      mergedPullRequests: evidence.mergedPullRequests,
      evidenceUnavailableReason: evidence.evidenceUnavailableReason,
    });
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
          limit: DAILY_MERGED_PULL_REQUEST_LIMIT,
          throwOnDetailFailure: true,
        });
      return {
        mergedPullRequests,
        evidenceUnavailableReason: null,
        retriable: false,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Work Reviewer GitHub 실적 조회 실패: ${message}`);
      return {
        mergedPullRequests: [],
        evidenceUnavailableReason: `GitHub 조회 실패: ${message}`,
        retriable: true,
      };
    }
  }
}
