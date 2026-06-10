import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { VacationException } from '../domain/vacation.exception';
import { LeaveUsageRepository } from '../infrastructure/leave-usage.repository';
import { RegisterLeaveUsecase } from './register-leave.usecase';

describe('RegisterLeaveUsecase', () => {
  let configGet: jest.Mock;
  let save: jest.Mock;
  let findActiveByUser: jest.Mock;
  let execute: jest.Mock;
  let usecase: RegisterLeaveUsecase;

  beforeEach(() => {
    configGet = jest.fn().mockReturnValue('2024-01-15');
    save = jest.fn(async (input) => ({
      id: 10,
      slackUserId: input.slackUserId,
      startDate: input.startDate,
      endDate: input.endDate,
      businessDays: input.businessDays,
      memo: input.memo ?? null,
      createdAt: new Date('2026-06-10T00:00:00.000Z'),
    }));
    findActiveByUser = jest.fn().mockResolvedValue([]);
    execute = jest.fn(async (input) => {
      const r = await input.run({ agentRunId: 8 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 8 };
    });
    usecase = new RegisterLeaveUsecase(
      { get: configGet } as unknown as ConfigService,
      { save, findActiveByUser } as unknown as LeaveUsageRepository,
      { execute } as unknown as AgentRunService,
    );
  });

  it('영업일을 계산해 저장하고 갱신된 잔여 반환 (7/1~7/3 = 3영업일)', async () => {
    const result = await usecase.execute({
      slackUserId: 'U1',
      startDate: { year: 2026, month: 7, day: 1 },
      endDate: { year: 2026, month: 7, day: 3 },
      asOf: { year: 2026, month: 6, day: 10 },
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ businessDays: 3, slackUserId: 'U1' }),
    );
    expect(result.result.registered.businessDays).toBe(3);
    expect(findActiveByUser).toHaveBeenCalled();
  });

  it('범위 역전(start>end)은 VacationException, 저장 안 함', async () => {
    await expect(
      usecase.execute({
        slackUserId: 'U1',
        startDate: { year: 2026, month: 7, day: 3 },
        endDate: { year: 2026, month: 7, day: 1 },
        asOf: { year: 2026, month: 6, day: 10 },
      }),
    ).rejects.toBeInstanceOf(VacationException);
    expect(save).not.toHaveBeenCalled();
  });
});
