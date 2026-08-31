import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { getTodayKstDate } from '../src/common/util/kst-date.util';
import { PrismaModule } from '../src/prisma/prisma.module';
import { BackfillUniversePricesUsecase } from '../src/screener/application/backfill-universe-prices.usecase';
import { BuildScreeningScorecardUsecase } from '../src/screener/application/build-screening-scorecard.usecase';
import { CollectBenchmarkClosesUsecase } from '../src/screener/application/collect-benchmark-closes.usecase';
import { CollectUniversePricesUsecase } from '../src/screener/application/collect-universe-prices.usecase';
import { ScoreScreeningOutcomesUsecase } from '../src/screener/application/score-screening-outcomes.usecase';
import { ScreenUniverseUsecase } from '../src/screener/application/screen-universe.usecase';
import { SyncUniverseUsecase } from '../src/screener/application/sync-universe.usecase';
import { formatBackfillSummary } from '../src/screener/infrastructure/backfill-summary.formatter';
import { formatPriceCollectionFailures } from '../src/screener/infrastructure/price-collection-failure.formatter';
import { formatPriceCollectionSummary } from '../src/screener/infrastructure/price-collection-summary.formatter';
import { formatScreenResult } from '../src/screener/infrastructure/screen-result.formatter';
import { formatScreeningOutcomeResult } from '../src/screener/infrastructure/screening-outcome.formatter';
import {
  formatScreeningScorecard,
  formatScreeningScorecardDetail,
} from '../src/screener/infrastructure/screening-scorecard.formatter';
import { parseScreenerCliArguments } from '../src/screener/interface/screener-cli.parser';
import { ScreenerModule } from '../src/screener/screener.module';
import { ResolveStrategyParametersUsecase } from '../src/strategy-parameter/application/resolve-strategy-parameters.usecase';
import { StrategyParameterModule } from '../src/strategy-parameter/strategy-parameter.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ScreenerModule,
    StrategyParameterModule,
  ],
})
class ScreenerCliModule {}

const BACKFILL_STOP_DESCRIPTION: Record<string, string> = {
  alreadyCovered: '이미 목표 기간을 덮고 있어 조회하지 않음',
  targetReached: '목표 시작일 도달',
  exhausted: '공급자 데이터 소진',
  stalled: '커서가 더 과거로 가지 않음 — 목표 미달',
  pageLimit: '페이지 상한 도달 — 목표 미달, 다시 실행하면 이어 받는다',
};

const describeBackfillStop = (reason: string | null): string => {
  if (reason === null) {
    return '알 수 없음';
  }
  return BACKFILL_STOP_DESCRIPTION[reason] ?? reason;
};

const main = async (): Promise<void> => {
  const parsed = parseScreenerCliArguments(process.argv.slice(2));
  const application =
    await NestFactory.createApplicationContext(ScreenerCliModule);
  try {
    if (parsed.subcommand === 'sync-universe') {
      const result = await application.get(SyncUniverseUsecase).execute();
      console.log(
        `KRX 유니버스 동기화를 마쳤습니다. ${result.fetched}종목을 받아 ${result.upserted}종목을 반영했고, 목록에서 빠진 ${result.delisted}종목을 상장폐지 처리했습니다.`,
      );
      return;
    }

    if (parsed.subcommand === 'screen') {
      // 확인용 실행도 운영과 같은 값으로 걸러야 한다 — 여기서만 코드 상수를 쓰면
      // 활성 행을 바꾼 뒤 CLI 로 확인한 결과가 그날 운영이 보여줄 목록과 달라진다.
      const parameters = await application
        .get(ResolveStrategyParametersUsecase)
        .execute(parsed.options.strategy);
      const result = await application.get(ScreenUniverseUsecase).execute({
        ...parsed.options,
        minimumTurnover60: parameters.minimumTurnover60,
      });
      console.log(formatScreenResult(result));
      if (result.recordOutcome?.saved === true) {
        console.log(
          `스크리닝 이력을 원장에 남겼습니다. 회차 #${result.recordOutcome.runId}, 기준일 ${result.asOf ?? '-'}, 기록 ${result.recordOutcome.recordedCount}종목.`,
        );
      }
      if (result.recordOutcome?.saved === false) {
        console.log(
          `이미 운영 회차가 있어 원장에 남기지 않았습니다. 기존 회차 #${result.recordOutcome.runId}, 기준일 ${result.asOf ?? '-'} — 확인용 실행이 그날 보여준 목록을 덮어쓰지 않습니다.`,
        );
      }
      return;
    }

    if (parsed.subcommand === 'score-outcomes') {
      const result = await application
        .get(ScoreScreeningOutcomesUsecase)
        .execute();
      console.log(formatScreeningOutcomeResult(result));
      return;
    }

    if (parsed.subcommand === 'scorecard') {
      // 운영 카드와 같은 usecase·같은 formatter 를 통과시킨다. 여기서만 따로 조립하면
      // 화면에서 맞아 보이는 문구가 슬랙에서는 다를 수 있다.
      const result = await application
        .get(BuildScreeningScorecardUsecase)
        // autopilot 경로가 firedAtKst 를 쓰는 것과 같은 달력 날짜를 쓴다.
        .execute({ asOf: new Date(`${getTodayKstDate()}T00:00:00.000Z`) });
      console.log(formatScreeningScorecard(result));
      const detail = formatScreeningScorecardDetail(result);
      if (detail !== null) {
        console.log('');
        console.log('--- 스레드 상세 ---');
        console.log(detail);
      }
      return;
    }

    if (parsed.subcommand === 'collect-benchmark') {
      const result = await application
        .get(CollectBenchmarkClosesUsecase)
        .execute(parsed.options);
      console.log(
        `벤치마크 ${result.symbol} 수집을 마쳤습니다. 조회 ${result.fetched}봉, 저장 ${result.written}봉, 장중 차단 ${result.blockedIntraday}봉, 최신 거래일 ${result.latestTradeDate ?? '없음'}.` +
          (parsed.options.years === undefined
            ? ''
            : ` 백필 ${result.pages}페이지, 가장 오래된 거래일 ${result.oldestTradeDate ?? '없음'}, 종료 ${describeBackfillStop(result.stopReason)}.`),
      );
      return;
    }

    if (parsed.subcommand === 'backfill-prices') {
      const result = await application
        .get(BackfillUniversePricesUsecase)
        .execute(parsed.options);
      console.log(formatBackfillSummary(result));
      // 전종목 실행은 한 시간 가까이 걸린다. 요약만 내고 상세를 버리면 어느 종목이 왜
      // 누락됐는지 알 길이 없어 다시 받을 대상을 특정할 수 없다.
      const backfillFailureDetail = formatPriceCollectionFailures(
        result.failed,
        result.failures,
      );
      if (backfillFailureDetail) {
        console.log(backfillFailureDetail);
      }
      return;
    }

    const result = await application
      .get(CollectUniversePricesUsecase)
      .execute(parsed.options);
    console.log(formatPriceCollectionSummary(result));
    const failureDetail = formatPriceCollectionFailures(
      result.failed,
      result.failures,
    );
    if (failureDetail) {
      console.log(failureDetail);
    }
  } finally {
    await application.close();
  }
};

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
