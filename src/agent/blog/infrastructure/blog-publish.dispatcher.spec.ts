import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AnswerBlogQuestionUsecase } from '../application/answer-blog-question.usecase';
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
    const dispatcher = new BlogPublishDispatcher(
      publishNotionDraft,
      {} as AnswerBlogQuestionUsecase,
    );

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

  it.each([
    '노션 초안 정규식 글 발행된 거야?',
    '그 글 발행하면 어떻게 돼',
    '남은 초안 뭐 있어',
  ])(
    '질문형 "%s" 은 발행 절차를 시작하지 않고, 초안·발행 기록으로 답한다',
    async (text) => {
      const publishNotionDraft = {
        execute: jest.fn(),
      } as unknown as jest.Mocked<PublishNotionDraftUsecase>;
      const answerExecute = jest.fn().mockResolvedValue({
        agentRunId: 81,
        modelUsed: 'codex-cli',
        result: {
          text: '최근 60일 발행 기록에 그 글은 없어요. 아직 초안으로 남아 있어요.',
          usedFallback: false,
        },
      });
      const dispatcher = new BlogPublishDispatcher(publishNotionDraft, {
        execute: answerExecute,
      } as unknown as AnswerBlogQuestionUsecase);

      const result = await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text,
      });

      expect(publishNotionDraft.execute).not.toHaveBeenCalled();
      expect(answerExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          text,
          parsedIntent: expect.objectContaining({
            heldWrite: expect.objectContaining({ action: 'PUBLISH' }),
          }),
        }),
      );
      expect(result.agentRunId).toBe(81);
      expect(result.formattedText).toContain('최근 60일 발행 기록');
    },
  );
});
