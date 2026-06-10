import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { VacationException } from '../domain/vacation.exception';
import { LeaveUsageRepository } from '../infrastructure/leave-usage.repository';
import { CancelLeaveUsecase } from './cancel-leave.usecase';

describe('CancelLeaveUsecase', () => {
  let configGet: jest.Mock;
  let softCancel: jest.Mock;
  let findActiveByUser: jest.Mock;
  let execute: jest.Mock;
  let usecase: CancelLeaveUsecase;

  beforeEach(() => {
    configGet = jest.fn().mockReturnValue('2024-01-15');
    softCancel = jest.fn().mockResolvedValue(true);
    findActiveByUser = jest.fn().mockResolvedValue([]);
    execute = jest.fn(async (input) => {
      const r = await input.run({ agentRunId: 9 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 9 };
    });
    usecase = new CancelLeaveUsecase(
      { get: configGet } as unknown as ConfigService,
      { softCancel, findActiveByUser } as unknown as LeaveUsageRepository,
      { execute } as unknown as AgentRunService,
      () => new Date('2026-06-10T00:00:00.000Z'),
    );
  });

  it('존재하지 않거나 남의 것이면 USAGE_NOT_FOUND', async () => {
    softCancel.mockResolvedValue(false);
    await expect(
      usecase.execute({
        slackUserId: 'U1',
        usageId: 99,
        asOf: { year: 2026, month: 6, day: 10 },
      }),
    ).rejects.toBeInstanceOf(VacationException);
  });

  it('취소 성공 시 갱신 잔여 반환', async () => {
    const result = await usecase.execute({
      slackUserId: 'U1',
      usageId: 10,
      asOf: { year: 2026, month: 6, day: 10 },
    });
    expect(softCancel).toHaveBeenCalled();
    expect(result.result.canceledId).toBe(10);
  });
});

describe('CancelLeaveUsecase DI', () => {
  it('Nest 가 now 파라미터 주입 없이 provider 를 resolve 한다 (@Optional)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CancelLeaveUsecase,
        { provide: ConfigService, useValue: { get: () => '2024-01-15' } },
        { provide: LeaveUsageRepository, useValue: {} },
        { provide: AgentRunService, useValue: {} },
      ],
    }).compile();
    expect(moduleRef.get(CancelLeaveUsecase)).toBeDefined();
  });
});
