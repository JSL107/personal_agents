import { ListApplicationsUsecase } from './list-applications.usecase';

describe('ListApplicationsUsecase', () => {
  it('repository.listByUser 직접 반환 (AgentRun 미사용)', async () => {
    const records = [{ id: 1, company: '토스', role: '백엔드' }];
    const repository = {
      listByUser: jest.fn().mockResolvedValue(records),
    };
    const usecase = new ListApplicationsUsecase(repository as never);

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result).toBe(records);
    expect(repository.listByUser).toHaveBeenCalledWith('U1');
  });
});
