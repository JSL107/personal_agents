import { writeFileSync } from 'node:fs';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import {
  createReplayWindowCache,
  ReplayBacktestUsecase,
} from '../src/backtest/application/replay-backtest.usecase';
import { BacktestModule } from '../src/backtest/backtest.module';
import {
  buildParameterGrid,
  buildSearchWindows,
  formatCombinationLabel,
  ParameterCombination,
  WindowOutcome,
} from '../src/backtest/domain/parameter-search';
import {
  formatParameterSearchReport,
  formatRobustnessReport,
  SearchWindowSummary,
} from '../src/backtest/infrastructure/parameter-search.formatter';
import {
  BACKTEST_DEFAULTS,
  DEFAULT_HOLDING_TRADE_DAYS,
} from '../src/backtest/interface/backtest-cli.parser';
import {
  ParameterSearchCliOptions,
  parseParameterSearchCliArguments,
} from '../src/backtest/interface/parameter-search-cli.parser';
import { PrismaModule } from '../src/prisma/prisma.module';
import {
  DEFAULT_MAXIMUM_DAILY_GAIN_PERCENT,
  DEFAULT_RANKING_WEIGHTS,
  SWING_VOLUME_SURGE_MINIMUM,
} from '../src/screener/domain/screener-rule';
import { ResolveStrategyParametersUsecase } from '../src/strategy-parameter/application/resolve-strategy-parameters.usecase';
import { StrategyParameterModule } from '../src/strategy-parameter/strategy-parameter.module';

/**
 * 파라미터 탐색기 — **보고만 한다.** 활성 행을 읽어 현행값을 기준으로 잡고, 후보 격자를
 * 창마다 재생해 순위로 종합한 표를 낸다. 값을 바꾸는 경로는 여기 없다(원장 목표 12 의 PR ③).
 *
 * 재생 1회의 97% 가 파라미터와 무관한 후보 산출이라, 창 하나당 캐시 하나를 만들어 그 계산을
 * 전 조합·두 전략이 나눠 쓴다. 캐시는 창이 끝나면 버린다 — 구간이 다르면 표본이 달라지고,
 * 들고 있으면 메모리가 창 수만큼 쌓인다.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    BacktestModule,
    StrategyParameterModule,
  ],
})
class ParameterSearchCliModule {}

const slippageLabelOf = (value: number): string =>
  value === 0 ? '슬리피지 0% (미반영)' : `슬리피지 ${value}%`;

const ratioToPercent = (value: string | null): number | null =>
  value === null ? null : Number(value) * 100;

/**
 * 한 회차 = (전략 × 슬리피지) 한 쌍. 슬리피지는 격자 축이 아니라 회차를 가르는 조건이라
 * 순위·walk-forward 가 회차 안에서만 이뤄진다(파서 주석). 한 프로세스에서 값만 바꿔 도는
 * 것은 창 캐시를 나눠 쓰기 위해서고, 덤으로 회차끼리 **같은 후보 산출**을 놓고 비교하게 된다.
 */
interface StrategyPlan {
  strategy: 'LONG_TERM' | 'SWING';
  slippagePercent: number;
  baseline: ParameterCombination;
  baselineLabel: string;
  combinations: ParameterCombination[];
}

const planKeyOf = (plan: StrategyPlan): string =>
  `${plan.strategy}|${plan.slippagePercent}`;

