import { App } from '@slack/bolt';

import { PullRequestReview } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { AgentCommandHandler } from './agent-command.handler';

type CommandCallback = (args: {
  ack: jest.Mock;
  command: { text: string; user_id: string };
  respond: jest.Mock;
}) => Promise<void>;

describe('AgentCommandHandler', () => {
  it('빈 임팩트 요청에는 줄표 없는 쉬운 사용법을 알린다', async () => {
    const callbacks = new Map<string, CommandCallback>();
    const app = {
      command: jest.fn((name: string, callback: CommandCallback) => {
        callbacks.set(name, callback);
      }),
    } as unknown as App;
    new AgentCommandHandler(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ).register(app);
    const ack = jest.fn().mockResolvedValue(undefined);

    await callbacks.get('/impact-report')?.({
      ack,
      command: { text: '', user_id: 'U123' },
      respond: jest.fn(),
    });

    expect(ack.mock.calls[0][0].text).toContain('GitHub 커넥터 추가');
    expect(ack.mock.calls[0][0].text).not.toContain('—');
  });

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

  it('/review-pr은 상세 지적을 마스킹된 AI 전달 블록으로 함께 응답한다', async () => {
    const review: PullRequestReview = {
      summary: '검토 완료',
      riskLevel: 'high',
      mustFix: ['인증 우회를 고쳐야 합니다. password=supersecret'],
      niceToHave: [],
      missingTests: [],
      reviewCommentDrafts: [],
      approvalRecommendation: 'request_changes',
      findings: [],
    };
    const outcome = {
      result: review,
      agentRunId: 19,
      prTitle: '로그인 오류 수정',
    };
    const execute = jest.fn().mockResolvedValue(outcome);
    const respond = jest.fn().mockResolvedValue(undefined);
    const callbacks = new Map<string, CommandCallback>();
    const app = {
      command: jest.fn((name: string, callback: CommandCallback) =>
        callbacks.set(name, callback),
      ),
    } as unknown as App;
    new AgentCommandHandler(
      {} as never,
      {} as never,
      { execute } as never,
      {} as never,
      {} as never,
      {} as never,
    ).register(app);

    await callbacks.get('/review-pr')?.({
      ack: jest.fn(),
      command: { text: 'foo/bar#34', user_id: 'U123' },
      respond,
    });

    const response = respond.mock.calls[0][0] as { text: string };
    expect(response.text).toContain('*로그인 오류 수정 리뷰*');
    expect(response.text).toContain('AI에 맡길 때 아래 내용을 복사하세요.');
    expect(response.text).toContain('password=***');
    expect(response.text).not.toContain('password=supersecret');
  });
});
