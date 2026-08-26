import { StrategyParameterPort } from '../domain/port/strategy-parameter.port';
import { STRATEGY_PARAMETER_FALLBACKS } from '../domain/strategy-parameter.type';
import { ResolveStrategyParametersUsecase } from './resolve-strategy-parameters.usecase';

describe('ResolveStrategyParametersUsecase', () => {
  const repository = {
    findActiveParameters: jest.fn(),
  };
  const usecase = new ResolveStrategyParametersUsecase(
    repository as unknown as StrategyParameterPort,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    repository.findActiveParameters.mockResolvedValue([]);
  });

  it('활성 행이 없으면 코드 상수로 채운다', async () => {
    const resolved = await usecase.execute('SWING');

    expect(resolved).toEqual({
      exitBand: {
        takeProfitPercent:
          STRATEGY_PARAMETER_FALLBACKS.EXIT_TAKE_PROFIT_PERCENT,
        stopLossPercent: STRATEGY_PARAMETER_FALLBACKS.EXIT_STOP_LOSS_PERCENT,
      },
      minimumTurnover60: STRATEGY_PARAMETER_FALLBACKS.MINIMUM_TURNOVER60,
      maximumWeightPercent: STRATEGY_PARAMETER_FALLBACKS.MAXIMUM_WEIGHT_PERCENT,
    });
  });

  // 상수와 다른 값을 써야 배선이 살아 있는지 증명된다. 같은 값으로 확인하면 조회 결과를
  // 통째로 버려도 통과한다.
  it('활성 행이 있으면 그 값이 코드 상수를 이긴다', async () => {
    repository.findActiveParameters.mockResolvedValue([
      { name: 'EXIT_TAKE_PROFIT_PERCENT', value: 30, version: 2, reason: 'r' },
      { name: 'EXIT_STOP_LOSS_PERCENT', value: -15, version: 2, reason: 'r' },
      {
        name: 'MINIMUM_TURNOVER60',
        value: 300_000_000,
        version: 2,
        reason: 'r',
      },
      { name: 'MAXIMUM_WEIGHT_PERCENT', value: 12.5, version: 2, reason: 'r' },
    ]);

    const resolved = await usecase.execute('LONG_TERM');

    expect(resolved).toEqual({
      exitBand: { takeProfitPercent: 30, stopLossPercent: -15 },
      minimumTurnover60: 300_000_000,
      maximumWeightPercent: 12.5,
    });
    expect(repository.findActiveParameters).toHaveBeenCalledWith('LONG_TERM');
  });

  // 탐색기는 같은 축의 후보를 차례로 잰다. 활성 행이 인자를 이기면 후보를 몇 개 주든
  // 전부 같은 값으로 돌아, 비교 자체가 성립하지 않는다.
  it('명시한 값이 활성 행을 이긴다', async () => {
    repository.findActiveParameters.mockResolvedValue([
      {
        name: 'MINIMUM_TURNOVER60',
        value: 300_000_000,
        version: 2,
        reason: 'r',
      },
      { name: 'MAXIMUM_WEIGHT_PERCENT', value: 12.5, version: 2, reason: 'r' },
    ]);

    const resolved = await usecase.execute('SWING', {
      minimumTurnover60: 100_000_000,
      maximumWeightPercent: 30,
    });

    expect(resolved.minimumTurnover60).toBe(100_000_000);
    expect(resolved.maximumWeightPercent).toBe(30);
  });

  // 값 하나만 명시했을 때 나머지가 상수로 되돌아가면, 활성 행이 조용히 무시된다.
  it('명시하지 않은 자리는 활성 행이 그대로 남는다', async () => {
    repository.findActiveParameters.mockResolvedValue([
      {
        name: 'MINIMUM_TURNOVER60',
        value: 300_000_000,
        version: 2,
        reason: 'r',
      },
    ]);

    const resolved = await usecase.execute('SWING', {
      maximumWeightPercent: 30,
    });

    expect(resolved.minimumTurnover60).toBe(300_000_000);
    expect(resolved.maximumWeightPercent).toBe(30);
  });

  // 파라미터를 못 읽어 그날 회차가 통째로 사라지는 것이, 값이 하루 옛것인 것보다 나쁘다.
  it('조회가 실패해도 예외를 던지지 않고 코드 상수로 진행한다', async () => {
    repository.findActiveParameters.mockRejectedValue(
      new Error('connection refused'),
    );

    const resolved = await usecase.execute('SWING');

    expect(resolved.minimumTurnover60).toBe(
      STRATEGY_PARAMETER_FALLBACKS.MINIMUM_TURNOVER60,
    );
    expect(resolved.exitBand.takeProfitPercent).toBe(
      STRATEGY_PARAMETER_FALLBACKS.EXIT_TAKE_PROFIT_PERCENT,
    );
  });

  // 0 은 유효한 값이다. `??` 대신 `||` 로 채우면 0 이 상수로 되돌아간다.
  it('활성 행 값이 0 이어도 상수로 되돌리지 않는다', async () => {
    repository.findActiveParameters.mockResolvedValue([
      { name: 'MAXIMUM_WEIGHT_PERCENT', value: 0, version: 3, reason: 'r' },
    ]);

    const resolved = await usecase.execute('SWING');

    expect(resolved.maximumWeightPercent).toBe(0);
  });
});