const buildStrategyPlans = async (
  options: ParameterSearchCliOptions,
  resolve: ResolveStrategyParametersUsecase,
): Promise<StrategyPlan[]> => {
  const plans: StrategyPlan[] = [];
  // 접었다는 사실을 알린다 — 준 값이 조용히 사라지면 사용자는 그 축을 재 봤다고 읽는다.
  if (
    options.volumeSurgeMinimums !== undefined &&
    options.strategies.includes('LONG_TERM')
  ) {
    console.error(
      '알림: --volume-surge-min 은 SWING 필터 전용이라 LONG_TERM 격자에서는 현행값 하나로 접었다.',
    );
  }
  for (const strategy of options.strategies) {
    const active = await resolve.execute(strategy);
    const baseline: ParameterCombination = {
      takeProfitPercent: active.exitBand.takeProfitPercent,
      stopLossPercent: active.exitBand.stopLossPercent,
      minimumTurnover60: active.minimumTurnover60,
      maximumWeightPercent: active.maximumWeightPercent,
      volumeSurgeMinimum: SWING_VOLUME_SURGE_MINIMUM,
      rankingWeights: DEFAULT_RANKING_WEIGHTS,
    };
    for (const slippagePercent of options.slippagePercents) {
      plans.push({
        strategy,
        slippagePercent,
        baseline,
        baselineLabel: formatCombinationLabel(baseline),
        combinations: buildParameterGrid({
          // 축에 값을 안 주면 현행값 하나로 고정한다 — 그 축은 이번 회차의 탐색 대상이 아니다.
          takeProfitPercents: options.takeProfitPercents ?? [
            baseline.takeProfitPercent as number,
          ],
          stopLossPercents: options.stopLossPercents ?? [
            baseline.stopLossPercent as number,
          ],
          minimumTurnover60s: options.minimumTurnover60s ?? [
            baseline.minimumTurnover60,
          ],
          maximumWeightPercents: options.maximumWeightPercents ?? [
            baseline.maximumWeightPercent,
          ],
          // 거래량 급증 문턱은 `passesSwing` 에만 걸린다(screener-rule.ts 의 SWING 분기).
          // LONG_TERM 격자에 이 축을 펼치면 라벨만 다르고 성적이 똑같은 조합이 여러 개
          // 생기고, 동률 정렬이 그중 하나를 라벨 순서로 집어 **현행값과 같은 성적을
          // 패배로 기록**한다. 그 전략에서는 축을 접는다.
          volumeSurgeMinimums:
            strategy === 'SWING'
              ? (options.volumeSurgeMinimums ?? [baseline.volumeSurgeMinimum])
              : [baseline.volumeSurgeMinimum],
          rankingWeights: options.rankingWeights ?? [baseline.rankingWeights],
          includeBandless: options.includeBandless,
          baseline,
        }),
      });
    }
  }
  return plans;
};

const benchmarkReturnPercentOf = (
  closes: Array<{ close: unknown }> | undefined,
): number | null => {
  const first = closes?.at(0);
  const last = closes?.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  const start = Number(String(first.close));
  const end = Number(String(last.close));
  if (!Number.isFinite(start) || start === 0 || !Number.isFinite(end)) {
    return null;
  }
  return (end / start - 1) * 100;
};

