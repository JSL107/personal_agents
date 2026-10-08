import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { FactAnswerUsecase } from '../../../fact-answer/application/fact-answer.usecase';
import { NotionClientPort } from '../../../notion/domain/port/notion-client.port';
import { FindRecentAppliedPreviewsUsecase } from '../../../preview-gate/application/find-recent-applied-previews.usecase';
import { AnswerBlogQuestionUsecase } from './answer-blog-question.usecase';

const publishedPayload = {
  pageId: 'p1',
  path: 'src/content/posts/regex.md',
  content: '본문',
  title: '정규식 낱말 경계',
  notionUrl: 'https://notion.so/p1',
  tags: [],
  summary: '',
  slackUserId: 'U1',
};

const build = (databaseId: string | undefined) => {
  const queryDraftPages = jest.fn().mockResolvedValue([
    {
      pageId: 'd1',
      url: 'u',
      title: '공유 DB 회고',
      category: '',
      sourceType: '',
      tags: [],
      summary: '',
      createdTime: '2026-10-01T00:00:00.000Z',
    },
  ]);
  const findApplied = jest.fn().mockResolvedValue([
    {
      payload: publishedPayload,
      appliedAt: new Date('2026-09-20T00:00:00.000Z'),
      createdAt: new Date('2026-09-19T00:00:00.000Z'),
    },
    // 다른 모양의 payload 는 발행 기록으로 세지 않는다.
    { payload: { foo: 1 }, appliedAt: null, createdAt: new Date() },
  ]);
  const execute = jest.fn(async (input) => {
    const r = await input.run({ agentRunId: 91 });
    return { result: r.result, modelUsed: r.modelUsed, agentRunId: 91 };
  });
  const answer = jest
    .fn()
    .mockResolvedValue({ text: '답', usedFallback: false, modelUsed: 'm' });
  const usecase = new AnswerBlogQuestionUsecase(
    {
      get: (key: string) =>
        key === 'EVENING_RETRO_BLOG_NOTION_DATABASE_ID'
          ? databaseId
          : undefined,
    } as unknown as ConfigService,
    { queryDraftPages } as unknown as NotionClientPort,
    { execute: findApplied } as unknown as FindRecentAppliedPreviewsUsecase,
    { execute } as unknown as AgentRunService,
    { answer } as unknown as FactAnswerUsecase,
  );
  return { usecase, queryDraftPages, answer, execute };
};

const ask = (usecase: AnswerBlogQuestionUsecase) =>
  usecase.execute({
    slackUserId: 'U1',
    text: '정규식 글 발행된 거야?',
    priorTurns: [],
    parsedIntent: { action: 'UNKNOWN' },
  });

describe('AnswerBlogQuestionUsecase', () => {
  it('초안 목록과 최근 발행 기록을 사실로 넘기고 UNKNOWN 회차로 원장에 남긴다', async () => {
    const { usecase, answer, execute, queryDraftPages } = build('db-1');
    await ask(usecase);

    expect(execute.mock.calls[0][0].inputSnapshot).toMatchObject({
      action: 'UNKNOWN',
    });
    expect(queryDraftPages).toHaveBeenCalledWith(
      expect.objectContaining({ databaseId: 'db-1', statusValue: '초안' }),
    );
    const facts = answer.mock.calls[0][0].facts;
    expect(facts.drafts).toEqual([
      { title: '공유 DB 회고', createdAt: '2026-10-01' },
    ]);
    expect(facts.recentlyPublished).toEqual([
      {
        title: '정규식 낱말 경계',
        path: 'src/content/posts/regex.md',
        publishedAt: '2026-09-20',
      },
    ]);
    // "발행 후보에 있었다 = 발행됨" 으로 단정하지 않게 근거의 범위를 함께 넘긴다.
    expect(facts.note).toContain('발행 후보 목록에 있었다는 것만으로');
  });

  it('초안 DB 설정이 없으면 초안을 빈 목록이 아니라 "모름" 으로 넘긴다', async () => {
    const { usecase, answer, queryDraftPages } = build(undefined);
    await ask(usecase);
    expect(queryDraftPages).not.toHaveBeenCalled();
    expect(answer.mock.calls[0][0].facts.drafts).toContain('모름');
  });
});
