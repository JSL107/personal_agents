import { ParameterSnapshot } from '../../../param-tune/domain/param-tune.type';
import {
  ActivateNewVersionInput,
  ActivateNewVersionResult,
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

  /**
   * 네 축의 활성 행을 `STRATEGY_PARAMETER_NAMES` 순서로 읽는다. 하나라도 없으면
   * `StrategyParameterSnapshotError` — fallback 으로 메우지 않고, 조회 예외도 그대로 전파한다.
   */
  findSnapshotStrict(
    strategy: StrategyParameterStrategy,
  ): Promise<ParameterSnapshot>;

  /**
   * 활성 값을 바꾸는 유일한 경로. 한 트랜잭션 안에서 네 축을 다시 읽어 `expectedSnapshot` 과
   * `(parameterId, version)` 이 전부 같을 때만 대상 행을 내리고 새 버전을 올린다.
   * 다르거나 동시 쓰기와 부딪치면 `CONFLICT`.
   */
  activateNewVersion(
    input: ActivateNewVersionInput,
  ): Promise<ActivateNewVersionResult>;
}
