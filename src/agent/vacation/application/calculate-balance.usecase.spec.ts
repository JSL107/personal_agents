import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { VacationException } from '../domain/vacation.exception';
import { LeaveUsagePrismaRepository } from '../infrastructure/leave-usage.prisma.repository';
import { CalculateBalanceUsecase } from './calculate-balance.usecase';

// 키별 설정값 — 키를 가리지 않고 같은 값을 돌려주면 선지급 일수 자리에 입사일 문자열이 들어간다.
const configFor =
  (values: Record<string, unknown> = {}) =>
  (key: string): unknown =>
    ({ VACATION_HIRE_DATE: '2024-01-15', ...values })[key];

describe('CalculateBalanceUsecase', () => {
  let configGet: jest.Mock;
  let findActiveByUser: jest.Mock;
  let execute: jest.Mock;
  let usecase: CalculateBalanceUsecase;

  beforeEach(() => {
    configGet = jest.fn(configFor());
    findActiveByUser = jest.fn().mockResolvedValue([
      {
        id: 1,
        slackUserId: 'U1',
        startDate: { year: 2026, month: 3, day: 2 },
        endDate: { year: 2026, month: 3, day: 6 },
        businessDays: 5,
        memo: null,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]);
    execute = jest.fn(async (input) => {
      const r = await input.run({ agentRunId: 7 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 7 };
    });
    usecase = new CalculateBalanceUsecase(
      { get: configGet } as unknown as ConfigService,
      { findActiveByUser } as unknown as LeaveUsagePrismaRepository,
      { execute } as unknown as AgentRunService,
    );
  });

  it('VACATION_HIRE_DATE 미설정 시 HIRE_DATE_NOT_CONFIGURED', async () => {
    configGet.mockReturnValue(undefined);
    await expect(
      usecase.execute({
        slackUserId: 'U1',
        asOf: { year: 2026, month: 6, day: 10 },
      }),
    ).rejects.toBeInstanceOf(VacationException);
    expect(findActiveByUser).not.toHaveBeenCalled();
  });

  it('현재 회기 잔여 계산 (부여 15, 사용 5 → 잔여 10)', async () => {
    const result = await usecase.execute({
      slackUserId: 'U1',
      asOf: { year: 2026, month: 6, day: 10 },
    });
    expect(result.result.grantedDays).toBe(15);
    expect(result.result.usedDays).toBe(5);
    expect(result.result.remainingDays).toBe(10);
  });

  it('1년차 선지급 설정 시 부여는 선지급 일수로 고정 (월 발생분 6일 대신 8일)', async () => {
    configGet.mockImplementation(
      configFor({
        VACATION_HIRE_DATE: '2026-04-06',
        VACATION_FIRST_YEAR_ADVANCE_DAYS: 8,
      }),
    );
    const result = await usecase.execute({
      slackUserId: 'U1',
      asOf: { year: 2026, month: 10, day: 7 },
    });
    expect(result.result.grantedDays).toBe(8);
    expect(result.result.remainingDays).toBe(8);
  });

  it('선지급 설정은 2년차 이후 부여(15일)에 영향을 주지 않는다', async () => {
    configGet.mockImplementation(
      configFor({ VACATION_FIRST_YEAR_ADVANCE_DAYS: 8 }),
    );
    const result = await usecase.execute({
      slackUserId: 'U1',
      asOf: { year: 2026, month: 6, day: 10 },
    });
    expect(result.result.grantedDays).toBe(15);
  });

  it('결정론 경로라 modelUsed=deterministic 로 audit', async () => {
    await usecase.execute({
      slackUserId: 'U1',
      asOf: { year: 2026, month: 6, day: 10 },
    });
    const call = execute.mock.calls[0][0];
    expect(call.agentType).toBe('VACATION');
    expect(call.triggerType).toBe('SLACK_COMMAND_VACATION');
    const runResult = await call.run({ agentRunId: 1 });
    expect(runResult.modelUsed).toBe('deterministic');
  });
});
