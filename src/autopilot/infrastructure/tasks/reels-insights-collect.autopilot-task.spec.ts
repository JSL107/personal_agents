import {
  CollectInsightsSummary,
  CollectInsightsUsecase,
} from '../../../instagram/application/collect-insights.usecase';
import { ReelsInsightsCollectAutopilotTask } from './reels-insights-collect.autopilot-task';

const SUCCESS: CollectInsightsSummary = {
  inserted: 2,
  skipped: 0,
  failed: 0,
  featuresFilled: 0,
};
const FAILURE: CollectInsightsSummary = {
  inserted: 0,
  skipped: 0,
  failed: 1,
  featuresFilled: 0,
};
const NOTHING_DUE: CollectInsightsSummary = {
  inserted: 0,
  skipped: 0,
  failed: 0,
  featuresFilled: 0,
};

const taskWith = (
  results: (CollectInsightsSummary | Error)[],
): ReelsInsightsCollectAutopilotTask => {
  const execute = jest.fn();
  for (const result of results) {
    if (result instanceof Error) {
      execute.mockRejectedValueOnce(result);
    } else {
      execute.mockResolvedValueOnce(result);
    }
  }
  return new ReelsInsightsCollectAutopilotTask({
    execute,
  } as unknown as CollectInsightsUsecase);
};

const runTimes = async ({
  task,
  times,
}: {
  task: ReelsInsightsCollectAutopilotTask;
  times: number;
}): Promise<void> => {
  for (let index = 0; index < times; index += 1) {
    await task.run();
  }
};

describe('ReelsInsightsCollectAutopilotTask', () => {
  it('성공한 회차는 Slack 으로 보내지 않는다', async () => {
    const task = taskWith([SUCCESS]);

    await expect(task.run()).resolves.toEqual({ skip: true });
  });

  it('실패가 두 회차 연속이면 아직 알리지 않는다', async () => {
    const task = taskWith([FAILURE, FAILURE]);

    await runTimes({ task, times: 1 });
    await expect(task.run()).resolves.toEqual({ skip: true });
  });

  it('실패가 세 회차 연속이면 알린다', async () => {
    const task = taskWith([FAILURE, new Error('db down'), FAILURE]);

    await runTimes({ task, times: 2 });
    const result = await task.run();

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('3회 연속');
  });

  it('찍을 것이 없던 회차는 연속 실패를 끊지도 늘리지도 않는다', async () => {
    const task = taskWith([FAILURE, NOTHING_DUE, FAILURE, FAILURE]);

    await runTimes({ task, times: 3 });
    const result = await task.run();

    expect(result.skip).toBe(false);
  });

  it('성공한 회차가 끼면 연속 실패를 처음부터 센다', async () => {
    const task = taskWith([FAILURE, FAILURE, SUCCESS, FAILURE, FAILURE]);

    await runTimes({ task, times: 4 });
    await expect(task.run()).resolves.toEqual({ skip: true });
  });

  it('수집이 던져도 슬롯을 실패시키지 않는다', async () => {
    const task = taskWith([new Error('db down')]);

    await expect(task.run()).resolves.toEqual({ skip: true });
  });
});
