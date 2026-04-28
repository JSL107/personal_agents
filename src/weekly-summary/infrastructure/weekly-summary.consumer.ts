import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { coerceToDailyPlan } from '../../agent/pm/domain/prompt/previous-plan-formatter';
import { GenerateWorklogUsecase } from '../../agent/work-reviewer/application/generate-worklog.usecase';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import { formatDailyReview } from '../../slack/format/daily-review.formatter';
import { formatModelFooter } from '../../slack/format/model-footer.formatter';
import {
  WEEKLY_SUMMARY_QUEUE,
  WeeklySummaryJobData,
} from '../domain/weekly-summary.type';

@Processor(WEEKLY_SUMMARY_QUEUE)
export class WeeklySummaryConsumer extends WorkerHost {
  private readonly logger = new Logger(WeeklySummaryConsumer.name);

  constructor(
    private readonly generateWorklogUsecase: GenerateWorklogUsecase,
    private readonly agentRunService: AgentRunService,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
  ) {
    super();
  }

  async process(job: Job<WeeklySummaryJobData>): Promise<void> {
    const { ownerSlackUserId, target } = job.data;
    this.logger.log(
      `Weekly Summary 시작 — owner=${ownerSlackUserId} → target=${target}`,
    );

    const runs = await this.agentRunService.findRecentSucceededRuns({
      agentType: AgentType.PM,
      slackUserId: ownerSlackUserId,
      sinceDays: 7,
      limit: 7,
    });

    if (runs.length === 0) {
      await this.slackNotifier.postMessage({
        target,
        text: '이번 주 PM AgentRun 기록이 없습니다. Weekly Summary 를 생성하지 않습니다.',
      });
      return;
    }

    const planLines = runs
      .map((run) => {
        const plan = coerceToDailyPlan(run.output);
        if (!plan) {
          return null;
        }
        const allTasks = [plan.topPriority, ...plan.morning, ...plan.afternoon];
        const taskTitles = allTasks.map((t) => `- ${t.title}`).join('\n');
        return `[${run.endedAt.toISOString().slice(0, 10)}]\n${taskTitles}`;
      })
      .filter((line): line is string => line !== null);

    const workText = `이번 주 일일 plan 요약 (자동 생성):\n\n${planLines.join('\n\n')}`;

    const outcome = await this.generateWorklogUsecase.execute({
      workText,
      slackUserId: ownerSlackUserId,
      triggerType: TriggerType.WEEKLY_SUMMARY_CRON,
    });

    const text = formatDailyReview(outcome.result) + formatModelFooter(outcome);
    await this.slackNotifier.postMessage({ target, text });
    this.logger.log(`Weekly Summary 발송 완료 — target=${target}`);
  }
}
