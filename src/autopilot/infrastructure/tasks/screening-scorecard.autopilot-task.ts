import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BuildScreeningScorecardUsecase } from '../../../screener/application/build-screening-scorecard.usecase';
import {
  formatScreeningScorecard,
  formatScreeningScorecardDetail,
} from '../../../screener/infrastructure/screening-scorecard.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 주간 성적 카드 — 회차에 실린 종목을 "산 것 / 안 산 것" 으로 갈라 보여준다.
// 학습 없이 사실만 낸다: 값을 고치거나 규칙을 제안하지 않는다.
//
// 채점(`screening-outcome-scoring`, 평일 19:00)이 쌓아 둔 것을 읽기만 하므로 순서 의존이
// 없다. 모의투자 게이트를 따르는 이유는 대조군 판정이 `paper_order` 에 의존해서다 —
// 모의투자가 꺼져 있으면 "산 것" 이 전건 0 이 되어 카드가 비교가 아니라 목록이 된다.
@Injectable()
export class ScreeningScorecardAutopilotTask implements AutopilotTask {
  readonly id = 'screening-scorecard';

  constructor(
    private readonly usecase: BuildScreeningScorecardUsecase,
    private readonly configService: ConfigService,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const enabled = this.configService.get<string>('PAPER_TRADING_ENABLED');
    if (enabled !== 'true') {
      return { skip: true };
    }

    const result = await this.usecase.execute({
      asOf: new Date(`${context.firedAtKst}T00:00:00.000Z`),
    });
    // 어느 지평에도 표본이 없으면 보낼 사실이 없다. 지평별 "표본 없음" 은 다른 지평에
    // 표본이 있을 때 그 축이 비었다는 것을 알리는 용도이고, 전건이 비었으면 카드 자체가
    // 빈 알림이다.
    const scored = result.horizons.filter((horizon) => horizon.sampleCount > 0);
    if (scored.length === 0) {
      return { skip: true };
    }

    return {
      skip: false,
      summaryText: formatScreeningScorecard(result),
      detailText: formatScreeningScorecardDetail(result) ?? undefined,
    };
  }
}
