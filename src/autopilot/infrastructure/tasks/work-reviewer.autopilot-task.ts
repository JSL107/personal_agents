import { Injectable } from '@nestjs/common';

import { coerceToDailyPlan } from '../../../agent/pm/domain/prompt/previous-plan-formatter';
import { GenerateWorklogUsecase } from '../../../agent/work-reviewer/application/generate-worklog.usecase';
import { WorkReviewerException } from '../../../agent/work-reviewer/domain/work-reviewer.exception';
import { WorkReviewerErrorCode } from '../../../agent/work-reviewer/domain/work-reviewer-error-code.enum';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { formatDailyReview } from '../../../slack/format/daily-review.formatter';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 퇴근 자동 worklog — 오늘 PM plan(AgentRun SUCCEEDED)을 소스로 WorkReviewer 를 자동 실행.
// 오늘 plan 없거나 EMPTY_WORK_INPUT 이면 graceful 안내문 반환(skip=false).
// 발송은 오케스트레이터(T0)가 담당 — 여기선 텍스트만 만든다.
@Injectable()
export class WorkReviewerAutopilotTask implements AutopilotTask {
  readonly id = 'work-reviewer';

  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly generateWorklog: GenerateWorklogUsecase,
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

    if (runs.length === 0) {
      return {
        skip: false,
        summaryText: `_📋 Work Reviewer — ${firedAtKst} skip_\n오늘 작성된 PM plan 이 없어 worklog 자동 생성을 건너뜁니다. \`/today\` 로 plan 을 먼저 만들어주세요.`,
      };
    }

    const latestRun = runs[0];
    const plan = coerceToDailyPlan(latestRun.output);

    const workText = this.buildWorkText(plan, latestRun.endedAt);

    try {
      const outcome = await this.generateWorklog.execute({
        workText,
        slackUserId: ownerSlackUserId,
        triggerType: TriggerType.DAILY_EVAL_CRON,
      });
      const intro = `📝 *Work Reviewer — ${firedAtKst} (19:00 KST 자동 worklog)*\n\n`;
      const formatted = formatDailyReview(outcome.result);
      const text =
        intro +
        formatted.summary +
        '\n\n' +
        formatted.detail +
        formatModelFooter(outcome);
      return { skip: false, summaryText: text };
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
    endedAt: Date,
  ): string {
    if (!plan) {
      return `오늘 plan 요약 (자동 생성, ${endedAt.toISOString().slice(0, 10)}):\n- (plan 파싱 불가 — 오늘 업무를 요약해주세요)`;
    }
    const allTasks = [plan.topPriority, ...plan.morning, ...plan.afternoon];
    const taskTitles = allTasks.map((task) => `- ${task.title}`).join('\n');
    return `오늘 plan 요약 (자동 생성, ${endedAt.toISOString().slice(0, 10)}):\n\n${taskTitles}`;
  }
}
