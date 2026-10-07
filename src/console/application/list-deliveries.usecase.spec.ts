import { SlackDeliveryRepositoryPort } from '../../slack/domain/port/slack-delivery.repository.port';
import { ListDeliveriesUsecase } from './list-deliveries.usecase';

describe('ListDeliveriesUsecase', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('기간과 행 제한을 보정하고 최신 목록 조회 계약을 전달한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T00:00:00.000Z'));
    const items = [{ id: 'delivery-1' }];
    const repository = { findByStatus: jest.fn().mockResolvedValue(items) };
    const usecase = new ListDeliveriesUsecase(
      repository as unknown as SlackDeliveryRepositoryPort,
    );

    const result = await usecase.execute({
      status: 'SUPPRESSED',
      days: 0,
      limit: 300,
    });

    expect(repository.findByStatus).toHaveBeenCalledWith({
      status: 'SUPPRESSED',
      since: new Date('2026-10-07T00:00:00.000Z'),
      limit: 200,
    });
    expect(result).toEqual({
      status: 'SUPPRESSED',
      days: 1,
      limit: 200,
      items,
    });
  });
});
