import { axisValueOf } from './adoption-rule';
import { ParameterSnapshot, TUNE_AXIS_ORDER } from './param-tune.type';
import { combinationFromSnapshot, withAxisValue } from './tune-combination';

const snapshot: ParameterSnapshot = [
  { name: 'EXIT_TAKE_PROFIT_PERCENT', parameterId: 1, version: 1, value: 10 },
  { name: 'EXIT_STOP_LOSS_PERCENT', parameterId: 2, version: 1, value: -5 },
  {
    name: 'MINIMUM_TURNOVER60',
    parameterId: 3,
    version: 1,
    value: 500_000_000,
  },
  { name: 'MAXIMUM_WEIGHT_PERCENT', parameterId: 4, version: 1, value: 20 },
];

describe('tune-combination', () => {
  it('스냅샷 네 값을 조합으로 옮긴다', () => {
    const combination = combinationFromSnapshot(snapshot);

    expect(combination).toMatchObject({
      takeProfitPercent: 10,
      stopLossPercent: -5,
      minimumTurnover60: 500_000_000,
      maximumWeightPercent: 20,
    });
  });

  it('withAxisValue 는 그 축만 바꾸고 원본을 건드리지 않는다', () => {
    const base = combinationFromSnapshot(snapshot);

    for (const axis of TUNE_AXIS_ORDER) {
      const changed = withAxisValue(base, axis, 7);

      expect(axisValueOf(changed, axis)).toBe(7);
      for (const other of TUNE_AXIS_ORDER.filter((name) => name !== axis)) {
        expect(axisValueOf(changed, other)).toBe(axisValueOf(base, other));
      }
    }
    expect(base.takeProfitPercent).toBe(10);
  });

  it('스냅샷에 축이 빠지면 던진다', () => {
    expect(() => combinationFromSnapshot(snapshot.slice(1))).toThrow(
      'EXIT_TAKE_PROFIT_PERCENT',
    );
  });
});
