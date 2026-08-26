import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  STRATEGY_PARAMETER_PORT,
  StrategyParameterPort,
} from '../domain/port/strategy-parameter.port';
import {
  ResolvedStrategyParameters,
  STRATEGY_PARAMETER_FALLBACKS,
  StrategyParameterName,
  StrategyParameterStrategy,
} from '../domain/strategy-parameter.type';

/**
 * 호출부가 명시한 값. CLI 인자가 여기로 들어온다.
 *
 * 전부 optional 이고, `undefined` 는 "명시하지 않음" 이다. 파서가 기본값을 박아 넣으면
 * 미지정과 "우연히 기본값과 같은 값을 명시" 가 구분되지 않아, 탐색기가 후보를 몇 개 주든
 * 전부 같은 값으로 돌게 된다.
 */
export interface StrategyParameterOverrides {
  takeProfitPercent?: number;
  stopLossPercent?: number;
  minimumTurnover60?: number;
  maximumWeightPercent?: number;
}

@Injectable()
export class ResolveStrategyParametersUsecase {
  private readonly logger = new Logger(ResolveStrategyParametersUsecase.name);

  constructor(
    @Inject(STRATEGY_PARAMETER_PORT)
    private readonly repository: StrategyParameterPort,
  ) {}

  /**
   * 이 전략이 쓸 값 한 벌을 고른다. 순서는 `override > DB 활성 행 > 코드 상수` 다.
   *
   * 조회가 실패해도 예외를 던지지 않는다 — 파라미터를 못 읽어 그날 추천 회차가 통째로
   * 사라지는 것이 값이 하루 옛것인 것보다 나쁘다. 실패는 경고로 남기고 상수로 진행한다.
   */
  async execute(
    strategy: StrategyParameterStrategy,
    overrides: StrategyParameterOverrides = {},
  ): Promise<ResolvedStrategyParameters> {
    const stored = await this.loadStoredValues(strategy);
    const pick = (
      name: StrategyParameterName,
      override: number | undefined,
    ): number => {
      if (override !== undefined) {
        return override;
      }
      return stored.get(name) ?? STRATEGY_PARAMETER_FALLBACKS[name];
    };

    return {
      exitBand: {
        takeProfitPercent: pick(
          'EXIT_TAKE_PROFIT_PERCENT',
          overrides.takeProfitPercent,
        ),
        stopLossPercent: pick(
          'EXIT_STOP_LOSS_PERCENT',
          overrides.stopLossPercent,
        ),
      },
      minimumTurnover60: pick(
        'MINIMUM_TURNOVER60',
        overrides.minimumTurnover60,
      ),
      maximumWeightPercent: pick(
        'MAXIMUM_WEIGHT_PERCENT',
        overrides.maximumWeightPercent,
      ),
    };
  }

  private async loadStoredValues(
    strategy: StrategyParameterStrategy,
  ): Promise<Map<StrategyParameterName, number>> {
    try {
      const active = await this.repository.findActiveParameters(strategy);
      return new Map(
        active.map((parameter) => [parameter.name, parameter.value]),
      );
    } catch (error) {
      this.logger.warn(
        `파라미터 조회 실패, 코드 상수로 진행 (${strategy}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return new Map();
    }
  }
}
