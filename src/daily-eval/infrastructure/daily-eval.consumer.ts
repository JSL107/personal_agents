import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { GeneratePoEvaluationUsecase } from '../../agent/po-eval/application/generate-po-evaluation.usecase';
import { PoEvalException } from '../../agent/po-eval/domain/po-eval.exception';
import { PoEvalErrorCode } from '../../agent/po-eval/domain/po-eval-error-code.enum';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import { formatModelFooter } from '../../slack/format/model-footer.formatter';
import { formatEvaluationOutput } from '../../slack/format/po-evaluation.formatter';
import { DAILY_EVAL_QUEUE, DailyEvalJobData } from '../domain/daily-eval.type';

// workflow-phase-definition §5.2 Daily Eval consumer.
// 매일 19:00 KST job 발화 시 PO_EVAL (range=TODAY) 자동 실행 + Slack 발송.
// 그날 sub-agent (WORK_REVIEWER / PO_SHADOW / IMPACT_REPORTER) run 없으면 NO_SUB_AGENT_RUNS —
// graceful skip + Slack 안내 (사용자가 그날 활동 안 한 경우라 회고 불가).
@Processor(DAILY_EVAL_QUEUE)
export class DailyEvalConsumer extends WorkerHost {
  private readonly logger = new Logger(DailyEvalConsumer.name);

  constructor(
    private readonly generatePoEvaluationUsecase: GeneratePoEvaluationUsecase,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
  ) {
    super();
  }

  async process(job: Job<DailyEvalJobData>): Promise<void> {
    const { ownerSlackUserId, target } = job.data;
    this.logger.log(
      `Daily Eval 시작 — owner=${ownerSlackUserId} → target=${target}`,
    );

    try {
      const outcome = await this.generatePoEvaluationUsecase.execute({
        slackUserId: ownerSlackUserId,
        range: 'TODAY',
        triggerType: TriggerType.DAILY_EVAL_CRON,
      });
      const text =
        formatEvaluationOutput(outcome.result) + formatModelFooter(outcome);
      await this.slackNotifier.postMessage({ target, text });
      this.logger.log(`Daily Eval 발송 완료 — target=${target}`);
    } catch (error) {
      if (
        error instanceof PoEvalException &&
        error.poEvalErrorCode === PoEvalErrorCode.NO_SUB_AGENT_RUNS
      ) {
        this.logger.warn(
          `Daily Eval skip — sub-agent run 없음 (owner=${ownerSlackUserId}): ${error.message}`,
        );
        await this.slackNotifier.postMessage({
          target,
          text: '_오늘 sub-agent (Work Reviewer / PO Shadow / Impact Reporter) run 부재로 Daily Eval skip 됩니다._',
        });
        return;
      }
      this.logger.error(
        `Daily Eval 실패 — 예상 외 에러 (owner=${ownerSlackUserId})`,
        error,
      );
      throw error;
    }
  }
}
