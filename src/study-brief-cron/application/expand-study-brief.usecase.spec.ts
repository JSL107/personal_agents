import { ConfigService } from '@nestjs/config';

import { HermesRunnerPort } from '../../agent/blog/domain/port/hermes-runner.port';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { NotionClientPort } from '../../notion/domain/port/notion-client.port';
import { RepoContextPort } from '../domain/port/repo-context.port';
import {
  ExpandableStudyBrief,
  StudyBriefRepositoryPort,
} from '../domain/port/study-brief.repository.port';
import { StudyBriefException } from '../domain/study-brief.exception';
import { ExpandStudyBriefUsecase } from './expand-study-brief.usecase';

const brief: ExpandableStudyBrief = {
  id: 42,
  kind: 'CONCEPT',
  topic: 'Agentic AI Threat Modeling',
  verdict: {
    kind: 'CONCEPT',
    whyNow: 'Slack·GitHub 연동을 실운영하고 있다',
    whereItLands: 'agent-run, router, preview-gate',
    minutes: 15,
  },
  reportMd: '## 세 줄 요약\n압축된 요약본이다.',
  sourceUrls: ['https://example.com/doc'],
  createdAt: new Date('2026-08-20T00:30:00.000Z'),
};

const deepdiveOutput = [
  'TITLE: 에이전트 권한 경계 설계',
  'TAGS: llm, security',
  '---',
  '## 어디서 문제가 되나\n'.padEnd(1_200, '펼친 본문이다. '),
].join('\n');

interface BuildOptions {
  brief?: ExpandableStudyBrief | undefined;
  hermesOutput?: string;
  databaseId?: string | undefined;
  propertiesFail?: boolean;
}

const build = (options: BuildOptions = {}) => {
  const findLatestUnexpandedSince = jest
    .fn()
    .mockResolvedValue('brief' in options ? options.brief : brief);
  const markBlogDraftCreated = jest.fn().mockResolvedValue(undefined);
  const studyBriefRepository = {
    findLatestUnexpandedSince,
    markBlogDraftCreated,
  } as unknown as jest.Mocked<StudyBriefRepositoryPort>;

  const run = jest
    .fn()
    .mockResolvedValue({ stdout: options.hermesOutput ?? deepdiveOutput });
  const hermesRunner = { run } as unknown as jest.Mocked<HermesRunnerPort>;

  const findOrCreateDailyPage = jest
    .fn()
    .mockResolvedValue({ pageId: 'notion-page-1', url: 'https://notion.so/1' });
  const appendBlocks = jest.fn().mockResolvedValue(undefined);
  const updatePageProperties = options.propertiesFail
    ? jest.fn().mockRejectedValue(new Error('속성명 불일치'))
    : jest.fn().mockResolvedValue(undefined);
  const notionClient = {
    findOrCreateDailyPage,
    appendBlocks,
    updatePageProperties,
  } as unknown as jest.Mocked<NotionClientPort>;

  const repoContext = {
    collect: jest
      .fn()
      .mockResolvedValue([
        { name: 'preview-gate', description: '승인 게이트' },
      ]),
  } as unknown as jest.Mocked<RepoContextPort>;

  const updateInputSnapshot = jest.fn().mockResolvedValue(undefined);
  const agentRunService = {
    execute: jest.fn().mockImplementation(async (input) => {
      const execution = await input.run({
        agentRunId: 7,
        updateInputSnapshot,
      });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 7,
      };
    }),
  } as unknown as jest.Mocked<AgentRunService>;

  const databaseId =
    'databaseId' in options ? options.databaseId : 'blog-draft-db';
  const configService = {
    get: jest.fn(() => databaseId),
  } as unknown as jest.Mocked<ConfigService>;

  const usecase = new ExpandStudyBriefUsecase(
    agentRunService,
    hermesRunner,
    studyBriefRepository,
    repoContext,
    notionClient,
    configService,
  );
  return {
    usecase,
    run,
    findOrCreateDailyPage,
    appendBlocks,
    updatePageProperties,
    markBlogDraftCreated,
    updateInputSnapshot,
  };
};

