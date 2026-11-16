import {
  ParameterCombination,
  RobustWalkForwardVerdict,
} from '../../backtest/domain/parameter-search';
import { axisValueOf, decideAdoption } from './adoption-rule';

const combinationOf = (stopLoss: number): ParameterCombination => ({
  takeProfitPercent: 10,
  stopLossPercent: stopLoss,
  minimumTurnover60: 300_000_000,
  maximumWeightPercent: 20,
  volumeSurgeMinimum: 1,
  rankingWeights: [
    1, 1, 1,
  ] as unknown as ParameterCombination['rankingWeights'],
});

type Pair = [number | null, number | null];

const verdictOf = (
  label: string,
  won: boolean | null,
  pairs: Pair[] = [[2, 1]],
): RobustWalkForwardVerdict => ({
  windowIndex: 0,
  trainedWindowCount: 6,
  chosenLabel: label,
  byCondition: pairs.map(([chosen, baseline], index) => ({
    conditionLabel: `c${index}`,
    chosenExcessReturnPercent: chosen,
    baselineExcessReturnPercent: baseline,
    won,
  })),
  wonEveryCondition: won,
});

const combos = new Map<string, ParameterCombination>([
  ['A', combinationOf(-10)],
  ['B', combinationOf(-3)],
  ['BASE', combinationOf(-5)],
]);

const decide = (verdicts: RobustWalkForwardVerdict[], currentValue = -5) =>
  decideAdoption({
    axis: 'EXIT_STOP_LOSS_PERCENT',
    verdicts,
    combinationByLabel: combos,
    currentValue,
  });

const repeat = (n: number, make: () => RobustWalkForwardVerdict) =>
  Array.from({ length: n }, make);

describe('decideAdoption', () => {
  it('판정 가능 창이 5개면 부족하다', () => {
    const verdicts = [
      ...repeat(5, () => verdictOf('A', true)),
      verdictOf('A', null),
    ];
    expect(decide(verdicts)).toEqual({
      kind: 'NO_CHANGE',
      reason: '판정 가능 창 부족',
    });
  });

  it('판정 불가 창은 분모에서 빠진다', () => {
    const verdicts = [
      ...repeat(6, () => verdictOf('A', true, [[2, 1]])),
      ...repeat(3, () => verdictOf('A', null)),
    ];
    expect(decide(verdicts).kind).toBe('ADOPT');
  });

  it('같은 선택이 3창이면 선택 불안정이다', () => {
    const verdicts = [
      ...repeat(3, () => verdictOf('B', true)),
      ...repeat(3, () => verdictOf('A', true)),
    ];
    // 마지막이 A: A 는 3창
    expect(decide(verdicts).reason).toBe('선택 불안정');
  });

  it('같은 선택이 정확히 4창이면 통과한다', () => {
    const verdicts = [
      ...repeat(2, () => verdictOf('B', true)),
      ...repeat(4, () => verdictOf('A', true)),
    ];
    expect(decide(verdicts).kind).toBe('ADOPT');
  });

  it('6창 중 3승이면 승률 미달이다', () => {
    const verdicts = [
      ...repeat(3, () => verdictOf('A', true)),
      ...repeat(3, () => verdictOf('A', false)),
    ];
    expect(decide(verdicts).reason).toBe('승률 미달');
  });

  it('6창 중 4승이면 승률 경계(2/3)를 통과한다', () => {
    const verdicts = [
      ...repeat(4, () => verdictOf('A', true)),
      ...repeat(2, () => verdictOf('A', false)),
    ];
    expect(decide(verdicts).kind).toBe('ADOPT');
  });

  it('평균 차 0.4 는 개선 폭 미달이다', () => {
    const verdicts = repeat(6, () => verdictOf('A', true, [[1.4, 1]]));
    expect(decide(verdicts).reason).toBe('개선 폭 미달');
  });

  it('평균 차가 정확히 0.5 면 통과한다', () => {
    const verdicts = repeat(6, () => verdictOf('A', true, [[1.5, 1]]));
    expect(decide(verdicts).kind).toBe('ADOPT');
  });

  it('null 쪽이 있는 조건은 평균에서 빠지고, 전부 null 이면 개선 폭 미달이다', () => {
    const skipped = repeat(6, () =>
      verdictOf('A', true, [
        [null, 1],
        [2, 1],
      ]),
    );
    expect(decide(skipped).kind).toBe('ADOPT');
    const allNull = repeat(6, () => verdictOf('A', true, [[null, null]]));
    expect(decide(allNull).reason).toBe('개선 폭 미달');
  });

  it('손절 후보 -10, 현행 -5 는 한 칸(-7) 으로 제한된다', () => {
    const verdicts = repeat(6, () => verdictOf('A', true, [[1.6, 1]]));
    const decision = decide(verdicts);
    expect(decision).toMatchObject({ kind: 'ADOPT', value: -7 });
    expect(decision.reason).toContain('-10');
  });

  it('후보 -3, 현행 -5 는 인접 칸이라 그대로 채택한다', () => {
    const verdicts = repeat(6, () => verdictOf('B', true, [[1.6, 1]]));
    expect(decide(verdicts)).toMatchObject({ kind: 'ADOPT', value: -3 });
  });

  it('현행이 격자 밖이면 가장 가까운 칸을 기준으로 한 칸 제한한다', () => {
    // 현행 -4 → 격자 -3(인덱스 2)·-5(인덱스 3) 중 동률은 낮은 인덱스 -3. 후보 -10(인덱스 5) → -5
    const verdicts = repeat(6, () => verdictOf('A', true, [[1.6, 1]]));
    expect(decide(verdicts, -4)).toMatchObject({ kind: 'ADOPT', value: -5 });
  });

  it('후보가 현행과 같으면 현행 유지로 즉시 끝낸다', () => {
    const verdicts = [
      ...repeat(6, () => verdictOf('A', true)),
      verdictOf('BASE', false),
    ];
    expect(decide(verdicts)).toEqual({
      kind: 'NO_CHANGE',
      reason: '현행 유지',
    });
  });

  it('조합 표에 없는 라벨이면 예외를 던진다', () => {
    const verdicts = repeat(6, () => verdictOf('ZZZ', true));
    expect(() => decide(verdicts)).toThrow();
  });
});

describe('axisValueOf', () => {
  it('축별 값을 꺼낸다', () => {
    const combination = combinationOf(-3);
    expect(axisValueOf({ combination, axis: 'EXIT_TAKE_PROFIT_PERCENT' })).toBe(
      10,
    );
    expect(axisValueOf({ combination, axis: 'EXIT_STOP_LOSS_PERCENT' })).toBe(
      -3,
    );
    expect(axisValueOf({ combination, axis: 'MINIMUM_TURNOVER60' })).toBe(
      300_000_000,
    );
    expect(axisValueOf({ combination, axis: 'MAXIMUM_WEIGHT_PERCENT' })).toBe(
      20,
    );
  });
});
