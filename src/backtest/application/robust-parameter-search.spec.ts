import { DEFAULT_RANKING_WEIGHTS } from '../../screener/domain/screener-rule';
import { ParameterCombination } from '../domain/parameter-search';
import {
  ReplayBacktestResult,
  ReplayBacktestUsecase,
} from './replay-backtest.usecase';
import {
  RobustSearchOutputForStrategy,
  runRobustSearch,
} from './robust-parameter-search';

const WEIGHTS = DEFAULT_RANKING_WEIGHTS;

const combinationOf = (stopLossPercent: number): ParameterCombination => ({
  takeProfitPercent: 10,
  stopLossPercent,
  minimumTurnover60: 1_000,
  maximumWeightPercent: 20,
  volumeSurgeMinimum: 1.5,
  rankingWeights: WEIGHTS,
});

const BASELINE = combinationOf(-3);
const COMBINATIONS = [BASELINE, combinationOf(-5), combinationOf(-7)];
const WINDOWS = [
  { index: 1, from: '2025-04-01', to: '2025-09-30' },
  { index: 2, from: '2025-10-01', to: '2026-03-31' },
];

const resultOf = (violations: string[] = []): ReplayBacktestResult =>
  ({
    invariantViolations: violations,
    scores: [
      {
        strategy: 'SWING',
        maximumLoss: '-0.1',
        hitRate: '0.5',
        closedCount: 4,
      },
    ],
    meanExcessReturnRate: '0.02',
    finalReturnRate: '0.05',
    filledCount: 6,
    tradeDateCount: 120,
  }) as unknown as ReplayBacktestResult;

const input = {
  windows: WINDOWS,
  slippagePercents: [0, 0.5],
  strategies: [
    {
      strategy: 'SWING' as const,
      baseline: BASELINE,
      combinations: COMBINATIONS,
    },
  ],
};

describe('runRobustSearch', () => {
  it('창 × 조합 × 슬리피지만큼 재생하고 조건별 성적을 모은다', async () => {
    const execute = jest.fn().mockResolvedValue(resultOf());
    const outputs = await runRobustSearch(input, {
      execute,
    } as unknown as ReplayBacktestUsecase);

    const output = outputs.get('SWING') as RobustSearchOutputForStrategy;
    expect(execute).toHaveBeenCalledTimes(12);
    expect(output.conditions).toHaveLength(2);
    expect(output.conditions[0].outcomes).toHaveLength(6);
    expect(output.combinationByLabel.size).toBe(3);
    expect(output.windowSummaries.get(0.5)).toHaveLength(2);
    expect(output.windowSummaries.get(0.5)?.[0].baselineFilledCount).toBe(6);
  });

  it('같은 창의 재생은 한 캐시를 나눠 쓴다', async () => {
    const execute = jest.fn().mockResolvedValue(resultOf());
    await runRobustSearch(input, {
      execute,
    } as unknown as ReplayBacktestUsecase);

    const caches = new Set(execute.mock.calls.map(([, cache]) => cache));
    expect(caches.size).toBe(2);
  });

  it('불변식 위반 결과가 섞이면 reject 한다', async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce(resultOf())
      .mockResolvedValueOnce(resultOf(['음수 현금']))
      .mockResolvedValue(resultOf());

    await expect(
      runRobustSearch(input, {
        execute,
      } as unknown as ReplayBacktestUsecase),
    ).rejects.toThrow('불변식 위반');
  });

  it('두 전략이 한 창의 캐시를 함께 쓴다', async () => {
    const execute = jest.fn().mockResolvedValue(resultOf());
    await runRobustSearch(
      {
        ...input,
        strategies: [
          ...input.strategies,
          {
            strategy: 'LONG_TERM' as const,
            baseline: BASELINE,
            combinations: COMBINATIONS,
          },
        ],
      },
      { execute } as unknown as ReplayBacktestUsecase,
    );

    // 창 2 × 전략 2 × 조합 3 × 슬리피지 2
    expect(execute).toHaveBeenCalledTimes(24);
    const cacheOf = (strategy: string, window: string): Set<unknown> =>
      new Set(
        execute.mock.calls
          .filter(
            ([command]) =>
              command.strategy === strategy && command.from === window,
          )
          .map(([, cache]) => cache),
      );
    const swingFirst = cacheOf('SWING', '2025-04-01');
    expect(swingFirst.size).toBe(1);
    expect(cacheOf('LONG_TERM', '2025-04-01')).toEqual(swingFirst);
    expect(cacheOf('SWING', '2025-10-01')).not.toEqual(swingFirst);
  });
});
