import { ReplayReplyRunner } from './replay-reply.runner';

describe('ReplayReplyRunner', () => {
  const runner = new ReplayReplyRunner({} as never);

  it('BLOG_PUBLISH 미리보기면 카드와 발행 전문을 응답 데이터로 돌려준다', async () => {
    const run = jest.fn().mockResolvedValue({
      agentRunId: 43,
      result: {
        status: 'preview',
        previewId: 'preview-1',
        previewText: '승인 카드',
        content: '발행 전문',
      },
    });

    const reply = await runner.run({
      kind: 'READY',
      agentType: 'BLOG_PUBLISH',
      runId: 42,
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(reply).toEqual({
      agentRunId: 43,
      text: '승인 카드',
      preview: { id: 'preview-1', text: '승인 카드' },
      followupText: '발행 전문',
    });
  });

  it('재실행에서 오류가 나면 호출자에게 그대로 전파한다', async () => {
    const error = new Error('재실행 실패');
    const run = jest.fn().mockRejectedValue(error);

    await expect(
      runner.run({
        kind: 'READY',
        agentType: 'BLOG_PUBLISH',
        runId: 42,
        run,
      }),
    ).rejects.toBe(error);
  });
});
