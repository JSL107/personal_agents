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

const draftPage = (
  title: string,
  createdTime = '2026-10-01T00:00:00.000Z',
) => ({
  pageId: title,
  url: 'u',
  title,
  category: '',
  sourceType: '',
  tags: [],
  summary: '',
  createdTime,
});

const defaultApplied = () => [
  {
    payload: publishedPayload,
    appliedAt: new Date('2026-09-20T00:00:00.000Z'),
    createdAt: new Date('2026-09-19T00:00:00.000Z'),
  },
  // 다른 모양의 payload 는 발행 기록으로 세지 않는다.
  { payload: { foo: 1 }, appliedAt: null, createdAt: new Date() },
];

const build = (
  databaseId: string | undefined,
  options: { drafts?: unknown[] | Error; applied?: unknown[] | Error } = {},
) => {
  const queryDraftPages = jest.fn();
  if (options.drafts instanceof Error) {
    queryDraftPages.mockRejectedValue(options.drafts);
  } else {
    queryDraftPages.mockResolvedValue(
      options.drafts ?? [draftPage('공유 DB 회고')],
    );
  }
  const findApplied = jest.fn();
  if (options.applied instanceof Error) {
    findApplied.mockRejectedValue(options.applied);
  } else {
    findApplied.mockResolvedValue(options.applied ?? defaultApplied());
  }
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
    expect(facts.drafts).toEqual({
      items: [{ title: '공유 DB 회고', createdAt: '2026-10-01' }],
      truncated: false,
    });
    expect(facts.recentlyPublished).toEqual({
      items: [
        {
          title: '정규식 낱말 경계',
          path: 'src/content/posts/regex.md',
          publishedAt: '2026-09-20',
        },
      ],
      truncated: false,
    });
    // "발행 후보에 있었다 = 발행됨" 으로 단정하지 않게 근거의 범위를 함께 넘긴다.
    expect(facts.note).toContain('발행 후보 목록에 있었다는 것만으로');
  });

  it('초안 DB 설정이 없으면 초안을 빈 목록이 아니라 "모름" 으로 넘긴다', async () => {
    const { usecase, answer, queryDraftPages } = build(undefined);
    await ask(usecase);
    expect(queryDraftPages).not.toHaveBeenCalled();
    expect(answer.mock.calls[0][0].facts.drafts).toMatchObject({
      status: '조회 실패로 모름',
    });
  });

  it('조회 상한까지 찼으면 잘렸다고 표시한다 — 목록 밖 글을 "없다" 고 단정하지 않게', async () => {
    const drafts = Array.from({ length: 50 }, (_, index) =>
      draftPage(`초안 ${index}`),
    );
    const { usecase, answer } = build('db-1', { drafts });
    await ask(usecase);
    expect(answer.mock.calls[0][0].facts.drafts.truncated).toBe(true);
    expect(answer.mock.calls[0][0].fallbackText).toContain('50건 이상');
  });

  it('Notion 조회가 실패해도 발행 기록으로 답한다 — 실패한 쪽만 모름', async () => {
    const { usecase, answer } = build('db-1', {
      drafts: new Error('unauthorized'),
    });
    await ask(usecase);
    const facts = answer.mock.calls[0][0].facts;
    expect(facts.drafts).toEqual({
      status: '조회 실패로 모름',
      reason: 'unauthorized',
    });
    expect(facts.recentlyPublished.items).toHaveLength(1);
  });

  it('발행 기록 조회가 실패해도 초안 목록으로 답한다', async () => {
    const { usecase, answer } = build('db-1', {
      applied: new Error('db down'),
    });
    await ask(usecase);
    const facts = answer.mock.calls[0][0].facts;
    expect(facts.recentlyPublished).toMatchObject({
      status: '조회 실패로 모름',
    });
    expect(facts.drafts.items).toHaveLength(1);
  });

  it('두 근거가 모두 실패하면 근거 없이 답하지 않고 실패로 끝낸다', async () => {
    const { usecase, answer } = build('db-1', {
      drafts: new Error('unauthorized'),
      applied: new Error('db down'),
    });
    await expect(ask(usecase)).rejects.toThrow('블로그 근거 조회 실패');
    expect(answer).not.toHaveBeenCalled();
  });

  it('발행일은 KST 날짜로 — UTC 로 전날인 KST 오전 발행도 그날로 센다', async () => {
    const { usecase, answer } = build('db-1', {
      applied: [
        {
          payload: { ...publishedPayload },
          // 2026-09-21 08:30 KST = 2026-09-20 23:30 UTC
          appliedAt: new Date('2026-09-20T23:30:00.000Z'),
          createdAt: new Date('2026-09-20T23:00:00.000Z'),
        },
      ],
    });
    await ask(usecase);
    expect(
      answer.mock.calls[0][0].facts.recentlyPublished.items[0].publishedAt,
    ).toBe('2026-09-21');
  });
});
