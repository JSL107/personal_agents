import { AgentType } from '../../../model-router/domain/model-router.type';
import { GenerateBlogDraftUsecase } from '../application/generate-blog-draft.usecase';
import { BlogDispatcher } from './blog.dispatcher';

// BlogDispatcher 는 자연어 멘션(input.text)을 GenerateBlogDraftUsecase 로 릴레이하고
// 그 outcome 을 DispatchOutcome + Slack mrkdwn(formatBlogDraft) 으로 매핑한다.
describe('BlogDispatcher', () => {
  const buildOutcome = () => ({
    agentRunId: 42,
    modelUsed: 'hermes-cli',
    result: { notionUrl: 'https://notion.so/abc', rawOutput: '초안 본문' },
  });

  it('agentType 은 BLOG', () => {
    const dispatcher = new BlogDispatcher({} as GenerateBlogDraftUsecase);
    expect(dispatcher.agentType).toBe(AgentType.BLOG);
  });

  it('자연어 text 를 requestText 로 전달하고 outcome 을 DispatchOutcome 으로 매핑한다', async () => {
    const execute = jest.fn().mockResolvedValue(buildOutcome());
    const dispatcher = new BlogDispatcher({
      execute,
    } as unknown as GenerateBlogDraftUsecase);

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: 'CS 지식 블로그 써줘',
    });

    expect(execute).toHaveBeenCalledWith({
      requestText: 'CS 지식 블로그 써줘',
      slackUserId: 'U1',
    });
    expect(outcome.agentRunId).toBe(42);
    expect(outcome.modelUsed).toBe('hermes-cli');
    expect(outcome.output).toEqual({
      notionUrl: 'https://notion.so/abc',
      rawOutput: '초안 본문',
    });
    expect(outcome.formattedText).toContain('블로그 초안 완성');
    expect(outcome.formattedText).toContain('https://notion.so/abc');
  });

  it('text 가 없으면 requestText 를 빈 문자열로 전달한다', async () => {
    const execute = jest.fn().mockResolvedValue(buildOutcome());
    const dispatcher = new BlogDispatcher({
      execute,
    } as unknown as GenerateBlogDraftUsecase);

    await dispatcher.dispatch({ source: 'SLACK_MESSAGE', slackUserId: 'U2' });

    expect(execute).toHaveBeenCalledWith({
      requestText: '',
      slackUserId: 'U2',
    });
  });
});
