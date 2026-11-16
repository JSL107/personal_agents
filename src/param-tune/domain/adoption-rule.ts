import {
  ParameterCombination,
  RobustWalkForwardVerdict,
} from '../../backtest/domain/parameter-search';
import { StrategyParameterName } from '../../strategy-parameter/domain/strategy-parameter.type';
import { TUNE_ADOPTION_MARGIN_PERCENT, TUNE_GRID } from './param-tune.type';
import { AdoptionDecisionKind } from './param-tune.type';

export interface AdoptionInput {
  axis: StrategyParameterName;
  verdicts: RobustWalkForwardVerdict[];
  combinationByLabel: ReadonlyMap<string, ParameterCombination>;
  currentValue: number;
}

export type AdoptionDecision =
  | { kind: AdoptionDecisionKind.ADOPT; value: number; reason: string }
  | { kind: AdoptionDecisionKind.NO_CHANGE; reason: string };

const MINIMUM_DECIDABLE_WINDOWS = 6;
const MINIMUM_SAME_CHOICE_WINDOWS = 4;

export interface CombinationAxis {
  combination: ParameterCombination;
  axis: StrategyParameterName;
}

interface GridPosition {
  grid: readonly number[];
  value: number;
}

export const axisValueOf = ({
  combination,
  axis,
}: CombinationAxis): number | null => {
  switch (axis) {
    case 'EXIT_TAKE_PROFIT_PERCENT':
      return combination.takeProfitPercent;
    case 'EXIT_STOP_LOSS_PERCENT':
      return combination.stopLossPercent;
    case 'MINIMUM_TURNOVER60':
      return combination.minimumTurnover60;
    case 'MAXIMUM_WEIGHT_PERCENT':
      return combination.maximumWeightPercent;
  }
};

const noChange = (reason: string): AdoptionDecision => ({
  kind: AdoptionDecisionKind.NO_CHANGE,
  reason,
});

/** 격자에서 값의 위치. 격자 밖이면 가장 가까운 값(동률은 낮은 인덱스). */
const nearestGridIndex = ({ grid, value }: GridPosition): number =>
  grid.reduce(
    (best, entry, index) =>
      Math.abs(entry - value) < Math.abs(grid[best] - value) ? index : best,
    0,
  );

const meanExcessGap = (verdicts: RobustWalkForwardVerdict[]): number | null => {
  const gaps = verdicts
    .flatMap((verdict) => verdict.byCondition)
    .flatMap((condition) =>
      condition.chosenExcessReturnPercent === null ||
      condition.baselineExcessReturnPercent === null
        ? []
        : [
            condition.chosenExcessReturnPercent -
              condition.baselineExcessReturnPercent,
          ],
    );
  if (gaps.length === 0) {
    return null;
  }
  return gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
};

/**
 * 파라미터 탐색 결과를 실거래(모의) 규칙에 자동 반영할지 정한다. 사람 없이 규칙이 바뀌므로
 * 어느 단계든 근거가 모자라면 NO_CHANGE 로 끝낸다.
 */
export const decideAdoption = (input: AdoptionInput): AdoptionDecision => {
  const decidable = input.verdicts.filter(
    (verdict) => verdict.wonEveryCondition !== null,
  );
  if (decidable.length < MINIMUM_DECIDABLE_WINDOWS) {
    return noChange('판정 가능 창 부족');
  }

  const candidateLabel = input.verdicts.at(-1)?.chosenLabel;
  if (candidateLabel === undefined) {
    throw new Error(`후보 조합을 찾지 못했다: ${String(candidateLabel)}`);
  }
  const combination = input.combinationByLabel.get(candidateLabel);
  if (combination === undefined) {
    throw new Error(`후보 조합을 찾지 못했다: ${candidateLabel}`);
  }
  const candidate = axisValueOf({ combination, axis: input.axis });
  // 기준선을 고른 창은 판정 불가라 ② 에서 '선택 불안정' 으로 오보되기 전에 끊는다.
  if (candidate === input.currentValue) {
    return noChange('현행 유지');
  }

  const sameChoice = decidable.filter(
    (verdict) => verdict.chosenLabel === candidateLabel,
  );
  if (sameChoice.length < MINIMUM_SAME_CHOICE_WINDOWS) {
    return noChange('선택 불안정');
  }

  const wins = sameChoice.filter(
    (verdict) => verdict.wonEveryCondition === true,
  ).length;
  if (wins * 3 < sameChoice.length * 2) {
    return noChange('승률 미달');
  }

  const meanGap = meanExcessGap(sameChoice);
  if (meanGap === null || meanGap < TUNE_ADOPTION_MARGIN_PERCENT) {
    return noChange('개선 폭 미달');
  }

  if (candidate === null) {
    return noChange('후보 값 없음');
  }

  const grid = TUNE_GRID[input.axis];
  const candidateIndex = nearestGridIndex({ grid, value: candidate });
  const currentIndex = nearestGridIndex({ grid, value: input.currentValue });
  const summary = `승 ${wins}/${sameChoice.length} · 평균 개선 ${meanGap.toFixed(2)}%p`;
  if (Math.abs(candidateIndex - currentIndex) <= 1) {
    return {
      kind: AdoptionDecisionKind.ADOPT,
      value: candidate,
      reason: summary,
    };
  }
  const clamped = grid[currentIndex + (candidateIndex > currentIndex ? 1 : -1)];
  return {
    kind: AdoptionDecisionKind.ADOPT,
    value: clamped,
    reason: `${summary} · 후보 ${candidate} 는 한 칸 제한으로 ${clamped} 에 반영`,
  };
};
