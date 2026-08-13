import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { PaperTradingModule } from '../../paper-trading/paper-trading.module';
import { ScreenerModule } from '../../screener/screener.module';
import { GeneratePaperRecommendationUsecase } from './application/generate-paper-recommendation.usecase';

@Module({
  imports: [
    ScreenerModule,
    PaperTradingModule,
    ModelRouterModule,
    AgentRunModule,
  ],
  providers: [GeneratePaperRecommendationUsecase],
  exports: [GeneratePaperRecommendationUsecase],
})
export class PaperRecommendModule {}
