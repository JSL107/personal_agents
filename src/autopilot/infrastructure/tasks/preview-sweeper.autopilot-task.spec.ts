import { ExpirePreviewsUsecase } from '../../../preview-gate/application/expire-previews.usecase';
import { PreviewSweeperAutopilotTask } from './preview-sweeper.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-07-01' };

describe('PreviewSweeperAutopilotTask', () => {
  it('만료 0건이면 skip', async () => {
    const usecase = { execute: jest.fn().mockResolvedValue(0) };
    const task = new PreviewSweeperAutopilotTask(
      usecase as unknown as ExpirePreviewsUsecase,
    );

    await expect(task.run(context)).resolves.toEqual({ skip: true });
  });

  it('만료 N건이면 요약 발송', async () => {
    const usecase = { execute: jest.fn().mockResolvedValue(3) };
    const task = new PreviewSweeperAutopilotTask(
      usecase as unknown as ExpirePreviewsUsecase,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('3건');
  });
});
