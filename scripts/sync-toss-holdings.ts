import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { SyncHoldingsUsecase } from '../src/agent/stock/application/sync-holdings.usecase';
import { StockModule } from '../src/agent/stock/stock.module';
import { validateEnv } from '../src/config/app.config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    StockModule,
  ],
})
class SyncTossHoldingsModule {}

const main = async (): Promise<void> => {
  const application = await NestFactory.createApplicationContext(
    SyncTossHoldingsModule,
  );
  try {
    const usecase = application.get(SyncHoldingsUsecase);
    const result = await usecase.execute();
    console.log(
      `토스증권 잔고 동기화 완료 — synced=${result.synced}, zeroed=${result.zeroed}, changes=${result.changes.length}`,
    );
    // 0 건도 한 줄 남긴다. 아무 출력이 없으면 감지가 돌았는지 알 수 없다.
    if (result.changes.length === 0) {
      console.log('  직전 동기화 이후 매매 없음');
    }
    for (const change of result.changes) {
      const from = change.previousQuantity ?? '없음';
      console.log(
        `  ${change.symbol} ${change.kind} — 수량 ${from} → ${change.quantity}, 평단 ${change.previousAvgPrice ?? '없음'} → ${change.avgPrice}`,
      );
    }
  } finally {
    await application.close();
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`토스증권 잔고 동기화 실패 — ${message}`);
  process.exitCode = 1;
});
