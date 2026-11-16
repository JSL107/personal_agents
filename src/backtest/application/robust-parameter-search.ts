import {
  DEFAULT_MAXIMUM_DAILY_GAIN_PERCENT,
  ScreenStrategy,
} from '../../screener/domain/screener-rule';
import {
  ConditionOutcomes,
  formatCombinationLabel,
  ParameterCombination,
  SearchWindow,
  WindowOutcome,
} from '../domain/parameter-search';
import { SearchWindowSummary } from '../infrastructure/parameter-search.formatter';
import {
  BACKTEST_DEFAULTS,
  DEFAULT_HOLDING_TRADE_DAYS,
} from '../interface/backtest-cli.parser';
import {
  createReplayWindowCache,
  ReplayBacktestResult,
  ReplayBacktestUsecase,
  ReplayWindowCache,
} from './replay-backtest.usecase';

export interface RobustScreenStrategyInput {
  strategy: ScreenStrategy;
  baseline: ParameterCombination;
  combinations: ParameterCombination[];
}

export interface RobustSearchInput {
  windows: SearchWindow[];
  slippagePercents: number[];
  strategies: RobustScreenStrategyInput[];
}

export interface RobustSearchOutputForStrategy {
  // slippagePercents 순서 그대로.
  conditions: ConditionOutcomes[];
  baselineLabel: string;
  combinationByLabel: Map<string, ParameterCombination>;
  // 키는 슬리피지(%) — 보고서가 회차(슬리피지)마다 창 요약을 따로 싣는다.
  windowSummaries: Map<number, SearchWindowSummary[]>;
}

export interface ReplayParametersInput {
  strategy: ScreenStrategy;
  from: string;
  to: string;
  combination: ParameterCombination;
  slippagePercent: number;
}

export interface ReplayParametersRequest {
  input: ReplayParametersInput;
  replay: ReplayBacktestUsecase;
  cache?: ReplayWindowCache;
}

export interface RunRobustSearchRequest {
  input: RobustSearchInput;
  replay: ReplayBacktestUsecase;
  onWindowDone?: (window: SearchWindow) => void;
}

export const slippageLabelOf = (value: number): string =>
  value === 0 ? '슬리피지 0% (미반영)' : `슬리피지 ${value}%`;

const ratioToPercent = (value: string | null): number | null =>
  value === null ? null : Number(value) * 100;

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

/**
 * 파라미터 한 벌의 재생 1회. 고정 인자는 탐색 축이 아니라 운영 규칙이라 여기 한 곳에 둔다.
 */
export const replayParameters = ({
  input,
  replay,
  cache,
}: ReplayParametersRequest): Promise<ReplayBacktestResult> => {
  const { strategy, combination } = input;
  return replay.execute(
    {
      strategy,
      from: input.from,
      to: input.to,
      seedAmount: BACKTEST_DEFAULTS.seedAmount,
      minimumTurnover60: combination.minimumTurnover60,
      maximumDailyGainPercent: DEFAULT_MAXIMUM_DAILY_GAIN_PERCENT,
      volumeSurgeMinimum: combination.volumeSurgeMinimum,
      rankingWeights: combination.rankingWeights,
      flowSlot: null,
      maximumPositions: BACKTEST_DEFAULTS.maximumPositions,
      weightPercent: combination.maximumWeightPercent,
      holdingTradeDays: DEFAULT_HOLDING_TRADE_DAYS[strategy],
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
      slippagePercent: input.slippagePercent,
    },
    cache,
  );
};

/**
 * 전 전략을 전 창 × 전 슬리피지 × 전 조합으로 재생한다. 캐시는 창마다 하나, 그 창의 모든
 * 전략·조합·슬리피지가 나눠 쓰고 창이 끝나면 버린다(들고 있으면 메모리가 창 수만큼 쌓인다).
 */
export const runRobustSearch = async ({
  input,
  replay,
  onWindowDone,
}: RunRobustSearchRequest): Promise<
  Map<ScreenStrategy, RobustSearchOutputForStrategy>
> => {
  interface Accumulator {
    baselineLabel: string;
    combinationByLabel: Map<string, ParameterCombination>;
    outcomesBySlippage: Map<number, WindowOutcome[]>;
    windowSummaries: Map<number, SearchWindowSummary[]>;
  }
  const accumulators = new Map<ScreenStrategy, Accumulator>();
  for (const entry of input.strategies) {
    const combinationByLabel = new Map<string, ParameterCombination>();
    for (const combination of entry.combinations) {
      combinationByLabel.set(formatCombinationLabel(combination), combination);
    }
    accumulators.set(entry.strategy, {
      baselineLabel: formatCombinationLabel(entry.baseline),
      combinationByLabel,
      outcomesBySlippage: new Map(
        input.slippagePercents.map((value) => [value, []]),
      ),
      windowSummaries: new Map(
        input.slippagePercents.map((value) => [value, []]),
      ),
    });
  }

  for (const window of input.windows) {
    const cache = createReplayWindowCache(
      window.from,
      window.to,
      BACKTEST_DEFAULTS.volatilityEstimator,
    );
    for (const { strategy } of input.strategies) {
      const accumulator = accumulators.get(strategy) as Accumulator;
      for (const slippagePercent of input.slippagePercents) {
        for (const [label, combination] of accumulator.combinationByLabel) {
          const result = await replayParameters({
            input: {
              strategy,
              from: window.from,
              to: window.to,
              combination,
              slippagePercent,
            },
            replay,
            cache,
          });
          // 불변식이 깨진 회차는 규칙의 성적이 아니라 버그의 성적이다. 표에 섞으면
          // 그 조합이 순위를 왜곡하므로 즉시 멈춘다.
          if (result.invariantViolations.length > 0) {
            throw new Error(
              `불변식 위반 (${strategy} 창${window.index} ${label}): ` +
                result.invariantViolations.join(' / '),
            );
          }
          const score = result.scores.find(
            (candidate) => candidate.strategy === strategy,
          );
          accumulator.outcomesBySlippage.get(slippagePercent)?.push({
            windowIndex: window.index,
            label,
            excessReturnPercent: ratioToPercent(result.meanExcessReturnRate),
            finalReturnPercent: ratioToPercent(result.finalReturnRate),
            maximumLossPercent: ratioToPercent(score?.maximumLoss ?? null),
            hitRatePercent: ratioToPercent(score?.hitRate ?? null),
            closedCount: score?.closedCount ?? 0,
            filledCount: result.filledCount,
          });
          if (label === accumulator.baselineLabel) {
            accumulator.windowSummaries.get(slippagePercent)?.push({
              window,
              tradeDateCount: result.tradeDateCount,
              benchmarkReturnPercent: benchmarkReturnPercentOf(
                cache.benchmarkCloses,
              ),
              baselineFilledCount: result.filledCount,
              baselineClosedCount: score?.closedCount ?? 0,
            });
          }
        }
      }
    }
    onWindowDone?.(window);
  }

  return new Map(
    [...accumulators].map(([strategy, accumulator]) => [
      strategy,
      {
        conditions: input.slippagePercents.map((slippagePercent) => ({
          conditionLabel: slippageLabelOf(slippagePercent),
          outcomes: accumulator.outcomesBySlippage.get(slippagePercent) ?? [],
        })),
        baselineLabel: accumulator.baselineLabel,
        combinationByLabel: accumulator.combinationByLabel,
        windowSummaries: accumulator.windowSummaries,
      },
    ]),
  );
};
