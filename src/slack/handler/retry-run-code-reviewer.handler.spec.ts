import { App } from '@slack/bolt';

import { RetryRunHandler } from './retry-run.handler';

type RetryCallback = (input: {
  ack: jest.Mock;
  command: { text: string; user_id: string };
  respond: jest.Mock;
}) => Promise<void>;

describe('RetryRunHandler CODE_REVIEWER', () => {
  it('재실행한 리뷰의 상세 지적을 마스킹된 AI 전달 블록으로 응답한다', async () => {
    const review = {
      summary: '검토 완료',
      riskLevel: 'high',
      mustFix: ['인증 우회를 고쳐야 합니다. 자세한 재현 절차가 있습니다.'],
      niceToHave: [],
      missingTests: [],
      reviewCommentDrafts: [],
      approvalRecommendation: 'request_changes',
      findings: [],
    };
    const outcome = {
      result: review,
      agentRunId: 43,
      prTitle: '로그인 오류 수정',
    };
    const run = jest.fn().mockResolvedValue(outcome);
    const handler = new RetryRunHandler(
      {
        prepare: jest.fn().mockResolvedValue({
          kind: 'READY',
          agentType: 'CODE_REVIEWER',
          runId: 42,
          prRef: 'foo/bar#34',
          run,
        }),
      } as never,
      {} as never,
    );
    const callbacks = new Map<string, RetryCallback>();
    const app = {
      command: jest.fn((name: string, callback: RetryCallback) =>
        callbacks.set(name, callback),
      ),
    } as unknown as App;
    handler.register(app);
    const respond = jest.fn().mockResolvedValue(undefined);

    await callbacks.get('/retry-run')?.({
      ack: jest.fn().mockResolvedValue(undefined),
      command: { text: '42', user_id: 'U1' },
      respond,
    });

    const response = respond.mock.calls[0][0] as { text: string };
    expect(response.text).toContain('*로그인 오류 수정 리뷰*');
    expect(response.text).toContain('AI에 맡길 때 아래 내용을 복사하세요.');
    expect(response.text).toContain('자세한 재현 절차가 있습니다.');
  });
});
