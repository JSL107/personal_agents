import { Injectable } from '@nestjs/common';

import { BuildWeeklyInsightReportUsecase } from '../../../instagram/application/build-weekly-insight-report.usecase';
import {
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 월요일 아침 스킬쟁이 릴스 주간 리포트. 숫자만 보여 주고 판단은 사람이 한다.
@Injectable()
export class ReelsInsightsWeeklyAutopilotTask implements AutopilotTask {
  readonly id = 'reels-insights-weekly';

  constructor(private readonly buildReport: BuildWeeklyInsightReportUsecase) {}

  async run(): Promise<AutopilotTaskResult> {
    const report = await this.buildReport.execute();
    if (!report) {
      return { skip: true };
    }
    return { skip: false, summaryText: report };
  }
}
