import { HarvestReviewSignalsUsecase } from '../../../pr-review-loop/application/harvest-review-signals.usecase';
import { SweepPrReviewsUsecase } from '../../../pr-review-loop/application/sweep-pr-reviews.usecase';
import { PrReviewSweepAutopilotTask } from './pr-review-sweep.autopilot-task';

const CONTEXT = { ownerSlackUserId: 'U123', firedAtKst: '2026-07-31' };

describe('PrReviewSweepAutopilotTask', () => {
  let harvestUsecase: jest.Mocked<Pick<HarvestReviewSignalsUsecase, 'execute'>>;
  let sweepUsecase: jest.Mocked<Pick<SweepPrReviewsUsecase, 'execute'>>;
  let task: PrReviewSweepAutopilotTask;

  beforeEach(() => {
    harvestUsecase = {
      execute: jest.fn().mockResolvedValue({
        acked: 0,
        fixed: 0,
        rejected: 0,
        stale: 0,
        resolved: 0,
        judged: 0,
        skipped: 0,
        adoption: [],
      }),
    };
    sweepUsecase = { execute: jest.fn() };
    task = new PrReviewSweepAutopilotTask(
      harvestUsecase as unknown as HarvestReviewSignalsUsecase,
      sweepUsecase as unknown as SweepPrReviewsUsecase,
    );
  });

  it('id 는 pr-review-sweep', () => {
    expect(task.id).toBe('pr-review-sweep');
  });

  it('결과가 없으면 skip — 15분마다 빈 알림을 보내지 않는다', async () => {
    sweepUsecase.execute.mockResolvedValue([]);

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('결과가 있으면 요약을 summaryText 로 낸다', async () => {
    sweepUsecase.execute.mockResolvedValue([
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

  it('수확을 리뷰 스윕보다 먼저 실행한다', async () => {
    const callOrder: string[] = [];
    harvestUsecase.execute.mockImplementation(async () => {
      callOrder.push('harvest');
      return {
        acked: 0,
        fixed: 0,
        rejected: 0,
        stale: 0,
        resolved: 0,
        judged: 0,
        skipped: 0,
        adoption: [],
      };
    });
    sweepUsecase.execute.mockImplementation(async () => {
      callOrder.push('sweep');
      return [];
    });

    await task.run(CONTEXT);

    expect(callOrder).toEqual(['harvest', 'sweep']);
  });

  it('리뷰 결과가 없어도 수확 결과가 있으면 알림을 만든다', async () => {
    harvestUsecase.execute.mockResolvedValue({
      acked: 2,
      rejected: 1,
      fixed: 1,
      stale: 0,
      resolved: 3,
      judged: 0,
      skipped: 0,
      adoption: [
        {
          category: 'TEST',
          adopted: 16,
          rejected: 1,
          total: 17,
          ratePercent: 94,
        },
      ],
    });
    sweepUsecase.execute.mockResolvedValue([]);

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('👍 2');
    expect(result.summaryText).toContain('👎 1');
    // 수확 결과와 함께 누적 채택률도 요약에 실린다.
    expect(result.summaryText).toContain('TEST 94%(17)');
  });

  it('수확 실패는 경고만 남기고 리뷰 스윕을 계속한다', async () => {
    harvestUsecase.execute.mockRejectedValue(new Error('harvest down'));
    sweepUsecase.execute.mockResolvedValue([
      {
        prRef: 'a/b#1',
        riskLevel: 'low',
        outcome: {
          inline: 1,
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
    expect(sweepUsecase.execute).toHaveBeenCalledTimes(1);
    expect(result.summaryText).toContain('a/b#1');
  });

  it('판정·미결 카운터만 있으면 상태 전이가 아니므로 알림을 생략한다', async () => {
    harvestUsecase.execute.mockResolvedValue({
      acked: 0,
      fixed: 0,
      rejected: 0,
      stale: 0,
      resolved: 0,
      judged: 2,
      skipped: 1,
      adoption: [],
    });
    sweepUsecase.execute.mockResolvedValue([]);

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });
});
