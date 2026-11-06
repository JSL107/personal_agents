import { CollectInsightsUsecase } from '../../../instagram/application/collect-insights.usecase';
import { ReelsInsightsCollectAutopilotTask } from './reels-insights-collect.autopilot-task';

describe('ReelsInsightsCollectAutopilotTask', () => {
  it('수집 결과와 무관하게 Slack 으로 보내지 않는다', async () => {
    const execute = jest.fn().mockResolvedValue({
      inserted: 2,
      skipped: 0,
      failed: 1,
      featuresFilled: 1,
    });
    const task = new ReelsInsightsCollectAutopilotTask({
      execute,
    } as unknown as CollectInsightsUsecase);

    await expect(task.run()).resolves.toEqual({ skip: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('수집이 던져도 슬롯을 실패시키지 않는다', async () => {
    const task = new ReelsInsightsCollectAutopilotTask({
      execute: jest.fn().mockRejectedValue(new Error('db down')),
    } as unknown as CollectInsightsUsecase);

    await expect(task.run()).resolves.toEqual({ skip: true });
  });
});
