import { DEFAULT_MAXIMUM_DAILY_GAIN_PERCENT } from '../../screener/domain/screener-rule';
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

type SearchStrategy = 'LONG_TERM' | 'SWING';

export interface RobustSearchInput {
  strategy: SearchStrategy;
  windows: SearchWindow[];
  slippagePercents: number[];
  baseline: ParameterCombination;
  combinations: ParameterCombination[];
}

export interface RobustSearchOutput {
  // slippagePercents 순서 그대로.
  conditions: ConditionOutcomes[];
  baselineLabel: string;
  combinationByLabel: Map<string, ParameterCombination>;
  // 키는 슬리피지(%) — 보고서가 회차(슬리피지)마다 창 요약을 따로 싣는다.
  windowSummaries: Map<number, SearchWindowSummary[]>;
}

export interface ReplayParametersInput {
  strategy: SearchStrategy;
  from: string;
  to: string;
  combination: ParameterCombination;
  slippagePercent: number;
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
export const replayParameters = (
  input: ReplayParametersInput,
  replay: ReplayBacktestUsecase,
  cache?: ReplayWindowCache,
): Promise<ReplayBacktestResult> => {
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
 * 한 전략을 전 창 × 전 슬리피지 × 전 조합으로 재생한다. 캐시는 창마다 하나, 그 창의 모든
 * 조합·슬리피지가 나눠 쓰고 창이 끝나면 버린다(들고 있으면 메모리가 창 수만큼 쌓인다).
 */
export const runRobustSearch = async (
  input: RobustSearchInput,
  replay: ReplayBacktestUsecase,
  onWindowDone?: (window: SearchWindow) => void,
): Promise<RobustSearchOutput> => {
  const baselineLabel = formatCombinationLabel(input.baseline);
  const combinationByLabel = new Map<string, ParameterCombination>();
  for (const combination of input.combinations) {
    combinationByLabel.set(formatCombinationLabel(combination), combination);
  }
  const outcomesBySlippage = new Map<number, WindowOutcome[]>();
  const windowSummaries = new Map<number, SearchWindowSummary[]>();
  for (const slippagePercent of input.slippagePercents) {
    outcomesBySlippage.set(slippagePercent, []);
    windowSummaries.set(slippagePercent, []);
  }

  for (const window of input.windows) {
    const cache = createReplayWindowCache(
      window.from,
      window.to,
      BACKTEST_DEFAULTS.volatilityEstimator,
    );
    for (const slippagePercent of input.slippagePercents) {
      for (const [label, combination] of combinationByLabel) {
        const result = await replayParameters(
          {
            strategy: input.strategy,
            from: window.from,
            to: window.to,
            combination,
            slippagePercent,
          },
          replay,
          cache,
        );
        // 불변식이 깨진 회차는 규칙의 성적이 아니라 버그의 성적이다. 표에 섞으면
        // 그 조합이 순위를 왜곡하므로 즉시 멈춘다.
        if (result.invariantViolations.length > 0) {
          throw new Error(
            `불변식 위반 (${input.strategy} 창${window.index} ${label}): ` +
              result.invariantViolations.join(' / '),
          );
        }
        const score = result.scores.find(
          (candidate) => candidate.strategy === input.strategy,
        );
        outcomesBySlippage.get(slippagePercent)?.push({
          windowIndex: window.index,
          label,
          excessReturnPercent: ratioToPercent(result.meanExcessReturnRate),
          finalReturnPercent: ratioToPercent(result.finalReturnRate),
          maximumLossPercent: ratioToPercent(score?.maximumLoss ?? null),
          hitRatePercent: ratioToPercent(score?.hitRate ?? null),
          closedCount: score?.closedCount ?? 0,
          filledCount: result.filledCount,
        });
        if (label === baselineLabel) {
          windowSummaries.get(slippagePercent)?.push({
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
    onWindowDone?.(window);
  }

  return {
    conditions: input.slippagePercents.map((slippagePercent) => ({
      conditionLabel: slippageLabelOf(slippagePercent),
      outcomes: outcomesBySlippage.get(slippagePercent) ?? [],
    })),
    baselineLabel,
    combinationByLabel,
    windowSummaries,
  };
};
