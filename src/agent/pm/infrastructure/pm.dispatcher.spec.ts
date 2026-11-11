import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import { GenerateDailyPlanUsecase } from '../application/generate-daily-plan.usecase';
import { PmDispatcher } from './pm.dispatcher';

jest.mock('../../../slack/format/daily-plan.formatter', () => ({
  formatDailyPlan: () => ({ summary: 's', detail: 'd' }),
}));

describe('PmDispatcher', () => {
  const baseInput: DispatchInput = {
    source: 'SLACK_MESSAGE',
    slackUserId: 'U1',
    text: '오늘 할 일',
  };

  let execute: jest.Mock;
  let dispatcher: PmDispatcher;

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue({
      agentRunId: 1,
      result: { plan: {}, inputTruncation: undefined },
      modelUsed: 'm',
    });
    dispatcher = new PmDispatcher({
      execute,
    } as unknown as GenerateDailyPlanUsecase);
  });

  it.each([
    { publish: undefined, persist: true },
    { publish: true, persist: true },
    // 잠재의식 제안 카드 경로 — daily_plan·Notion 체크인을 남기지 않는다.
    { publish: false, persist: false },
  ])(
    'publish=$publish 이면 persist=$persist 로 넘긴다',
    async ({ publish, persist }) => {
      await dispatcher.dispatch({
        ...baseInput,
        ...(publish === undefined ? {} : { publish }),
      });

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ persist }),
      );
    },
  );
});
