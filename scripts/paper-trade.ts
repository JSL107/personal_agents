import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { EvaluatePaperAccountUsecase } from '../src/paper-trading/application/evaluate-paper-account.usecase';
import { GetPaperTradingStatusUsecase } from '../src/paper-trading/application/get-paper-trading-status.usecase';
import { OpenPaperAccountUsecase } from '../src/paper-trading/application/open-paper-account.usecase';
import { RecordPaperTradeUsecase } from '../src/paper-trading/application/record-paper-trade.usecase';
import {
  parsePaperMarket,
  parseTradeStrategy,
} from '../src/paper-trading/domain/paper-account.type';
import { formatPaperTradingReport } from '../src/paper-trading/infrastructure/paper-trading.formatter';
import { PaperTradingModule } from '../src/paper-trading/paper-trading.module';
import { PrismaModule } from '../src/prisma/prisma.module';

// 사용법:
//   pnpm exec ts-node scripts/paper-trade.ts open --seed 10000000
//   pnpm exec ts-node scripts/paper-trade.ts buy  --code 005930 --name 삼성전자 --market KOSPI --qty 10 --price 71000 --date 2026-08-11 [--strategy LONG_TERM] [--reason "분할 매수"]
//   pnpm exec ts-node scripts/paper-trade.ts sell --code 005930 --market KOSPI --qty 4 --price 73000 --date 2026-08-12 [--reason "일부 익절"]
//   pnpm exec ts-node scripts/paper-trade.ts status
//   pnpm exec ts-node scripts/paper-trade.ts evaluate [--at 2026-08-11]
//
// evaluate 는 autopilot task 가 매일 17:40 에 하는 것과 **같은 usecase** 를 부른다.
// cron 을 기다리지 않고 평가 경로를 실증하기 위한 입구이고, 리포트도 Slack 에 나갈
// 것과 동일한 formatter 로 찍는다. `--at` 은 실행 시각을 그 날짜 KST 18:00 으로 고정한다.
const USAGE =
  '사용법:\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts open --seed <금액>\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts buy --code <종목코드> --name <종목명> --market <KOSPI|KOSDAQ|KONEX> --qty <수량> --price <체결가> --date <YYYY-MM-DD> [--strategy <LONG_TERM|SWING|MANUAL>] [--reason <사유>]\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts sell --code <종목코드> --market <KOSPI|KOSDAQ|KONEX> --qty <수량> --price <체결가> --date <YYYY-MM-DD> [--reason <사유>]\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts status\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts evaluate [--at <YYYY-MM-DD>]';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    PaperTradingModule,
  ],
})
class PaperTradeCliModule {}

type Subcommand = 'open' | 'buy' | 'sell' | 'status' | 'evaluate';

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
    subcommandValue !== 'status' &&
    subcommandValue !== 'evaluate'
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
    if (parsed.subcommand === 'evaluate') {
      const at = parsed.options.get('at');
      // 장 마감 후 시각으로 고정한다. 그날 종가가 확정된 뒤를 가정해야 tradeDate 가
      // 실행일과 맞고, 봉이 전 거래일로 오는 경우를 stale 로 정직하게 잡을 수 있다.
      const executedAt = at ? new Date(`${at}T18:00:00+09:00`) : new Date();
      if (Number.isNaN(executedAt.getTime())) {
        throw new Error(`--at 날짜 형식이 올바르지 않습니다: ${at}`);
      }
      const result = await application
        .get(EvaluatePaperAccountUsecase)
        .execute({ accountName: 'DEFAULT', executedAt });
      console.log(formatPaperTradingReport(result));
      console.log('\n판정 상세');
      console.table([
        {
          skipped: result.skipped,
          skipReason: result.skipReason ?? '',
          tradeDate: result.tradeDate ?? '',
          positionCount: result.positionCount,
          staleTickerCount: result.staleTickerCount,
          unpriced: result.unpricedPositions.length,
          invariantViolations: result.invariantViolations.length,
          suspiciousJumps: result.suspiciousJumps.length,
        },
      ]);
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
