import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { PublishNotionDraftUsecase } from '../application/publish-notion-draft.usecase';
import { BlogPublishDispatcher } from './blog-publish.dispatcher';

describe('BlogPublishDispatcher', () => {
  it('자연어 발행 표현을 제거한 제목 일부로 usecase를 호출하고 preview를 전달한다', async () => {
    const publishNotionDraft = {
      execute: jest.fn().mockResolvedValue({
        agentRunId: 12,
        modelUsed: 'codex-cli',
        result: {
          status: 'preview',
          previewId: 'preview-1',
          previewText: '승인 카드',
          title: '공유 DB 회고',
          notionUrl: 'https://notion.so/page',
          path: 'src/content/posts/post.md',
          content: '전문',
        },
      }),
    } as unknown as jest.Mocked<PublishNotionDraftUsecase>;
    const dispatcher = new BlogPublishDispatcher(publishNotionDraft);

    const result = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '노션 블로그 초안 공유 DB 회고 발행해줘',
    });

    expect(publishNotionDraft.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'U1',
        titleQuery: '공유 DB 회고',
        triggerType: TriggerType.SLACK_MENTION_BLOG_PUBLISH,
      }),
    );
    expect(result.preview).toEqual({
      id: 'preview-1',
      text: '승인 카드',
      content: '전문',
    });
  });

  it.each(['노션 초안 정규식 글 발행된 거야?', '그 글 발행하면 어떻게 돼'])(
    '질문형 "%s" 은 발행 절차를 시작하지 않고, 확인 수단이 없다고 솔직히 말한다',
    async (text) => {
      const publishNotionDraft = {
        execute: jest.fn(),
      } as unknown as jest.Mocked<PublishNotionDraftUsecase>;
      const dispatcher = new BlogPublishDispatcher(publishNotionDraft);

      const result = await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text,
      });

      expect(publishNotionDraft.execute).not.toHaveBeenCalled();
      expect(result.output).toMatchObject({ heldWrite: { action: 'PUBLISH' } });
      expect(result.formattedText).toContain('발행 절차를 시작하지 않았어요');
      expect(result.formattedText).toContain('아직 없어요');
    },
  );
});
