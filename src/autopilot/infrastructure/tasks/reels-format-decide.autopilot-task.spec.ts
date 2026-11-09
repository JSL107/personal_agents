import { DecideReelsFormatUsecase } from '../../../instagram/application/decide-reels-format.usecase';
import { ReelsFormatDecideAutopilotTask } from './reels-format-decide.autopilot-task';

describe('ReelsFormatDecideAutopilotTask', () => {
  it('보고가 있으면 별도 요약을 보내고 발송 성공 뒤 해당 행을 표시한다', async () => {
    const execute = jest.fn().mockResolvedValue({
      text: '형식 실험 판정',
      reportedIds: ['decision-1'],
    });
    const markReported = jest.fn().mockResolvedValue(undefined);
    const task = new ReelsFormatDecideAutopilotTask({
      execute,
      markReported,
    } as unknown as DecideReelsFormatUsecase);

    const result = await task.run();

    expect(result.skip).toBe(false);
    expect(result.summaryText).toBe('형식 실험 판정');
    expect(markReported).not.toHaveBeenCalled();
    await result.onDelivered?.();
    expect(markReported).toHaveBeenCalledWith(['decision-1']);
  });

  it('보고할 것이 없으면 발송을 건너뛴다', async () => {
    const markReported = jest.fn();
    const task = new ReelsFormatDecideAutopilotTask({
      execute: jest.fn().mockResolvedValue(null),
      markReported,
    } as unknown as DecideReelsFormatUsecase);

    await expect(task.run()).resolves.toEqual({ skip: true });
    expect(markReported).not.toHaveBeenCalled();
  });
});
