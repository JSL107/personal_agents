import { Injectable, Logger } from '@nestjs/common';

import { CollectInsightsUsecase } from '../../../instagram/application/collect-insights.usecase';
import {
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 게시된 릴스·스토리의 인사이트를 시점별로 찍는다. 사람에게 보내지 않는다(주간 리포트가 보여 준다).
// 던지지 않는다. 산출물 없는 슬롯이 실패하면 60초 뒤 재시도로 같은 수집이 겹친다.
@Injectable()
export class ReelsInsightsCollectAutopilotTask implements AutopilotTask {
  readonly id = 'reels-insights-collect';
  private readonly logger = new Logger(ReelsInsightsCollectAutopilotTask.name);

  constructor(private readonly collectInsights: CollectInsightsUsecase) {}

  async run(): Promise<AutopilotTaskResult> {
    try {
      const summary = await this.collectInsights.execute();
      if (summary.inserted + summary.failed + summary.featuresFilled > 0) {
        this.logger.log(
          `인사이트 수집: 저장 ${summary.inserted} · 중복 ${summary.skipped} · 실패 ${summary.failed} · 특성 ${summary.featuresFilled}`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`인사이트 수집 실패: ${reason}`);
    }
    return { skip: true };
  }
}
