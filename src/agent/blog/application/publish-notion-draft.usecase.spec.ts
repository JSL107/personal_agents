import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { NotionClientPort } from '../../../notion/domain/port/notion-client.port';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { PublishNotionDraftUsecase } from './publish-notion-draft.usecase';

const draft = {
  pageId: 'page-12345678',
  url: 'https://notion.so/page',
  title: '공유 DB 마이그레이션 회고',
  category: '개발 회고',
  sourceType: 'PR',
  tags: ['migration'],
  summary: '',
  createdTime: '2026-08-14T16:00:00.000Z',
};

const buildUsecase = (overrides?: {
  drafts?: (typeof draft)[];
  markdown?: string;
  completionText?: string;
  forbiddenTerms?: string;
}) => {
  const notionClient = {
    queryDraftPages: jest.fn().mockResolvedValue(overrides?.drafts ?? [draft]),
    getPageMarkdown: jest
      .fn()
      .mockResolvedValue(
        overrides?.markdown ?? '# 공유 DB 마이그레이션 회고\n\n본문',
      ),
  } as unknown as jest.Mocked<NotionClientPort>;
  const modelRouter = {
    route: jest.fn().mockResolvedValue({
      text:
        overrides?.completionText ??
        JSON.stringify({
          slug: 'shared-database-migration',
          description: '공유 DB 마이그레이션의 정합성 교훈',
          body: '# 공유 DB 마이그레이션 회고\n\n익명화된 본문',
        }),
      modelUsed: 'codex-cli',
    }),
  } as unknown as jest.Mocked<ModelRouterUsecase>;
  const createPreview = {
    execute: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'preview-1',
    })),
  } as unknown as jest.Mocked<CreatePreviewUsecase>;
  const updateInputSnapshot = jest.fn();
  const agentRunService = {
    execute: jest.fn().mockImplementation(async (input) => {
      const execution = await input.run({
        agentRunId: 71,
        updateInputSnapshot,
      });
      return {
        result: execution.result,
        modelUsed: execution.modelUsed,
        agentRunId: 71,
      };
    }),
  } as unknown as jest.Mocked<AgentRunService>;
  const configService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string | undefined> = {
        EVENING_RETRO_BLOG_NOTION_DATABASE_ID: 'database-1',
        BLOG_NOTION_PROP_STATUS: '상태',
        BLOG_NOTION_STATUS_DRAFT_VALUE: '초안',
        BLOG_MASK_FORBIDDEN_TERMS:
          overrides?.forbiddenTerms === undefined
            ? '회사명,서비스명'
            : overrides.forbiddenTerms,
      };
      return values[key];
    }),
  } as unknown as jest.Mocked<ConfigService>;

  return {
    usecase: new PublishNotionDraftUsecase(
      agentRunService,
      modelRouter,
      notionClient,
      createPreview,
      configService,
    ),
    notionClient,
    modelRouter,
    createPreview,
    agentRunService,
    updateInputSnapshot,
  };
};

