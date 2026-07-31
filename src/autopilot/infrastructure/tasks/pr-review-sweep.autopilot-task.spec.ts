import { SweepPrReviewsUsecase } from '../../../pr-review-loop/application/sweep-pr-reviews.usecase';
import { PrReviewSweepAutopilotTask } from './pr-review-sweep.autopilot-task';

const CONTEXT = { ownerSlackUserId: 'U123', firedAtKst: '2026-07-31' };

describe('PrReviewSweepAutopilotTask', () => {
  let usecase: jest.Mocked<Pick<SweepPrReviewsUsecase, 'execute'>>;
  let task: PrReviewSweepAutopilotTask;

  beforeEach(() => {
    usecase = { execute: jest.fn() };
    task = new PrReviewSweepAutopilotTask(
      usecase as unknown as SweepPrReviewsUsecase,
    );
  });

  it('id 는 pr-review-sweep', () => {
    expect(task.id).toBe('pr-review-sweep');
  });

  it('결과가 없으면 skip — 15분마다 빈 알림을 보내지 않는다', async () => {
    usecase.execute.mockResolvedValue([]);

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('결과가 있으면 요약을 summaryText 로 낸다', async () => {
    usecase.execute.mockResolvedValue([
      {
        prRef: 'JSL107/personal_agents#180',
        riskLevel: 'high',
        outcome: {
          inline: 2,
          file: 0,
          issueComment: 0,
          dryRun: 0,
          notPosted: 0,
          dropped: 0,
          duplicate: 0,
        },
      },
    ]);

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('JSL107/personal_agents#180');
    expect(result.summaryText).toContain('인라인 2');
  });
});
