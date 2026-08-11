import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { GetPaperTradingStatusUsecase } from '../src/paper-trading/application/get-paper-trading-status.usecase';
import { OpenPaperAccountUsecase } from '../src/paper-trading/application/open-paper-account.usecase';
import { RecordPaperTradeUsecase } from '../src/paper-trading/application/record-paper-trade.usecase';
import {
  parsePaperMarket,
  parseTradeStrategy,
} from '../src/paper-trading/domain/paper-account.type';
import { PaperTradingModule } from '../src/paper-trading/paper-trading.module';
import { PrismaModule } from '../src/prisma/prisma.module';

// 사용법:
//   pnpm exec ts-node scripts/paper-trade.ts open --seed 10000000
//   pnpm exec ts-node scripts/paper-trade.ts buy  --code 005930 --name 삼성전자 --market KOSPI --qty 10 --price 71000 --date 2026-08-11 [--strategy LONG_TERM] [--reason "분할 매수"]
//   pnpm exec ts-node scripts/paper-trade.ts sell --code 005930 --market KOSPI --qty 4 --price 73000 --date 2026-08-12 [--reason "일부 익절"]
//   pnpm exec ts-node scripts/paper-trade.ts status
const USAGE =
  '사용법:\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts open --seed <금액>\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts buy --code <종목코드> --name <종목명> --market <KOSPI|KOSDAQ|KONEX> --qty <수량> --price <체결가> --date <YYYY-MM-DD> [--strategy <LONG_TERM|SWING|MANUAL>] [--reason <사유>]\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts sell --code <종목코드> --market <KOSPI|KOSDAQ|KONEX> --qty <수량> --price <체결가> --date <YYYY-MM-DD> [--reason <사유>]\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts status';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    PaperTradingModule,
  ],
})
class PaperTradeCliModule {}

type Subcommand = 'open' | 'buy' | 'sell' | 'status';

interface ParsedArguments {
  subcommand: Subcommand;
  options: Map<string, string>;
}

const parseArguments = (values: string[]): ParsedArguments => {
  const [subcommandValue, ...optionValues] = values;
  if (
    subcommandValue !== 'open' &&
    subcommandValue !== 'buy' &&
    subcommandValue !== 'sell' &&
    subcommandValue !== 'status'
  ) {
    throw new Error(USAGE);
  }
  const options = new Map<string, string>();
  for (let index = 0; index < optionValues.length; index += 2) {
    const key = optionValues[index];
    const value = optionValues[index + 1];
    if (
      !key?.startsWith('--') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error(USAGE);
    }
    options.set(key.slice(2), value);
  }
  return { subcommand: subcommandValue, options };
};

const requireOption = (options: Map<string, string>, key: string): string => {
  const value = options.get(key);
  if (!value) {
    throw new Error(`필수 인자가 없습니다: --${key}\n${USAGE}`);
  }
  return value;
};

const printStatus = async (
  usecase: GetPaperTradingStatusUsecase,
): Promise<void> => {
  const status = await usecase.execute({
    accountName: 'DEFAULT',
    snapshotLimit: 10,
  });
  console.log('계좌');
  console.table([status.account]);
  console.log('포지션');
  console.table(status.positions);
  console.log('최근 스냅샷');
  console.table(status.snapshots);
};

const main = async (): Promise<void> => {
  const parsed = parseArguments(process.argv.slice(2));
  const application =
    await NestFactory.createApplicationContext(PaperTradeCliModule);
  try {
    if (parsed.subcommand === 'open') {
      const result = await application.get(OpenPaperAccountUsecase).execute({
        accountName: 'DEFAULT',
        seedAmount: requireOption(parsed.options, 'seed'),
        openedAt: new Date(),
      });
      console.table([result]);
      return;
    }
    if (parsed.subcommand === 'status') {
      await printStatus(application.get(GetPaperTradingStatusUsecase));
      return;
    }

    const result = await application.get(RecordPaperTradeUsecase).execute({
      accountName: 'DEFAULT',
      tickerCode: requireOption(parsed.options, 'code'),
      tickerName:
        parsed.subcommand === 'buy'
          ? requireOption(parsed.options, 'name')
          : undefined,
      market: parsePaperMarket(requireOption(parsed.options, 'market')),
      side: parsed.subcommand === 'buy' ? 'BUY' : 'SELL',
      quantity: requireOption(parsed.options, 'qty'),
      price: requireOption(parsed.options, 'price'),
      tradeDate: requireOption(parsed.options, 'date'),
      strategy: parseTradeStrategy(
        parsed.subcommand === 'buy'
          ? (parsed.options.get('strategy') ?? 'MANUAL')
          : 'MANUAL',
      ),
      reason: parsed.options.get('reason'),
    });
    console.table([result]);
  } finally {
    await application.close();
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