describe('ExpandStudyBriefUsecase', () => {
  it('브리프를 펼쳐 블로그 초안 페이지를 만들고 확장 완료로 표시한다', async () => {
    const context = build();

    const outcome = await context.usecase.execute({
      ownerSlackUserId: 'U1',
    });

    expect(outcome.result).toMatchObject({
      status: 'created',
      briefId: 42,
      topic: 'Agentic AI Threat Modeling',
      title: '에이전트 권한 경계 설계',
      tags: ['llm', 'security'],
      notionUrl: 'https://notion.so/1',
    });
    expect(context.findOrCreateDailyPage).toHaveBeenCalledWith({
      databaseId: 'blog-draft-db',
      title: '에이전트 권한 경계 설계',
    });
    expect(context.appendBlocks).toHaveBeenCalledTimes(1);
    expect(context.markBlogDraftCreated).toHaveBeenCalledWith(
      42,
      'notion-page-1',
    );
  });

  // 발행 라인이 이 값들을 보고 초안을 집는다. 상태가 '초안' 이 아니면 글이 큐에 들어가지 않고,
  // 출처유형이 '오늘의 공부' 가 아니면 새치기가 조용히 사라진다.
  it('발행 라인이 읽는 상태·출처유형·카테고리를 채운다', async () => {
    const context = build();

    await context.usecase.execute({ ownerSlackUserId: 'U1' });

    expect(context.updatePageProperties).toHaveBeenCalledWith({
      pageId: 'notion-page-1',
      properties: expect.objectContaining({
        상태: { select: { name: '초안' } },
        출처유형: { select: { name: '오늘의 공부' } },
        카테고리: { select: { name: '기술 학습' } },
        태그: { multi_select: [{ name: 'llm' }, { name: 'security' }] },
      }),
    });
  });

  it('조사 재료(요약·출처·적용 지점)를 프롬프트에 실어 보낸다', async () => {
    const context = build();

    await context.usecase.execute({ ownerSlackUserId: 'U1' });

    const prompt = context.run.mock.calls[0][0] as string;
    expect(prompt).toContain('압축된 요약본이다.');
    expect(prompt).toContain('https://example.com/doc');
    expect(prompt).toContain('agent-run, router, preview-gate');
    expect(prompt).toContain('preview-gate: 승인 게이트');
  });

  it('확장할 브리프가 없으면 empty 로 끝낸다', async () => {
    const context = build({ brief: undefined });

    const outcome = await context.usecase.execute({ ownerSlackUserId: 'U1' });

    expect(outcome.result).toEqual({
      status: 'empty',
      message: '확장할 오늘의 공부가 없습니다.',
    });
    expect(context.run).not.toHaveBeenCalled();
    expect(context.markBlogDraftCreated).not.toHaveBeenCalled();
  });

  // 확장 완료 표시가 먼저 찍히면, 적재가 실패한 브리프가 다시는 후보에 오르지 않는다.
  it('출력 파싱이 실패하면 확장 완료로 표시하지 않는다', async () => {
    const context = build({ hermesOutput: '조사에 실패했습니다.' });

    await expect(
      context.usecase.execute({ ownerSlackUserId: 'U1' }),
    ).rejects.toThrow(StudyBriefException);
    expect(context.markBlogDraftCreated).not.toHaveBeenCalled();
    expect(context.findOrCreateDailyPage).not.toHaveBeenCalled();
  });

  it('속성 설정이 실패해도 본문은 저장된 것으로 보고한다', async () => {
    const context = build({ propertiesFail: true });

    const outcome = await context.usecase.execute({ ownerSlackUserId: 'U1' });

    expect(outcome.result.status).toBe('created');
    expect(context.markBlogDraftCreated).toHaveBeenCalled();
  });

  it('초안 DB 가 설정돼 있지 않으면 isConfigured 가 false 다', () => {
    expect(build({ databaseId: undefined }).usecase.isConfigured()).toBe(false);
    expect(build().usecase.isConfigured()).toBe(true);
  });

  it('브리프를 찾은 뒤 원장 입력에 대상 브리프를 기록한다', async () => {
    const context = build();

    await context.usecase.execute({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-20',
    });

    expect(context.updateInputSnapshot).toHaveBeenCalledWith({
      slackUserId: 'U1',
      firedAtKst: '2026-08-20',
      briefId: 42,
      topic: 'Agentic AI Threat Modeling',
    });
  });
});
