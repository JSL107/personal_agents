import {
  STRATEGY_PARAMETER_FALLBACKS,
  StrategyParameterSeed,
  StrategyParameterStrategy,
} from './strategy-parameter.type';

const SEED_STRATEGIES: StrategyParameterStrategy[] = ['LONG_TERM', 'SWING'];

/**
 * 이름마다 "이 값이 왜 지금 값인가" 의 근거. 초기 행이 이유 없이 들어가면 처음 바꿀 때
 * 무엇을 되돌리는 것인지 알 수 없다.
 */
const SEED_REASONS = {
  EXIT_TAKE_PROFIT_PERCENT:
    '2026-08-21 청산 밴드 실측(PR #361)에서 +10/-5 를 골랐고, 2026-08-25 재측정에서도 현행 유지. docs/superpowers/specs/2026-08-21-exit-band-measurement.md',
  EXIT_STOP_LOSS_PERCENT:
    '2026-08-21 청산 밴드 실측(PR #361)에서 +10/-5 를 골랐고, 2026-08-25 재측정에서도 현행 유지. docs/superpowers/specs/2026-08-21-exit-band-measurement.md',
  MINIMUM_TURNOVER60:
    'SCREENER_RULE_VERSION 2 의 거래대금 60일 평균 하한. 2026-08-25 재측정에서 표본 내 후보(3억)가 표본 밖에서 재현되지 않아 현행 유지. docs/superpowers/specs/2026-08-25-backtest-remeasurement.md',
  MAXIMUM_WEIGHT_PERCENT:
    '비중을 언어모델에서 떼어낸 PR #328 의 상한 배정값. 최대 3종 x 20%.',
} as const;

/**
 * 초기 씨앗. **값은 전부 코드 상수와 같다** — 이 테이블이 생긴다고 운영 값이 바뀌면
 * "값을 옮긴 것" 과 "값을 바꾼 것" 이 한 회차에 섞여 성적 변화의 원인을 가릴 수 없다.
 *
 * 두 전략에 같은 값을 넣는다. 지금 세 값은 전역이지만 재측정은 전략별로 재고 있어,
 * 전역 한 행으로 두면 전략별로 가르는 순간 행 구조를 다시 만들어야 한다.
 */
export const STRATEGY_PARAMETER_SEEDS: StrategyParameterSeed[] =
  SEED_STRATEGIES.flatMap((strategy) =>
    (Object.keys(SEED_REASONS) as Array<keyof typeof SEED_REASONS>).map(
      (name) => ({
        strategy,
        name,
        value: STRATEGY_PARAMETER_FALLBACKS[name],
        reason: SEED_REASONS[name],
      }),
    ),
  );
