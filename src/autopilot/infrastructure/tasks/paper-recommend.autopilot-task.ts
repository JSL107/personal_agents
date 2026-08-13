import { Injectable } from '@nestjs/common';

import {
  GeneratePaperRecommendationResult,
  GeneratePaperRecommendationUsecase,
} from '../../../agent/paper-recommend/application/generate-paper-recommendation.usecase';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const formatResult = (
  result: GeneratePaperRecommendationResult,
): AutopilotTaskResult => {
  const orderCount = result.completed.reduce(
    (sum, completed) => sum + completed.ordersCreated,
    0,
  );
  const detailText = result.failed.length
    ? '추천 실패 상세\n' +
      result.failed
        .map((failure) => `- ${failure.strategy}: ${failure.message}`)
        .join('\n')
    : undefined;

  return {
    skip: false,
    summaryText:
      `모의투자 추천 완료 — 계좌 ${result.completed.length}개, ` +
      `주문 ${orderCount}건, 실패 ${result.failed.length}개`,
    detailText,
  };
};

@Injectable()
export class PaperRecommendAutopilotTask implements AutopilotTask {
  readonly id = 'paper-recommend';

  constructor(
    private readonly generateRecommendation: GeneratePaperRecommendationUsecase,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const result = await this.generateRecommendation.execute({
      decidedAt: new Date(`${context.firedAtKst}T19:30:00+09:00`),
      triggerType: TriggerType.AUTOPILOT_PAPER_RECOMMEND_CRON,
    });
    return formatResult(result);
  }
}
