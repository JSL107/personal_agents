import { ConfigService } from '@nestjs/config';

import { HermesRunnerPort } from '../../agent/blog/domain/port/hermes-runner.port';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
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
  appendFail?: boolean;
  guardTaken?: boolean;
}

const build = (options: BuildOptions = {}) => {
  const findOldestUnexpandedSince = jest
    .fn()
    .mockResolvedValue('brief' in options ? options.brief : brief);
  const markBlogDraftCreated = jest.fn().mockResolvedValue(undefined);
  const studyBriefRepository = {
    findOldestUnexpandedSince,
    markBlogDraftCreated,
  } as unknown as jest.Mocked<StudyBriefRepositoryPort>;

  const run = jest
    .fn()
    .mockResolvedValue({ stdout: options.hermesOutput ?? deepdiveOutput });
  const hermesRunner = { run } as unknown as jest.Mocked<HermesRunnerPort>;

  const createDatabasePage = jest
    .fn()
    .mockResolvedValue({ pageId: 'notion-page-1', url: 'https://notion.so/1' });
  const appendBlocks = options.appendFail
    ? jest.fn().mockRejectedValue(new Error('append 실패'))
    : jest.fn().mockResolvedValue(undefined);
  const archivePage = jest.fn().mockResolvedValue(undefined);
  const findOrCreateDailyPage = jest.fn();
  const notionClient = {
    createDatabasePage,
    appendBlocks,
    archivePage,
    findOrCreateDailyPage,
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

  const acquireOnce = jest.fn().mockResolvedValue(!options.guardTaken);
  const release = jest.fn().mockResolvedValue(undefined);
  const cronIdempotency = {
    acquireOnce,
    release,
  } as unknown as jest.Mocked<CronIdempotencyService>;

  const usecase = new ExpandStudyBriefUsecase(
    agentRunService,
    hermesRunner,
    studyBriefRepository,
    repoContext,
    notionClient,
    configService,
    cronIdempotency,
  );
  return {
    usecase,
    run,
    createDatabasePage,
    findOrCreateDailyPage,
    appendBlocks,
    archivePage,
    markBlogDraftCreated,
    updateInputSnapshot,
    acquireOnce,
    release,
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
    expect(context.createDatabasePage).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseId: 'blog-draft-db',
        title: '에이전트 권한 경계 설계',
      }),
    );
    expect(context.markBlogDraftCreated).toHaveBeenCalledWith(
      42,
      'notion-page-1',
    );
  });

  // 발행 라인이 이 값들을 보고 초안을 집는다. 상태가 '초안' 이 아니면 글이 큐에 들어가지 않고,
  // 출처유형이 '오늘의 공부' 가 아니면 새치기가 조용히 사라진다.
  // 별도 갱신으로 두면 그것만 실패했을 때 발행 조회에 안 걸리는 글이 '확장 완료' 로 남는다.
  it('발행 라인이 읽는 상태·출처유형·카테고리를 생성과 같은 요청에 담는다', async () => {
    const context = build();

    await context.usecase.execute({ ownerSlackUserId: 'U1' });

    expect(context.createDatabasePage).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          상태: { select: { name: '초안' } },
          출처유형: { select: { name: '오늘의 공부' } },
          카테고리: { select: { name: '기술 학습' } },
          태그: { multi_select: [{ name: 'llm' }, { name: 'security' }] },
        }),
      }),
    );
  });

  // findOrCreateDailyPage 는 제목만으로 기존 행을 돌려준다 — 모델이 과거 글과 같은 제목을
  // 지으면 이미 발행한 글에 새 본문이 덧붙고 상태가 '초안' 으로 되돌아간다.
  it('제목으로 기존 페이지를 재사용하지 않는다', async () => {
    const context = build();

    await context.usecase.execute({ ownerSlackUserId: 'U1' });

    expect(context.findOrCreateDailyPage).not.toHaveBeenCalled();
  });

  // 앞부분만 담긴 글이 '초안' 으로 남으면 잘린 글이 그대로 발행 후보가 된다.
  it('본문 이어붙이기가 실패하면 불완전 초안을 치우고 확장 완료로 표시하지 않는다', async () => {
    const context = build({
      appendFail: true,
      hermesOutput: [
        'TITLE: 긴 글',
        'TAGS: a',
        '---',
        Array.from({ length: 150 }, (_, index) => `문단 ${index} 입니다.`).join(
          '\n\n',
        ),
      ].join('\n'),
    });

    await expect(
      context.usecase.execute({ ownerSlackUserId: 'U1' }),
    ).rejects.toThrow('append 실패');
    expect(context.archivePage).toHaveBeenCalledWith({
      pageId: 'notion-page-1',
    });
    expect(context.markBlogDraftCreated).not.toHaveBeenCalled();
  });

  // cron(11:00)과 수동 CLI 가 겹치면 같은 브리프로 초안이 두 장 생긴다.
  it('다른 확장이 진행 중이면 브리프를 집지 않는다', async () => {
    const context = build({ guardTaken: true });

    const outcome = await context.usecase.execute({ ownerSlackUserId: 'U1' });

    expect(outcome.result).toEqual({
      status: 'empty',
      message: '다른 딥다이브 확장이 진행 중입니다.',
    });
    expect(context.run).not.toHaveBeenCalled();
  });

  it('확장이 끝나면 잠금을 반드시 되돌린다', async () => {
    const failing = build({ hermesOutput: '조사 실패' });

    await expect(
      failing.usecase.execute({ ownerSlackUserId: 'U1' }),
    ).rejects.toThrow();

    expect(failing.release).toHaveBeenCalledTimes(1);
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
    expect(context.createDatabasePage).not.toHaveBeenCalled();
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
