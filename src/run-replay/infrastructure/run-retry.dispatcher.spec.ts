import { RunRetryDispatcher } from './run-retry.dispatcher';

describe('RunRetryDispatcher', () => {
  const repository = { findById: jest.fn() };
  const replay = { prepare: jest.fn() };
  const runner = { run: jest.fn() };
  const preview = { execute: jest.fn() };
  const countPreviews = { execute: jest.fn() };
  const dispatcher = new RunRetryDispatcher(
    repository as never,
    replay as never,
    runner as never,
    preview as never,
    countPreviews as never,
  );
  const input = {
    source: 'SLACK_MESSAGE' as const,
    slackUserId: 'U1',
    text: '실행번호 123 다시 해줘',
  };
  beforeEach(() => jest.resetAllMocks());
  it('실패 실행은 재실행 결과를 전달한다', async () => {
    repository.findById.mockResolvedValue({
      id: 123,
      status: 'FAILED',
      agentType: 'PM',
      inputSnapshot: { slackUserId: 'U1' },
    });
    const prepared = { kind: 'READY' };
    replay.prepare.mockResolvedValue(prepared);
    runner.run.mockResolvedValue({ agentRunId: 456, text: '완료' });
    expect(await dispatcher.dispatch(input)).toMatchObject({
      agentRunId: 456,
      formattedText: '완료',
    });
    expect(runner.run).toHaveBeenCalledWith(prepared);
  });
  it('본인이 아닌 실행은 거절한다', async () => {
    repository.findById.mockResolvedValue({
      id: 123,
      status: 'FAILED',
      inputSnapshot: {},
    });
    expect((await dispatcher.dispatch(input)).formattedText).toContain(
      '본인 실행만',
    );
    expect(replay.prepare).not.toHaveBeenCalled();
  });
  it('보류된 일정은 등록 없이 확인 카드를 만든다', async () => {
    repository.findById.mockResolvedValue({
      id: 123,
      status: 'SUCCEEDED',
      agentType: 'SCHEDULE',
      inputSnapshot: {
        slackUserId: 'U1',
        parsedIntent: {
          kind: 'REGISTER',
          title: '일정',
          dueDate: { year: 2026, month: 11, day: 25 },
          heldWrite: { action: 'REGISTER' },
        },
      },
    });
    countPreviews.execute.mockResolvedValue(0);
    preview.execute.mockResolvedValue({ id: 'p1' });
    expect((await dispatcher.dispatch(input)).preview?.id).toBe('p1');
    expect(preview.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          sourceRunId: 123,
          title: '일정',
          dueDate: { year: 2026, month: 11, day: 25 },
        },
      }),
    );
  });
  it.each([
    ['APPLIED', 1, '이미 다시 실행해 등록했어요'],
    ['PENDING', 0, '등록할까요?'],
  ])(
    '같은 실행의 %s 카드는 새 카드를 막는가 (승인된 카드만 막는다)',
    async (_status, appliedCount, message) => {
      repository.findById.mockResolvedValue({
        id: 123,
        status: 'SUCCEEDED',
        agentType: 'SCHEDULE',
        inputSnapshot: {
          slackUserId: 'U1',
          parsedIntent: {
            kind: 'REGISTER',
            title: '일정',
            dueDate: { year: 2026, month: 11, day: 25 },
            heldWrite: { action: 'REGISTER' },
          },
        },
      });
      countPreviews.execute.mockResolvedValue(appliedCount);
      preview.execute.mockResolvedValue({ id: 'p2' });
      const outcome = await dispatcher.dispatch(input);
      expect(outcome.formattedText).toContain(message);
      expect(outcome.preview?.id).toBe(appliedCount > 0 ? undefined : 'p2');
      expect(countPreviews.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'HELD_SCHEDULE_REGISTER',
          payloadPath: ['sourceRunId'],
          payloadValue: 123,
          status: 'APPLIED',
        }),
      );
    },
  );
});

describe('RunRetryDispatcher 안내', () => {
  const repository = { findById: jest.fn() };
  const replay = { prepare: jest.fn() };
  const runner = { run: jest.fn() };
  const preview = { execute: jest.fn() };
  const countPreviews = { execute: jest.fn() };
  const dispatcher = new RunRetryDispatcher(
    repository as never,
    replay as never,
    runner as never,
    preview as never,
    countPreviews as never,
  );
  const input = {
    source: 'SLACK_MESSAGE' as const,
    slackUserId: 'U1',
    text: '실행번호 123 다시 해줘',
  };
  beforeEach(() => jest.resetAllMocks());
  it('번호가 없으면 번호를 요청한다', async () => {
    expect(
      (await dispatcher.dispatch({ ...input, text: '다시' })).formattedText,
    ).toContain('실행 번호');
  });
  it('실행이 없으면 찾지 못했다고 안내한다', async () => {
    repository.findById.mockResolvedValue(null);
    expect((await dispatcher.dispatch(input)).formattedText).toContain(
      '찾지 못했어요',
    );
  });
  it('다른 사용자의 실행을 거절한다', async () => {
    repository.findById.mockResolvedValue({
      inputSnapshot: { slackUserId: 'U2' },
    });
    expect((await dispatcher.dispatch(input)).formattedText).toContain(
      '본인 실행만',
    );
  });
  it('재실행 준비가 거절되면 사유를 전달한다', async () => {
    repository.findById.mockResolvedValue({
      status: 'FAILED',
      inputSnapshot: { slackUserId: 'U1' },
    });
    replay.prepare.mockResolvedValue({
      kind: 'REJECTED',
      message: '거절 사유',
    });
    expect((await dispatcher.dispatch(input)).formattedText).toBe('거절 사유');
  });
  it.each(['VACATION', 'SCHEDULE'])(
    '%s 의 불완전한 보류는 원문 재요청을 안내한다',
    async (agentType) => {
      repository.findById.mockResolvedValue({
        status: 'SUCCEEDED',
        agentType,
        inputSnapshot: {
          slackUserId: 'U1',
          parsedIntent: {
            kind: 'NEEDS_DATE',
            heldWrite: { action: 'REGISTER' },
          },
        },
      });
      expect((await dispatcher.dispatch(input)).formattedText).toContain(
        '저장돼 있지 않아요',
      );
    },
  );
  it('일반 성공 실행의 상태를 안내한다', async () => {
    repository.findById.mockResolvedValue({
      status: 'SUCCEEDED',
      inputSnapshot: { slackUserId: 'U1' },
    });
    expect((await dispatcher.dispatch(input)).formattedText).toContain(
      '성공 상태',
    );
  });
});
