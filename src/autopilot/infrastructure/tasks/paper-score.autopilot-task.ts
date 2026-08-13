import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ScoreRecommendationsUsecase } from '../../../paper-trading/application/score-recommendations.usecase';
import { formatPaperScoreReport } from '../../../paper-trading/infrastructure/paper-score.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class PaperScoreAutopilotTask implements AutopilotTask {
  readonly id = 'paper-score';

  constructor(
    private readonly scoreRecommendations: ScoreRecommendationsUsecase,
    private readonly configService: ConfigService,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const enabled = this.configService.get<string>('PAPER_TRADING_ENABLED');
    if (enabled !== 'true') {
      return { skip: true };
    }

    const result = await this.scoreRecommendations.execute({
      asOf: new Date(`${context.firedAtKst}T00:00:00.000Z`),
    });
    return {
      skip: false,
      summaryText: formatPaperScoreReport(result),
    };
  }
}