describe('PublishNotionDraftUsecase', () => {
  it('가장 오래된 초안 1건을 익명화해 GitHub 발행 preview를 만든다', async () => {
    const { usecase, createPreview, agentRunService, modelRouter } =
      buildUsecase();

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
      responseUrl: 'https://hooks.slack.test/response',
    });

    expect(outcome.result.status).toBe('preview');
    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'BLOG_PUBLISH' }),
    );
    expect(modelRouter.route).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'BLOG_PUBLISH' }),
    );
    expect(createPreview.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      kind: PREVIEW_KIND.BLOG_GITHUB_PUBLISH,
      responseUrl: 'https://hooks.slack.test/response',
      // autopilot T1_PREVIEW 와 같은 24시간. 1시간은 카드 유실로 이미 기각된 값이다.
      ttlMs: 86_400_000,
      previewText:
        '*GitHub 블로그 발행 미리보기*\n제목: 공유 DB 마이그레이션 회고\n경로: `src/content/posts/2026-08-15-shared-database-migration.md`\n요약: 공유 DB 마이그레이션의 정합성 교훈\nNotion: https://notion.so/page\n\n아래 전문을 확인한 뒤 ✅ 적용 / ❌ 취소를 눌러주세요.',
      payload: {
        pageId: draft.pageId,
        path: 'src/content/posts/2026-08-15-shared-database-migration.md',
        content:
          '---\ntitle: "공유 DB 마이그레이션 회고"\ndescription: "공유 DB 마이그레이션의 정합성 교훈"\npubDatetime: 2026-08-15T01:00:00+09:00\ntags:\n  - migration\n---\n\n익명화된 본문\n',
        title: draft.title,
        notionUrl: draft.url,
        tags: draft.tags,
        summary: '공유 DB 마이그레이션의 정합성 교훈',
        slackUserId: 'U1',
      },
    });
  });

  it('금지어 hit가 남으면 CreatePreview를 호출하지 않고 수정 안내를 반환한다', async () => {
    const { usecase, createPreview } = buildUsecase({
      completionText: JSON.stringify({
        slug: 'shared-database-migration',
        description: '설명',
        body: '회사명 서비스의 내부 구조를 정리했다.',
      }),
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result.status).toBe('blocked');
    if (outcome.result.status === 'blocked') {
      expect(outcome.result.message).toContain(
        'Notion에서 직접 수정 후 재시도',
      );
      expect(outcome.result.message).toContain('회사명');
    }
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: '설정 금지어',
      tags: ['서비스명'],
      forbiddenTerms: '회사명,서비스명',
      expectedHit: '서비스명',
    },
    {
      name: '사내 식별자 패턴',
      tags: ['mig_prep_cmc_current_credit'],
      forbiddenTerms: '회사명',
      expectedHit: 'mig_prep_cmc_current_credit',
    },
  ])(
    '본문이 안전해도 태그의 $name은 preview 없이 차단한다',
    async ({ tags, forbiddenTerms, expectedHit }) => {
      const { usecase, createPreview } = buildUsecase({
        drafts: [{ ...draft, tags }],
        forbiddenTerms,
        completionText: JSON.stringify({
          slug: 'safe-post',
          description: '안전한 설명',
          body: '식별 정보가 제거된 기술 회고입니다.',
        }),
      });

      const outcome = await usecase.execute({
        titleQuery: '',
        slackUserId: 'U1',
      });

      expect(outcome.result).toEqual(
        expect.objectContaining({
          status: 'blocked',
          hits: expect.arrayContaining([
            expect.objectContaining({ term: expectedHit }),
          ]),
        }),
      );
      expect(createPreview.execute).not.toHaveBeenCalled();
    },
  );

  it('Notion 원제목에 금지어가 남아도 CreatePreview를 호출하지 않는다', async () => {
    const { usecase, createPreview } = buildUsecase({
      drafts: [{ ...draft, title: '회사명 마이그레이션 회고' }],
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result.status).toBe('blocked');
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('Notion 요약에 금지어가 남아도 frontmatter preview를 만들지 않는다', async () => {
    const { usecase, createPreview } = buildUsecase({
      drafts: [{ ...draft, summary: '회사명 시스템 마이그레이션 회고' }],
      completionText: JSON.stringify({
        slug: 'safe-post',
        description: '식별 정보가 제거된 설명',
        body: '식별 정보가 제거된 기술 회고입니다.',
      }),
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result.status).toBe('blocked');
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('BLOG_MASK_FORBIDDEN_TERMS가 비어 있으면 다른 외부 호출 전에 실패한다', async () => {
    const { usecase, notionClient, modelRouter, createPreview } = buildUsecase({
      forbiddenTerms: ' , ',
    });

    await expect(
      usecase.execute({ titleQuery: '', slackUserId: 'U1' }),
    ).rejects.toThrow('BLOG_MASK_FORBIDDEN_TERMS');
    expect(notionClient.queryDraftPages).not.toHaveBeenCalled();
    expect(modelRouter.route).not.toHaveBeenCalled();
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('초안이 0건이면 정상 종료 메시지를 반환하고 모델과 preview를 호출하지 않는다', async () => {
    const { usecase, modelRouter, createPreview } = buildUsecase({
      drafts: [],
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result).toEqual({
      status: 'empty',
      message: '발행할 초안이 없습니다.',
    });
    expect(modelRouter.route).not.toHaveBeenCalled();
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('제목 일부와 맞는 초안이 없으면 현재 초안 제목을 안내한다', async () => {
    const { usecase } = buildUsecase();

    await expect(
      usecase.execute({ titleQuery: '없는 제목', slackUserId: 'U1' }),
    ).rejects.toThrow('공유 DB 마이그레이션 회고');
  });

  it('제목을 지정하지 않으면 응답 순서와 무관하게 가장 오래된 초안 1건을 선택한다', async () => {
    const newerDraft = {
      ...draft,
      pageId: 'page-newer',
      title: '새 초안',
      createdTime: '2026-08-15T16:00:00.000Z',
    };
    const olderDraft = {
      ...draft,
      pageId: 'page-older',
      title: '오래된 초안',
      createdTime: '2026-08-13T16:00:00.000Z',
    };
    const { usecase, notionClient } = buildUsecase({
      drafts: [newerDraft, olderDraft],
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(notionClient.getPageMarkdown).toHaveBeenCalledWith('page-older');
    expect(outcome.result).toEqual(
      expect.objectContaining({ status: 'preview', title: '오래된 초안' }),
    );
  });

  it('failure replay pageId가 있으면 목록이 바뀌어도 최초 선택 초안을 재실행한다', async () => {
    const newlyOlderDraft = {
      ...draft,
      pageId: 'page-newly-older',
      title: '나중에 추가된 더 오래된 초안',
      createdTime: '2026-08-12T16:00:00.000Z',
    };
    const originalDraft = {
      ...draft,
      pageId: 'page-original',
      title: '최초 실행 초안',
    };
    const { usecase, notionClient, updateInputSnapshot } = buildUsecase({
      drafts: [newlyOlderDraft, originalDraft],
    });

    await usecase.execute({
      titleQuery: '',
      pageId: 'page-original',
      slackUserId: 'U1',
    });

    expect(notionClient.getPageMarkdown).toHaveBeenCalledWith('page-original');
    expect(updateInputSnapshot).toHaveBeenCalledWith({
      slackUserId: 'U1',
      pageId: 'page-original',
    });
  });

  it('같은 제목 일부에 매칭된 초안이 여럿이면 가장 오래된 페이지를 선택한다', async () => {
    const newerDraft = {
      ...draft,
      pageId: 'page-newer-match',
      title: '결제 마이그레이션 회고 2',
      createdTime: '2026-08-15T16:00:00.000Z',
    };
    const olderDraft = {
      ...draft,
      pageId: 'page-older-match',
      title: '결제 마이그레이션 회고 1',
      createdTime: '2026-08-13T16:00:00.000Z',
    };
    const { usecase, notionClient } = buildUsecase({
      drafts: [newerDraft, olderDraft],
    });

    await usecase.execute({ titleQuery: '마이그레이션', slackUserId: 'U1' });

    expect(notionClient.getPageMarkdown).toHaveBeenCalledWith(
      'page-older-match',
    );
  });

  it('본문이 비어 있으면 모델과 preview를 호출하지 않는다', async () => {
    const { usecase, modelRouter, createPreview } = buildUsecase({
      markdown: '  ',
    });

    await expect(
      usecase.execute({ titleQuery: '', slackUserId: 'U1' }),
    ).rejects.toThrow('본문이 비어');
    expect(modelRouter.route).not.toHaveBeenCalled();
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('모델 JSON이 slug, description, body 계약을 지키지 않으면 preview를 만들지 않는다', async () => {
    const { usecase, createPreview } = buildUsecase({
      completionText: JSON.stringify({ slug: 'post', description: '설명' }),
    });

    await expect(
      usecase.execute({ titleQuery: '', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ blogErrorCode: 'BLOG_ANONYMIZE_PARSE_FAILED' });
    expect(createPreview.execute).not.toHaveBeenCalled();
  });
});
