import { App } from '@slack/bolt';

import { PullRequestReview } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { AgentCommandHandler } from './agent-command.handler';

type CommandCallback = (args: {
  ack: jest.Mock;
  command: { text: string; user_id: string };
  respond: jest.Mock;
}) => Promise<void>;

describe('AgentCommandHandler', () => {
  it('/review-pr은 온디맨드 게시를 명시한다', async () => {
    const review: PullRequestReview = {
      summary: '검토 완료',
      riskLevel: 'low',
      mustFix: [],
      niceToHave: [],
      missingTests: [],
      reviewCommentDrafts: [],
      approvalRecommendation: 'approve',
      findings: [],
    };
    const execute = jest.fn().mockResolvedValue({
      result: review,
      modelUsed: 'codex-cli',
      agentRunId: 19,
    });
    const callbacks = new Map<string, CommandCallback>();
    const app = {
      command: jest.fn((name: string, callback: CommandCallback) => {
        callbacks.set(name, callback);
      }),
    } as unknown as App;
    const handler = new AgentCommandHandler(
      {} as never,
      {} as never,
      { execute } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    handler.register(app);

    await callbacks.get('/review-pr')?.({
      ack: jest.fn().mockResolvedValue(undefined),
      command: { text: 'foo/bar#34', user_id: 'U123' },
      respond: jest.fn().mockResolvedValue(undefined),
    });

    expect(execute).toHaveBeenCalledWith({
      prRef: 'foo/bar#34',
      slackUserId: 'U123',
      publish: true,
    });
  });
});
