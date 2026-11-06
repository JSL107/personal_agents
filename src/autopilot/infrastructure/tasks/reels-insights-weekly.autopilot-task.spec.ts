import { BuildWeeklyInsightReportUsecase } from '../../../instagram/application/build-weekly-insight-report.usecase';
import { ReelsInsightsWeeklyAutopilotTask } from './reels-insights-weekly.autopilot-task';

const taskWith = (report: string | null) =>
  new ReelsInsightsWeeklyAutopilotTask({
    execute: jest.fn().mockResolvedValue(report),
  } as unknown as BuildWeeklyInsightReportUsecase);

describe('ReelsInsightsWeeklyAutopilotTask', () => {
  it('리포트가 있으면 그대로 보낸다', async () => {
    await expect(taskWith('📊 리포트').run()).resolves.toEqual({
      skip: false,
      summaryText: '📊 리포트',
    });
  });

  it('지난주 게시가 없으면 보내지 않는다', async () => {
    await expect(taskWith(null).run()).resolves.toEqual({ skip: true });
  });
});
