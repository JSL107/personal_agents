import { LeaveUsageRepository } from '../infrastructure/leave-usage.repository';
import { ListUsageUsecase } from './list-usage.usecase';

describe('ListUsageUsecase', () => {
  it('본인 활성 사용 내역을 반환', async () => {
    const records = [
      {
        id: 1,
        slackUserId: 'U1',
        startDate: { year: 2026, month: 3, day: 2 },
        endDate: { year: 2026, month: 3, day: 6 },
        businessDays: 5,
        memo: null,
        createdAt: new Date(),
      },
    ];
    const findActiveByUser = jest.fn().mockResolvedValue(records);
    const usecase = new ListUsageUsecase({
      findActiveByUser,
    } as unknown as LeaveUsageRepository);
    const result = await usecase.execute({ slackUserId: 'U1' });
    expect(findActiveByUser).toHaveBeenCalledWith('U1');
    expect(result).toEqual(records);
  });
});
