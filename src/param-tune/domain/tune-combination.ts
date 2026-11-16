import { ParameterCombination } from '../../backtest/domain/parameter-search';
import {
  DEFAULT_RANKING_WEIGHTS,
  SWING_VOLUME_SURGE_MINIMUM,
} from '../../screener/domain/screener-rule';
import { StrategyParameterName } from '../../strategy-parameter/domain/strategy-parameter.type';
import { ParameterSnapshot } from './param-tune.type';

interface SnapshotName {
  snapshot: ParameterSnapshot;
  name: StrategyParameterName;
}

export interface AxisValueChange {
  combination: ParameterCombination;
  axis: StrategyParameterName;
  value: number;
}

const valueOf = ({ snapshot, name }: SnapshotName): number => {
  const found = snapshot.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`스냅샷에 ${name} 이 없다`);
  }
  return found.value;
};

/** 활성 스냅샷이 가리키는 현행 조합. 조정 대상이 아닌 두 값은 운영 상수다. */
export const combinationFromSnapshot = (
  snapshot: ParameterSnapshot,
): ParameterCombination => ({
  takeProfitPercent: valueOf({ snapshot, name: 'EXIT_TAKE_PROFIT_PERCENT' }),
  stopLossPercent: valueOf({ snapshot, name: 'EXIT_STOP_LOSS_PERCENT' }),
  minimumTurnover60: valueOf({ snapshot, name: 'MINIMUM_TURNOVER60' }),
  maximumWeightPercent: valueOf({ snapshot, name: 'MAXIMUM_WEIGHT_PERCENT' }),
  volumeSurgeMinimum: SWING_VOLUME_SURGE_MINIMUM,
  rankingWeights: DEFAULT_RANKING_WEIGHTS,
});

export const withAxisValue = ({
  combination,
  axis,
  value,
}: AxisValueChange): ParameterCombination => {
  switch (axis) {
    case 'EXIT_TAKE_PROFIT_PERCENT':
      return { ...combination, takeProfitPercent: value };
    case 'EXIT_STOP_LOSS_PERCENT':
      return { ...combination, stopLossPercent: value };
    case 'MINIMUM_TURNOVER60':
      return { ...combination, minimumTurnover60: value };
    case 'MAXIMUM_WEIGHT_PERCENT':
      return { ...combination, maximumWeightPercent: value };
  }
};
