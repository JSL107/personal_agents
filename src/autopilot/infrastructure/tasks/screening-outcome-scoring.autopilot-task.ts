import { Injectable } from '@nestjs/common';

import { ScoreScreeningOutcomesUsecase } from '../../../screener/application/score-screening-outcomes.usecase';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 회차에 실린 종목의 사후 성적을 매긴다. 지평이 찬 항목만 채점되므로 매일 돌면서
// 조금씩 쌓인다 — 5거래일치가 먼저 차고 20거래일치가 뒤따른다.
//
// 유니버스 시세 수집(18:30) 뒤에 돈다. 그 전에 돌면 그날 봉이 없어 전건이 미도래로
// 빠지고, 채점은 다음 회차로 밀린다.
@Injectable()
export class ScreeningOutcomeScoringAutopilotTask implements AutopilotTask {
  readonly id = 'screening-outcome-scoring';

  constructor(private readonly usecase: ScoreScreeningOutcomesUsecase) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    const result = await this.usecase.execute();
    if (result.totalScoredCount === 0) {
      return { skip: true };
    }

    // 지평별로 몇 건이 찼는지 남긴다. 합계만 적으면 5거래일만 돌고 20거래일은 한 번도
    // 안 찬 상태가 성공으로 보인다.
    const detail = result.horizons
      .filter((horizon) => horizon.scoredCount > 0)
      .map((horizon) => `${horizon.horizonDays}거래일 ${horizon.scoredCount}건`)
      .join(' · ');
    return {
      skip: false,
      summaryText: `스크리닝 사후 채점 — ${detail}`,
    };
  }
}
