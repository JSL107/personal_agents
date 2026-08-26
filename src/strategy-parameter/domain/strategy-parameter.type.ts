import { MAXIMUM_WEIGHT_PERCENT } from '../../agent/paper-recommend/domain/paper-recommendation.constraint';
import {
  DEFAULT_STOP_LOSS_PERCENT,
  DEFAULT_TAKE_PROFIT_PERCENT,
  ExitBandThreshold,
} from '../../paper-trading/domain/exit-band';
import { MINIMUM_TURNOVER60 } from '../../screener/domain/screener-rule';

export type StrategyParameterStrategy = 'LONG_TERM' | 'SWING';

/**
 * 조정 가능한 파라미터의 이름. 이 목록에 없는 값은 아직 코드 상수로만 존재한다.
 *
 * 보유일수와 최대 종목 수가 여기 없는 이유는 운영에 대응하는 동작이 없기 때문이다 —
 * 보유일수는 백테스트에만 있고(운영은 밴드로만 판다), 최대 종목 수는 상수가 아니라
 * 프롬프트 문자열이 정한다. 대응 없는 값을 테이블에 넣으면 "운영과 백테스트가 같은 값을
 * 읽는다" 는 이 테이블의 목적이 그 행에서만 거짓이 된다.
 */
export const STRATEGY_PARAMETER_NAMES = [
  'EXIT_TAKE_PROFIT_PERCENT',
  'EXIT_STOP_LOSS_PERCENT',
  'MINIMUM_TURNOVER60',
  'MAXIMUM_WEIGHT_PERCENT',
] as const;

export type StrategyParameterName = (typeof STRATEGY_PARAMETER_NAMES)[number];

/**
 * 테이블이 비었을 때 쓰는 값. 코드 상수를 지우지 않고 여기로 모아, 조회가 실패해도
 * 그날 회차가 지금 값으로 계속 돌게 한다.
 */
export const STRATEGY_PARAMETER_FALLBACKS: Record<
  StrategyParameterName,
  number
> = {
  EXIT_TAKE_PROFIT_PERCENT: DEFAULT_TAKE_PROFIT_PERCENT,
  EXIT_STOP_LOSS_PERCENT: DEFAULT_STOP_LOSS_PERCENT,
  MINIMUM_TURNOVER60,
  MAXIMUM_WEIGHT_PERCENT,
};

/**
 * 한 전략이 쓰는 값 한 벌. 운영과 백테스트가 이 형태를 함께 받는다.
 */
export interface ResolvedStrategyParameters {
  exitBand: ExitBandThreshold;
  minimumTurnover60: number;
  maximumWeightPercent: number;
}

/**
 * 활성 행 하나. `activatedAt` 이 있고 `supersededAt` 이 없는 행만 이 형태로 나온다.
 */
export interface ActiveStrategyParameter {
  name: StrategyParameterName;
  value: number;
  version: number;
  reason: string;
}

export interface StrategyParameterSeed {
  strategy: StrategyParameterStrategy;
  name: StrategyParameterName;
  value: number;
  reason: string;
}

export interface StrategyParameterSeedOutcome {
  // `전략.이름` 꼴. 무엇이 새로 들어갔고 무엇이 이미 있어 건너뛰었는지 그대로 보여준다 —
  // 건수만 세면 "0건 삽입" 이 정상 멱등인지 조회가 실패한 것인지 가려지지 않는다.
  inserted: string[];
  skipped: string[];
}
