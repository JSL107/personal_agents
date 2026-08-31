import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { GeneratePaperRecommendationUsecase } from '../src/agent/paper-recommend/application/generate-paper-recommendation.usecase';
import { PaperRecommendModule } from '../src/agent/paper-recommend/paper-recommend.module';
import { TriggerType } from '../src/agent-run/domain/agent-run.type';
import { ApplyCorporateActionUsecase } from '../src/paper-trading/application/apply-corporate-action.usecase';
import { ApplyExitBandUsecase } from '../src/paper-trading/application/apply-exit-band.usecase';
import { EvaluatePaperAccountUsecase } from '../src/paper-trading/application/evaluate-paper-account.usecase';
import { FillPendingOrdersUsecase } from '../src/paper-trading/application/fill-pending-orders.usecase';
import { GetPaperTradingStatusUsecase } from '../src/paper-trading/application/get-paper-trading-status.usecase';
import { OpenPaperAccountUsecase } from '../src/paper-trading/application/open-paper-account.usecase';
import { RecordPaperTradeUsecase } from '../src/paper-trading/application/record-paper-trade.usecase';
import { ScoreRecommendationsUsecase } from '../src/paper-trading/application/score-recommendations.usecase';
import { decideExitBandOrders } from '../src/paper-trading/domain/exit-band';
import {
  parsePaperMarket,
  parseTradeStrategy,
} from '../src/paper-trading/domain/paper-account.type';
import { formatPaperScoreReport } from '../src/paper-trading/infrastructure/paper-score.formatter';
import { formatPaperTradingReport } from '../src/paper-trading/infrastructure/paper-trading.formatter';
import {
  CorporateActionKind,
  PaperTradingPrismaRepository,
} from '../src/paper-trading/infrastructure/paper-trading.prisma.repository';
import { PaperTradingModule } from '../src/paper-trading/paper-trading.module';
import { PrismaModule } from '../src/prisma/prisma.module';

// 사용법:
//   pnpm exec ts-node scripts/paper-trade.ts open --account LONG_TERM --seed 10000000
//   pnpm exec ts-node scripts/paper-trade.ts buy  --account LONG_TERM --code 005930 --name 삼성전자 --market KOSPI --qty 10 --price 71000 --date 2026-08-11 [--strategy LONG_TERM] [--reason "분할 매수"]
//   pnpm exec ts-node scripts/paper-trade.ts sell --account LONG_TERM --code 005930 --market KOSPI --qty 4 --price 73000 --date 2026-08-12 [--reason "일부 익절"]
//   pnpm exec ts-node scripts/paper-trade.ts status
//   pnpm exec ts-node scripts/paper-trade.ts evaluate [--at 2026-08-11]
//   pnpm exec ts-node scripts/paper-trade.ts recommend
//   pnpm exec ts-node scripts/paper-trade.ts fill
//   pnpm exec ts-node scripts/paper-trade.ts score [--at 2026-08-13]
//   pnpm exec ts-node scripts/paper-trade.ts corporate-action --ticker 417310 --kind DIVIDEND --ex-date 2026-08-28 --per-share 8640 [--account LONG_TERM] [--quantity 182] [--apply true]
//   pnpm exec ts-node scripts/paper-trade.ts settlement-backfill [--apply true]
//
// evaluate 는 autopilot task 가 매일 17:40 에 하는 것과 **같은 usecase** 를 부른다.
// cron 을 기다리지 않고 평가 경로를 실증하기 위한 입구이고, 리포트도 Slack 에 나갈
// 것과 동일한 formatter 로 찍는다. `--at` 은 실행 시각을 그 날짜 KST 18:00 으로 고정한다.
const USAGE =
  '사용법:\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts open --account <DEFAULT|LONG_TERM|SWING> --seed <금액>\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts buy --account <DEFAULT|LONG_TERM|SWING> --code <종목코드> --name <종목명> --market <KOSPI|KOSDAQ|KONEX> --qty <수량> --price <체결가> --date <YYYY-MM-DD> [--strategy <LONG_TERM|SWING|MANUAL>] [--reason <사유>]\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts sell --account <DEFAULT|LONG_TERM|SWING> --code <종목코드> --market <KOSPI|KOSDAQ|KONEX> --qty <수량> --price <체결가> --date <YYYY-MM-DD> [--reason <사유>]\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts status\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts evaluate [--account <DEFAULT|LONG_TERM|SWING>] [--at <YYYY-MM-DD>] [--apply-exit-band true]\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts recommend\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts fill\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts score [--at <YYYY-MM-DD>]\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts corporate-action --ticker <종목코드> --kind <DIVIDEND|SPLIT|MERGE|BONUS_ISSUE> --ex-date <YYYY-MM-DD> [--per-share <금액>] [--quantity-ratio <배율>] [--quantity <수량>] [--account <계좌>] [--pay-date <YYYY-MM-DD>] [--note <사유>] [--apply true]\n' +
  '  pnpm exec ts-node scripts/paper-trade.ts settlement-backfill [--apply true]';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    PaperTradingModule,
    PaperRecommendModule,
  ],
})
class PaperTradeCliModule {}

