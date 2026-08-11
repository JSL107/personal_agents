import { Module } from '@nestjs/common';

import { MarketDataModule } from '../market-data/market-data.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EvaluatePaperAccountUsecase } from './application/evaluate-paper-account.usecase';
import { RecordPaperTradeUsecase } from './application/record-paper-trade.usecase';
import { PaperTradingRepository } from './infrastructure/paper-trading.repository';

@Module({
  imports: [MarketDataModule, PrismaModule],
  providers: [
    PaperTradingRepository,
    RecordPaperTradeUsecase,
    EvaluatePaperAccountUsecase,
  ],
  exports: [
    PaperTradingRepository,
    RecordPaperTradeUsecase,
    EvaluatePaperAccountUsecase,
  ],
})
export class PaperTradingModule {}
