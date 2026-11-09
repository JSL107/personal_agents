import { Injectable } from '@nestjs/common';

import { DecideReelsFormatUsecase } from '../../../instagram/application/decide-reels-format.usecase';
import {
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class ReelsFormatDecideAutopilotTask implements AutopilotTask {
  readonly id = 'reels-format-decide';

  constructor(private readonly decideReelsFormat: DecideReelsFormatUsecase) {}

  async run(): Promise<AutopilotTaskResult> {
    const report = await this.decideReelsFormat.execute();
    if (!report) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: report.text,
      onDelivered: async () => {
        await this.decideReelsFormat.markReported(report.reportedIds);
      },
    };
  }
}
