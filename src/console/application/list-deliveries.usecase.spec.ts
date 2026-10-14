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

  // 빈 결과(EMPTY)가 콘솔 보고서와 같은 SUPPRESSED 로 쌓이므로, 사유는 limit 보다 먼저
  // 저장소 조회 조건으로 내려가야 다른 사유의 행이 한도를 차지하지 않는다.
  it('억제 사유가 오면 저장소 조회 조건으로 넘긴다', async () => {
    const repository = { findByStatus: jest.fn().mockResolvedValue([]) };
    const usecase = new ListDeliveriesUsecase(
      repository as unknown as SlackDeliveryRepositoryPort,
    );

    await usecase.execute({
      status: 'SUPPRESSED',
      suppressReason: 'CONSOLE_ROUTE',
      days: 14,
      limit: 200,
    });

    expect(repository.findByStatus).toHaveBeenCalledWith(
      expect.objectContaining({ suppressReason: 'CONSOLE_ROUTE', limit: 200 }),
    );
  });
});