const main = async (): Promise<void> => {
  const options = parseParameterSearchCliArguments(process.argv.slice(2));
  const windows = buildSearchWindows({
    from: options.from,
    to: options.to,
    windowMonths: options.windowMonths,
    stepMonths: options.stepMonths,
  });
  if (windows.length === 0) {
    throw new Error(
      `창이 하나도 만들어지지 않았습니다 (${options.from}~${options.to}, 창 ${options.windowMonths}개월).`,
    );
  }

  const application = await NestFactory.createApplicationContext(
    ParameterSearchCliModule,
    { logger: ['warn', 'error'] },
  );
  try {
    const replay = application.get(ReplayBacktestUsecase);
    const plans = await buildStrategyPlans(
      options,
      application.get(ResolveStrategyParametersUsecase),
    );
    const replayCount =
      windows.length *
      plans.reduce((sum, plan) => sum + plan.combinations.length, 0);
    // 진행 상황은 stderr 로 낸다. stdout 을 파일로 받아 그대로 문서에 붙일 수 있어야 한다.
    console.error(
      `창 ${windows.length}개 · 재생 ${replayCount}회 시작 (${new Date().toISOString()})`,
    );

    const outcomes = new Map<string, WindowOutcome[]>();
    const windowSummaries = new Map<string, SearchWindowSummary[]>();
    const startedAt = Date.now();

    for (const window of windows) {
      const cache = createReplayWindowCache(
        window.from,
        window.to,
        BACKTEST_DEFAULTS.volatilityEstimator,
      );
      const windowStartedAt = Date.now();
      for (const plan of plans) {
        for (const combination of plan.combinations) {
          const result = await replay.execute(
            {
              strategy: plan.strategy,
              from: window.from,
              to: window.to,
              seedAmount: BACKTEST_DEFAULTS.seedAmount,
              minimumTurnover60: combination.minimumTurnover60,
              maximumDailyGainPercent: DEFAULT_MAXIMUM_DAILY_GAIN_PERCENT,
              volumeSurgeMinimum: combination.volumeSurgeMinimum,
              rankingWeights: combination.rankingWeights,
              maximumPositions: BACKTEST_DEFAULTS.maximumPositions,
              weightPercent: combination.maximumWeightPercent,
              holdingTradeDays: DEFAULT_HOLDING_TRADE_DAYS[plan.strategy],
              exitBand:
                combination.takeProfitPercent === null ||
                combination.stopLossPercent === null
                  ? null
                  : {
                      takeProfitPercent: combination.takeProfitPercent,
                      stopLossPercent: combination.stopLossPercent,
                    },
              delistingRecoveryRate: BACKTEST_DEFAULTS.delistingRecoveryRate,
              // 변동성 추정량은 탐색 축이 아니다 — #443 이 재 보고 운영 규칙(종가→종가)을
              // 유지하기로 했다. 캐시 정체성에 들어 있어 여기서 갈리면 예외로 끊긴다.
              volatilityEstimator: BACKTEST_DEFAULTS.volatilityEstimator,
              // 회차 전체에 같은 값이 걸린다 — 축이 아니다(파서 주석).
              slippagePercent: plan.slippagePercent,
            },
            cache,
          );
          // 불변식이 깨진 회차는 규칙의 성적이 아니라 버그의 성적이다. 표에 섞으면
          // 그 조합이 순위를 왜곡하므로 즉시 멈춘다.
          if (result.invariantViolations.length > 0) {
            throw new Error(
              `불변식 위반 (${plan.strategy} 창${window.index} ${formatCombinationLabel(combination)}): ` +
                result.invariantViolations.join(' / '),
            );
          }
          const score = result.scores.find(
            (candidate) => candidate.strategy === plan.strategy,
          );
          const bucket = outcomes.get(planKeyOf(plan)) ?? [];
          bucket.push({
            windowIndex: window.index,
            label: formatCombinationLabel(combination),
            excessReturnPercent: ratioToPercent(result.meanExcessReturnRate),
            finalReturnPercent: ratioToPercent(result.finalReturnRate),
            maximumLossPercent: ratioToPercent(score?.maximumLoss ?? null),
            hitRatePercent: ratioToPercent(score?.hitRate ?? null),
            closedCount: score?.closedCount ?? 0,
            filledCount: result.filledCount,
          });
          outcomes.set(planKeyOf(plan), bucket);

          if (formatCombinationLabel(combination) === plan.baselineLabel) {
            const summaries = windowSummaries.get(planKeyOf(plan)) ?? [];
            summaries.push({
              window,
              tradeDateCount: result.tradeDateCount,
              benchmarkReturnPercent: benchmarkReturnPercentOf(
                cache.benchmarkCloses,
              ),
              baselineFilledCount: result.filledCount,
              baselineClosedCount: score?.closedCount ?? 0,
            });
            windowSummaries.set(planKeyOf(plan), summaries);
          }
        }
      }
      console.error(
        `  창${window.index} ${window.from}~${window.to} 완료 ` +
          `(${((Date.now() - windowStartedAt) / 1000).toFixed(1)}초 · ` +
          `누적 ${((Date.now() - startedAt) / 60000).toFixed(1)}분 · ` +
          `힙 ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)}MB)`,
      );
    }

    const reports = plans.map((plan) => ({
      strategy: plan.strategy,
      conditionLabel: slippageLabelOf(plan.slippagePercent),
      baselineLabel: plan.baselineLabel,
      windows: windowSummaries.get(planKeyOf(plan)) ?? [],
      outcomes: outcomes.get(planKeyOf(plan)) ?? [],
    }));
    console.log(
      [
        `# 파라미터 탐색 — ${options.from} ~ ${options.to}`,
        '',
        `창 ${options.windowMonths}개월 · 이동 ${options.stepMonths}개월 · ` +
          `재생 ${replayCount}회 · 소요 ${((Date.now() - startedAt) / 60000).toFixed(1)}분`,
        '',
        // 0 일 때도 적는다. 여러 회차의 표를 나란히 놓고 읽는 도구라, 값이 안 적힌 표가
        // 하나 섞이면 그것이 미반영 회차인지 옛 회차인지 구분되지 않는다.
        `체결가 슬리피지 ${options.slippagePercents.map((value) => `${value}%`).join(' · ')} ` +
          '(매수 +x% · 매도 −x% · 왕복 2x% · 회차마다 따로 순위를 매긴다)',
        '',
        ...reports.map((report) => formatParameterSearchReport(report)),
        // 슬리피지 수준이 둘 이상일 때만 낸다. 하나면 가로지를 것이 없어 위 표와 같은 말이다.
        ...(options.slippagePercents.length > 1
          ? options.strategies.map((strategy) =>
              formatRobustnessReport({
                strategy,
                baselineLabel:
                  plans.find((plan) => plan.strategy === strategy)
                    ?.baselineLabel ?? '',
                conditions: plans
                  .filter((plan) => plan.strategy === strategy)
                  .map((plan) => ({
                    conditionLabel: slippageLabelOf(plan.slippagePercent),
                    outcomes: outcomes.get(planKeyOf(plan)) ?? [],
                  })),
              }),
            )
          : []),
      ].join('\n'),
    );

    if (options.outPath !== undefined) {
      writeFileSync(
        options.outPath,
        `${JSON.stringify({ options, windows, reports }, null, 2)}\n`,
        'utf-8',
      );
      console.error(`원자료 저장: ${options.outPath}`);
    }
  } finally {
    await application.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
