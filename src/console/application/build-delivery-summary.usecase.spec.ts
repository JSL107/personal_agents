import { SlackDeliveryRepositoryPort } from '../../slack/domain/port/slack-delivery.repository.port';
import { BuildDeliverySummaryUsecase } from './build-delivery-summary.usecase';

describe('BuildDeliverySummaryUsecase', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('기간을 보정해 그 기간의 원장 행을 요약한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T00:00:00.000Z'));
    const repository = { findSince: jest.fn().mockResolvedValue([]) };
    const usecase = new BuildDeliverySummaryUsecase(
      repository as unknown as SlackDeliveryRepositoryPort,
    );

    const result = await usecase.execute(120);

    expect(repository.findSince).toHaveBeenCalledWith(
      new Date('2026-07-10T00:00:00.000Z'),
    );
    expect(result.days).toBe(90);
    expect(result.totals.sent).toBe(0);
  });
});
