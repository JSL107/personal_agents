import { Injectable } from '@nestjs/common';

import { GeneratePoEvaluationUsecase } from '../../../agent/po-eval/application/generate-po-evaluation.usecase';
import { PoEvalException } from '../../../agent/po-eval/domain/po-eval.exception';
import { PoEvalErrorCode } from '../../../agent/po-eval/domain/po-eval-error-code.enum';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import { formatEvaluationOutput } from '../../../slack/format/po-evaluation.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// Daily Eval 이관 — 매일 19:00 KST PO_EVAL(range=TODAY) 자동 회고.
// 기존 src/daily-eval/infrastructure/daily-eval.consumer.ts 의 핵심 로직을 task 로 옮김.
// 발송은 오케스트레이터(T0)가 담당 — 여기선 텍스트만 만든다.
@Injectable()
export class PoEvalAutopilotTask implements AutopilotTask {
  readonly id = 'daily-eval';

  constructor(
    private readonly generatePoEvaluation: GeneratePoEvaluationUsecase,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    try {
      const outcome = await this.generatePoEvaluation.execute({
        slackUserId: ownerSlackUserId,
        range: 'TODAY',
        triggerType: TriggerType.DAILY_EVAL_CRON,
      });
      const intro = `🌅 *Daily Eval — ${firedAtKst} (19:00 KST 자동 회고)*\n\n`;
      const text =
        intro +
        formatEvaluationOutput(outcome.result) +
        formatModelFooter(outcome);
      return { skip: false, summaryText: text };
    } catch (error) {
      if (
        error instanceof PoEvalException &&
        error.poEvalErrorCode === PoEvalErrorCode.NO_SUB_AGENT_RUNS
      ) {
        return {
          skip: false,
          summaryText: `🌙 *Daily Eval — ${firedAtKst} skip*\n_오늘 sub-agent (Work Reviewer / PO Shadow / Impact Reporter) run 부재로 회고 대상 없음. 내일 19:00 KST 에 다시 시도합니다._`,
        };
      }
      throw error;
    }
  }
}
