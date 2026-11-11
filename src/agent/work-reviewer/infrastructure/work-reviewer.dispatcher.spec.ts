import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import { GenerateWorklogUsecase } from '../application/generate-worklog.usecase';
import { WorkReviewerDispatcher } from './work-reviewer.dispatcher';

jest.mock('../../../slack/format/daily-review.formatter', () => ({
  formatDailyReview: () => ({ summary: 's', detail: 'd' }),
}));

describe('WorkReviewerDispatcher', () => {
  const baseInput: DispatchInput = {
    source: 'SLACK_MESSAGE',
    slackUserId: 'U1',
    text: '오늘 한 일',
  };

  let execute: jest.Mock;
  let dispatcher: WorkReviewerDispatcher;

  beforeEach(() => {
    execute = jest
      .fn()
      .mockResolvedValue({ agentRunId: 1, result: {}, modelUsed: 'm' });
    dispatcher = new WorkReviewerDispatcher({
      execute,
    } as unknown as GenerateWorklogUsecase);
  });

  it.each([
    { publish: undefined, persist: true },
    { publish: true, persist: true },
    // 잠재의식 제안 카드 경로 — Notion 일일 페이지에 회고를 쓰지 않는다.
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
