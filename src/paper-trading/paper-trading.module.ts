import { Module } from '@nestjs/common';

import { MarketDataModule } from '../market-data/market-data.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EvaluatePaperAccountUsecase } from './application/evaluate-paper-account.usecase';
import { FillPendingOrdersUsecase } from './application/fill-pending-orders.usecase';
import { GetPaperTradingStatusUsecase } from './application/get-paper-trading-status.usecase';
import { OpenPaperAccountUsecase } from './application/open-paper-account.usecase';
import { RecordPaperTradeUsecase } from './application/record-paper-trade.usecase';
import { ScoreRecommendationsUsecase } from './application/score-recommendations.usecase';
import { PaperTradeDispatcher } from './infrastructure/paper-trade.dispatcher';
import { PaperTradingRepository } from './infrastructure/paper-trading.repository';

@Module({
  imports: [MarketDataModule, PrismaModule],
  providers: [
    PaperTradingRepository,
    GetPaperTradingStatusUsecase,
    OpenPaperAccountUsecase,
    RecordPaperTradeUsecase,
    EvaluatePaperAccountUsecase,
    FillPendingOrdersUsecase,
    ScoreRecommendationsUsecase,
    // 자연어 진입 — RouterModule 의 AGENT_DISPATCHER_PORT useFactory 가 중앙에서 inject 한다.
    PaperTradeDispatcher,
  ],
  exports: [
    PaperTradingRepository,
    GetPaperTradingStatusUsecase,
    OpenPaperAccountUsecase,
    RecordPaperTradeUsecase,
    EvaluatePaperAccountUsecase,
    FillPendingOrdersUsecase,
    ScoreRecommendationsUsecase,
    PaperTradeDispatcher,
  ],
})
export class PaperTradingModule {}
