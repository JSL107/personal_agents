import {
  ActiveStrategyParameter,
  StrategyParameterStrategy,
} from '../strategy-parameter.type';

export const STRATEGY_PARAMETER_PORT = Symbol('STRATEGY_PARAMETER_PORT');

export interface StrategyParameterPort {
  /**
   * 이 전략의 활성 행을 전부 읽는다. `(strategy, name)` 당 최대 하나다.
   *
   * 활성 행이 없는 이름은 결과에서 빠진다 — 없는 것과 0 을 가르기 위해서다.
   * 채우는 것은 호출부의 fallback 이다.
   */
  findActiveParameters(
    strategy: StrategyParameterStrategy,
  ): Promise<ActiveStrategyParameter[]>;
}
