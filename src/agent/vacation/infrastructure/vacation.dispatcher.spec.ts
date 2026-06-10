import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { CalculateBalanceUsecase } from '../application/calculate-balance.usecase';
import { CancelLeaveUsecase } from '../application/cancel-leave.usecase';
import { ListUsageUsecase } from '../application/list-usage.usecase';
import { RegisterLeaveUsecase } from '../application/register-leave.usecase';
import { VacationDispatcher } from './vacation.dispatcher';

const balanceResult = {
  hireDate: { year: 2024, month: 1, day: 15 },
  asOf: { year: 2026, month: 6, day: 10 },
  periodStart: { year: 2026, month: 1, day: 15 },
  periodEnd: { year: 2027, month: 1, day: 14 },
  grantedDays: 15,
  usedDays: 5,
  remainingDays: 10,
  usagesInPeriod: [],
};

describe('VacationDispatcher', () => {
  it('자연어 BALANCE → 잔여 조회 + formattedText', async () => {
    const route = jest.fn().mockResolvedValue({
      text: '{"action":"BALANCE"}',
      modelUsed: 'codex-cli',
      provider: 'CHATGPT',
    });
    const calcExecute = jest.fn().mockResolvedValue({
      agentRunId: 7,
      modelUsed: 'deterministic',
      result: balanceResult,
    });
    const dispatcher = new VacationDispatcher(
      { route } as unknown as ModelRouterUsecase,
      { execute: calcExecute } as unknown as CalculateBalanceUsecase,
      {} as RegisterLeaveUsecase,
      {} as ListUsageUsecase,
      {} as CancelLeaveUsecase,
    );
    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '휴가 며칠 남았어?',
    });
    expect(route).toHaveBeenCalled();
    expect(calcExecute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      asOf: expect.any(Object),
    });
    expect(outcome.formattedText).toContain('잔여');
    expect(outcome.agentRunId).toBe(7);
  });

  it('자연어 REGISTER → 등록 usecase 호출', async () => {
    const route = jest.fn().mockResolvedValue({
      text: '{"action":"REGISTER","startDate":"2026-07-01","endDate":"2026-07-03"}',
      modelUsed: 'codex-cli',
      provider: 'CHATGPT',
    });
    const registerExecute = jest.fn().mockResolvedValue({
      agentRunId: 8,
      modelUsed: 'deterministic',
      result: {
        registered: {
          id: 10,
          slackUserId: 'U1',
          startDate: { year: 2026, month: 7, day: 1 },
          endDate: { year: 2026, month: 7, day: 3 },
          businessDays: 3,
          memo: null,
          createdAt: new Date(),
        },
        balance: balanceResult,
      },
    });
    const dispatcher = new VacationDispatcher(
      { route } as unknown as ModelRouterUsecase,
      {} as CalculateBalanceUsecase,
      { execute: registerExecute } as unknown as RegisterLeaveUsecase,
      {} as ListUsageUsecase,
      {} as CancelLeaveUsecase,
    );
    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '7월 1일부터 3일까지 휴가 썼어',
    });
    expect(registerExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'U1',
        startDate: { year: 2026, month: 7, day: 1 },
        endDate: { year: 2026, month: 7, day: 3 },
      }),
    );
    expect(outcome.formattedText).toContain('등록');
  });
});
