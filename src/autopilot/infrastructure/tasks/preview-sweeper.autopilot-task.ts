import { Injectable } from '@nestjs/common';

import { ExpirePreviewsUsecase } from '../../../preview-gate/application/expire-previews.usecase';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 매시간 — 만료된 PENDING preview 카드를 EXPIRED 로 정리(버튼 제거). run-sweeper 대칭 구조.
@Injectable()
export class PreviewSweeperAutopilotTask implements AutopilotTask {
  readonly id = 'preview-sweeper';

  constructor(private readonly expirePreviews: ExpirePreviewsUsecase) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    const swept = await this.expirePreviews.execute({ now: new Date() });
    if (swept === 0) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: `🧹 *만료 카드 정리* — 승인 없이 만료된 승인 카드 ${swept}건의 버튼을 제거`,
    };
  }
}