type Subcommand =
  | 'open'
  | 'buy'
  | 'sell'
  | 'status'
  | 'evaluate'
  | 'recommend'
  | 'fill'
  | 'score'
  | 'corporate-action'
  | 'settlement-backfill';

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
    subcommandValue !== 'evaluate' &&
    subcommandValue !== 'recommend' &&
    subcommandValue !== 'fill' &&
    subcommandValue !== 'score' &&
    subcommandValue !== 'corporate-action' &&
    subcommandValue !== 'settlement-backfill'
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

// 계좌 이름은 전략명이 그대로 쓰인다 — apply-exit-band.usecase.ts:37-42 의 strategyOf 가
// LONG_TERM / SWING 만 전략으로 인정하고 그 밖은 MANUAL 로 떨어뜨린다. 오타로 계좌를 열면
// 지우는 경로가 없고(계좌 삭제·종료 usecase 없음) evaluate 의 executeAll 이 전 계좌를 훑으므로
// 고아 계좌가 매일 평가·시세 조회에 섞인다. 생성 전에 허용 값으로 끊는다.
const PAPER_ACCOUNT_NAMES: string[] = ['DEFAULT', 'LONG_TERM', 'SWING'];

const requireAccountName = (options: Map<string, string>): string => {
  const given = requireOption(options, 'account');
  const normalized = given.toUpperCase();
  if (!PAPER_ACCOUNT_NAMES.includes(normalized)) {
    throw new Error(
      `알 수 없는 계좌명: ${given} (허용: ${PAPER_ACCOUNT_NAMES.join(' | ')})`,
    );
  }
  return normalized;
};

const optionalAccountName = (
  options: Map<string, string>,
): string | undefined => {
  const given = options.get('account');
  if (given === undefined) {
    return undefined;
  }
  const normalized = given.toUpperCase();
  if (!PAPER_ACCOUNT_NAMES.includes(normalized)) {
    throw new Error(
      `알 수 없는 계좌명: ${given} (허용: ${PAPER_ACCOUNT_NAMES.join(' | ')})`,
    );
  }
  return normalized;
};

const parseApplyOption = (options: Map<string, string>): boolean => {
  const value = options.get('apply');
  if (value !== undefined && value !== 'true' && value !== 'false') {
    throw new Error(
      `--apply 는 true 또는 false 만 받습니다: ${value}\n${USAGE}`,
    );
  }
  return value === 'true';
};

const parseCorporateActionKind = (value: string): CorporateActionKind => {
  if (
    value !== 'DIVIDEND' &&
    value !== 'SPLIT' &&
    value !== 'MERGE' &&
    value !== 'BONUS_ISSUE'
  ) {
    throw new Error(`기업행동 종류가 올바르지 않습니다: ${value}\n${USAGE}`);
  }
  return value;
};

const parseUtcDateBoundary = (value: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`--at 날짜 형식이 올바르지 않습니다: ${value}`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== value) {
    throw new Error(`--at 날짜 형식이 올바르지 않습니다: ${value}`);
  }
  return date;
};

