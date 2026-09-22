import { Module } from '@nestjs/common';

import { MarketDataModule } from '../market-data/market-data.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StrategyParameterModule } from '../strategy-parameter/strategy-parameter.module';
import { ApplyCorporateActionUsecase } from './application/apply-corporate-action.usecase';
import { ApplyExitBandUsecase } from './application/apply-exit-band.usecase';
import { ApplyIntradayStopUsecase } from './application/apply-intraday-stop.usecase';
import { BuildPaperReportImageUsecase } from './application/build-paper-report-image.usecase';
import { EvaluatePaperAccountUsecase } from './application/evaluate-paper-account.usecase';
import { ExecutePaperOrderUsecase } from './application/execute-paper-order.usecase';
import { FillPendingOrdersUsecase } from './application/fill-pending-orders.usecase';
import { GetPaperTradingStatusUsecase } from './application/get-paper-trading-status.usecase';
import { OpenPaperAccountUsecase } from './application/open-paper-account.usecase';
import { RecordPaperTradeUsecase } from './application/record-paper-trade.usecase';
import { ScoreRecommendationsUsecase } from './application/score-recommendations.usecase';
import { PAPER_ORDER_LEDGER_PORT } from './domain/port/paper-order-ledger.port';
import { REPORT_RENDERER_PORT } from './domain/port/report-renderer.port';
import { PaperReportRenderer } from './infrastructure/paper-report.renderer';
import { PaperTradeDispatcher } from './infrastructure/paper-trade.dispatcher';
import { PaperTradingPrismaRepository } from './infrastructure/paper-trading.prisma.repository';

@Module({
  imports: [MarketDataModule, PrismaModule, StrategyParameterModule],
  providers: [
    PaperTradingPrismaRepository,
    // 체결 원장 — 운영·모의는 DB 장부를 쓴다. 백테스트는 같은 포트의 메모리 구현을 직접 끼운다.
    {
      provide: PAPER_ORDER_LEDGER_PORT,
      useExisting: PaperTradingPrismaRepository,
    },
    ExecutePaperOrderUsecase,
    GetPaperTradingStatusUsecase,
    OpenPaperAccountUsecase,
    RecordPaperTradeUsecase,
    EvaluatePaperAccountUsecase,
    ApplyExitBandUsecase,
    ApplyCorporateActionUsecase,
    ApplyIntradayStopUsecase,
    FillPendingOrdersUsecase,
    ScoreRecommendationsUsecase,
    BuildPaperReportImageUsecase,
    // 리포트 렌더 — Chromium 을 띄우는 쪽이라 포트로 갈라 둔다(테스트가 스텁으로 갈아끼운다).
    { provide: REPORT_RENDERER_PORT, useClass: PaperReportRenderer },
    // 자연어 진입 — RouterModule 의 AGENT_DISPATCHER_PORT useFactory 가 중앙에서 inject 한다.
    PaperTradeDispatcher,
  ],
  exports: [
    PaperTradingPrismaRepository,
    GetPaperTradingStatusUsecase,
    OpenPaperAccountUsecase,
    RecordPaperTradeUsecase,
    EvaluatePaperAccountUsecase,
    ApplyExitBandUsecase,
    ApplyCorporateActionUsecase,
    ApplyIntradayStopUsecase,
    FillPendingOrdersUsecase,
    ScoreRecommendationsUsecase,
    BuildPaperReportImageUsecase,
    PaperTradeDispatcher,
  ],
})
export class PaperTradingModule {}