const printStatus = async (
  usecase: GetPaperTradingStatusUsecase,
): Promise<void> => {
  // 계좌 이름을 여기서 지정하면 추천이 실제로 매매하는 계좌(LONG_TERM / SWING)를 못 보고
  // 엉뚱한 계좌의 "보유 없음" 만 답하게 된다. evaluate 가 executeAll 을 쓰는 것과 같은 이유로
  // 열려 있는 계좌를 그대로 훑는다.
  const statuses = await usecase.executeAll({ snapshotLimit: 10 });
  if (statuses.length === 0) {
    console.log('열려 있는 가상 매매 계좌가 없습니다.');
    return;
  }
  for (const status of statuses) {
    console.log(`\n[${status.account.name}]`);
    console.log('계좌');
    console.table([status.account]);
    console.log('포지션');
    console.table(status.positions);
    console.log('최근 스냅샷');
    console.table(status.snapshots);
  }
};

const main = async (): Promise<void> => {
  const parsed = parseArguments(process.argv.slice(2));
  const scoreAt =
    parsed.subcommand === 'score' && parsed.options.has('at')
      ? parseUtcDateBoundary(parsed.options.get('at') as string)
      : undefined;
  const application =
    await NestFactory.createApplicationContext(PaperTradeCliModule);
  try {
    if (parsed.subcommand === 'open') {
      const result = await application.get(OpenPaperAccountUsecase).execute({
        accountName: requireAccountName(parsed.options),
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
    if (parsed.subcommand === 'recommend') {
      const result = await application
        .get(GeneratePaperRecommendationUsecase)
        .execute({ triggerType: TriggerType.MANUAL });
      console.log('추천 완료');
      console.table(result.completed);
      if (result.failed.length > 0) {
        console.log('추천 실패');
        console.table(result.failed);
      }
      return;
    }
    if (parsed.subcommand === 'fill') {
      const result = await application.get(FillPendingOrdersUsecase).execute();
      const { details, ...counts } = result;
      console.table([counts]);
      if (details.length > 0) {
        console.table(details);
      }
      return;
    }
    if (parsed.subcommand === 'score') {
      const result = await application
        .get(ScoreRecommendationsUsecase)
        .execute({ asOf: scoreAt });
      console.log(formatPaperScoreReport(result));
      return;
    }
    if (parsed.subcommand === 'settlement-backfill') {
      const apply = parseApplyOption(parsed.options);
      if (!apply) {
        console.log(
          '결제일 백필 판정만 수행합니다. 반영하려면 --apply true를 지정하세요.',
        );
        return;
      }
      const result = await application
        .get(PaperTradingPrismaRepository)
        .backfillSettlementDates();
      console.table([result]);
      return;
    }
    if (parsed.subcommand === 'corporate-action') {
      const apply = parseApplyOption(parsed.options);
      const payDateValue = parsed.options.get('pay-date');
      const result = await application
        .get(ApplyCorporateActionUsecase)
        .execute({
          accountName: optionalAccountName(parsed.options),
          tickerCode: requireOption(parsed.options, 'ticker'),
          kind: parseCorporateActionKind(requireOption(parsed.options, 'kind')),
          exDate: parseUtcDateBoundary(
            requireOption(parsed.options, 'ex-date'),
          ),
          payDate:
            payDateValue === undefined
              ? undefined
              : parseUtcDateBoundary(payDateValue),
          perShareAmount: parsed.options.get('per-share'),
          quantityRatio: parsed.options.get('quantity-ratio'),
          eligibleQuantity: parsed.options.get('quantity'),
          note: parsed.options.get('note'),
          dryRun: !apply,
        });
      console.log(
        apply ? '기업행동을 반영했습니다.' : '기업행동을 판정만 했습니다.',
      );
      console.table(result.accounts);
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
      // autopilot 이 매일 부르는 것과 같은 executeAll 을 쓴다. 여기서 계좌 이름을 하나
      // 지정하면 실증 입구가 그 계좌만 보게 되어, 정작 추천이 매매하는 계좌
      // (LONG_TERM/SWING)의 고장을 수동 실행으로는 영영 재현할 수 없다.
      const evaluateUsecase = application.get(EvaluatePaperAccountUsecase);
      const requestedAccountName = optionalAccountName(parsed.options);
      const evaluations = requestedAccountName
        ? {
            accounts: [
              {
                accountName: requestedAccountName,
                evaluation: await evaluateUsecase.execute({
                  accountName: requestedAccountName,
                  executedAt,
                }),
                failureReason: null,
              },
            ],
          }
        : await evaluateUsecase.executeAll(executedAt);
      for (const entry of evaluations.accounts) {
        console.log(`\n[${entry.accountName}]`);
        if (!entry.evaluation) {
          console.log(`평가 실패: ${entry.failureReason ?? '사유 미상'}`);
          continue;
        }
        console.log(formatPaperTradingReport(entry.evaluation));
      }
      console.log('\n판정 상세');
      console.table(
        evaluations.accounts.map((entry) => ({
          account: entry.accountName,
          skipped: entry.evaluation?.skipped ?? true,
          skipReason: entry.evaluation?.skipReason ?? entry.failureReason ?? '',
          tradeDate: entry.evaluation?.tradeDate ?? '',
          positionCount: entry.evaluation?.positionCount ?? 0,
          staleTickerCount: entry.evaluation?.staleTickerCount ?? 0,
          unpriced: entry.evaluation?.unpricedPositions.length ?? 0,
          invariantViolations:
            entry.evaluation?.invariantViolations.length ?? 0,
          suspiciousJumps: entry.evaluation?.suspiciousJumps.length ?? 0,
        })),
      );
      // 밴드 청산은 평가 직후 같은 슬롯에서 도는 규칙이라 여기서도 이어서 실행한다.
      // 이 줄이 없으면 밴드 동작을 확인할 유일한 길이 저녁 cron 을 기다리는 것뿐이다.
      // --apply-exit-band 없이는 판정만 찍고 주문은 만들지 않는다(수동 실행이
      // 실수로 매도를 거는 걸 막는다).
      //
      // 값을 정확히 검사한다. 존재 여부만 보면 `--apply-exit-band false` 로 명시적으로
      // 끄려 한 실행이 오히려 매도를 걸어, 안전장치가 정반대로 동작한다.
      const applyExitBandValue = parsed.options.get('apply-exit-band');
      if (
        applyExitBandValue !== undefined &&
        applyExitBandValue !== 'true' &&
        applyExitBandValue !== 'false'
      ) {
        throw new Error(
          `--apply-exit-band 는 true 또는 false 만 받습니다: ${applyExitBandValue}\n${USAGE}`,
        );
      }
      const applyExitBand = applyExitBandValue === 'true';
      const exitBand = await application.get(ApplyExitBandUsecase).execute({
        accounts: applyExitBand ? evaluations.accounts : [],
        executedAt,
      });
      console.log(
        `\n밴드 청산 (${applyExitBand ? '주문 생성' : '판정만 — 주문을 만들려면 --apply-exit-band true'})`,
      );
      if (!applyExitBand) {
        const preview = evaluations.accounts.flatMap((entry) =>
          decideExitBandOrders(
            // usecase 와 같은 조건이어야 미리보기가 실제 적용 결과를 예고한다.
            // 스냅샷이 막힌 회차는 usecase 가 매도를 걸지 않으므로 여기서도 뺀다.
            (entry.evaluation && !entry.evaluation.skipped
              ? entry.evaluation.positions
              : []
            ).map((position) => ({
              tickerId: position.tickerId,
              tickerCode: position.tickerCode,
              quantity: position.quantity,
              returnRate: position.returnRate,
              isStale: position.isStale,
            })),
          ).map((decision) => ({
            account: entry.accountName,
            code: decision.tickerCode,
            reason: decision.reason,
            returnRatePercent: decision.returnRatePercent,
          })),
        );
        console.table(preview);
        return;
      }
      console.table(exitBand.accounts);
      return;
    }

    const result = await application.get(RecordPaperTradeUsecase).execute({
      accountName: requireAccountName(parsed.options),
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
