import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import {
  CODE_MASK_PATTERN,
  maskFencedCodeBlocks,
} from '../../../humanize/domain/markdown-blocks';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { NotionClientPort } from '../../../notion/domain/port/notion-client.port';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import {
  BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT,
  BLOG_ANONYMIZE_SYSTEM_PROMPT,
} from '../domain/prompt/blog-anonymize.prompt';
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

// 편집 단계 기본 응답 — 제목·주소·요약·본문의 정본이 이 단계다.
const editedDraft = {
  publishable: true,
  reason: '공유 DB 정합성이라는 요지가 분명하다.',
  title: '공유 DB 마이그레이션 회고',
  slug: 'shared-database-migration',
  description: '공유 DB 마이그레이션의 정합성 교훈',
  body: '# 공유 DB 마이그레이션 회고\n\n익명화된 본문',
};

// 익명화 응답을 편집 응답으로 감싼다. 실제 파이프라인에서 편집은 익명화 본문을 이어받으므로
// 목도 그렇게 이어야 한다 — 그러지 않으면 익명화 단계에 심은 값이 검사 대상에서 빠져 버린다.
const buildEditTextFrom = (
  anonymizeText: string,
  target: typeof draft,
): string => {
  try {
    const parsed = JSON.parse(anonymizeText) as {
      slug?: string;
      description?: string;
      body?: string;
    };
    return JSON.stringify({
      publishable: true,
      reason: editedDraft.reason,
      title: target.title,
      slug: parsed.slug ?? editedDraft.slug,
      description: parsed.description ?? editedDraft.description,
      body: parsed.body ?? editedDraft.body,
    });
  } catch {
    return JSON.stringify(editedDraft);
  }
};

const buildUsecase = (overrides?: {
  drafts?: (typeof draft)[];
  markdown?: string;
  completionText?: string;
  editText?: string;
  humanizeSuffix?: string | null;
  // 이 키의 문단만 원본 그대로 돌려준다 — 한 문단이 조용히 빠진 상황을 만든다.
  humanizeSkipKeys?: string[];
  // 모든 문단을 빈 값으로 돌려준다 — 모델이 응답은 했는데 내용이 비어 온 상황.
  humanizeAllEmpty?: boolean;
  openPreviews?: unknown[];
  forbiddenTerms?: string;
  omitKeys?: string[];
  // 최근 금지어 차단 이력 — 원장이 돌려주는 형태 그대로 준다.
  recentRuns?: Array<{ output: unknown; inputSnapshot: unknown }>;
  // 원장 조회가 깨진 상황. 발행이 그 때문에 멈추면 안 된다.
  recentRunsError?: Error;
}) => {
  const notionClient = {
    updatePageProperties: jest.fn().mockResolvedValue(undefined),
    queryDraftPages: jest.fn().mockResolvedValue(overrides?.drafts ?? [draft]),
    getPageMarkdown: jest
      .fn()
      .mockResolvedValue(
        overrides?.markdown ?? '# 공유 DB 마이그레이션 회고\n\n본문',
      ),
  } as unknown as jest.Mocked<NotionClientPort>;
  // 파이프라인이 모델을 두 번 부른다 — 1) 익명화 2) 편집. systemPrompt 로 구분해 답을 돌려준다.
  const anonymizeText =
    overrides?.completionText ??
    JSON.stringify({
      slug: 'shared-database-migration',
      description: '공유 DB 마이그레이션의 정합성 교훈',
      body: '# 공유 DB 마이그레이션 회고\n\n익명화된 본문',
    });
  const editText =
    overrides?.editText ??
    buildEditTextFrom(anonymizeText, overrides?.drafts?.[0] ?? draft);
  const modelRouter = {
    route: jest.fn().mockImplementation(async (input) => ({
      text: String(input.request.systemPrompt).includes('블로그의 편집자')
        ? editText
        : anonymizeText,
      modelUsed: 'codex-cli',
    })),
  } as unknown as jest.Mocked<ModelRouterUsecase>;
  // 윤문 목: 문단 끝에 표식을 덧붙여 "적용됨" 을 만든다. null 이면 원문 그대로(=윤문 실패).
  const humanizeSuffix =
    overrides?.humanizeSuffix === undefined
      ? ' 그렇더라고요.'
      : overrides.humanizeSuffix;
  const humanizer = {
    humanize: jest.fn(async (fields: Record<string, string>) => {
      if (humanizeSuffix === null) {
        return fields;
      }
      const next: Record<string, string> = {};
      for (const key of Object.keys(fields)) {
        if (overrides?.humanizeAllEmpty) {
          next[key] = '';
          continue;
        }
        next[key] = overrides?.humanizeSkipKeys?.includes(key)
          ? fields[key]
          : `${fields[key]}${humanizeSuffix}`;
      }
      return next;
    }),
  } as unknown as jest.Mocked<HumanizeService>;
  const findAllOpenPreviews = {
    execute: jest.fn().mockResolvedValue(overrides?.openPreviews ?? []),
  } as unknown as jest.Mocked<FindAllOpenPreviewsUsecase>;
  const createPreview = {
    execute: jest.fn().mockImplementation(async (input) => ({
      ...input,
      id: 'preview-1',
    })),
  } as unknown as jest.Mocked<CreatePreviewUsecase>;
  const updateInputSnapshot = jest.fn();
  // 원장에 실리는 output 을 잡아 둔다. 목이 이 값을 버리면 "무엇이 원장에 남는가" 를 검사할
  // 수단이 없어, 배선이 빠져도 초록이다.
  const runOutputs: unknown[] = [];
  const agentRunService = {
    findRecentSucceededRuns: jest.fn().mockImplementation(async () => {
      if (overrides?.recentRunsError) {
        throw overrides.recentRunsError;
      }
      return overrides?.recentRuns ?? [];
    }),
    execute: jest.fn().mockImplementation(async (input) => {
      const execution = await input.run({
        agentRunId: 71,
        updateInputSnapshot,
      });
      runOutputs.push(execution.output);
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
      if (overrides?.omitKeys?.includes(key)) {
        return undefined;
      }
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
      humanizer,
      findAllOpenPreviews,
    ),
    notionClient,
    modelRouter,
    createPreview,
    agentRunService,
    updateInputSnapshot,
    humanizer,
    findAllOpenPreviews,
    runOutputs,
  };
};

// 발행 날짜가 '오늘' 이 되었으므로 시계를 고정한다. KST 2026-08-19 10:00.
beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-08-19T01:00:00.000Z') });
});

afterAll(() => {
  jest.useRealTimers();
});

describe('PublishNotionDraftUsecase', () => {
  // 편집 모델에게 코드를 보여주면 손댄다(실측 3회 중 2회). 자리만 남기고 가리는 흐름을
  // usecase 수준에서 고정한다 — 유틸 단위 테스트만으로는 배선이 빠져도 초록이다.
  describe('편집 단계 코드 보호', () => {
    const 코드본문 = [
      '# 캐시 흐름',
      '',
      '이렇게 요청합니다.',
      '',
      '```http',
      'GET /en-US/ HTTP/1.1',
      'Host: developer.mozilla.org',
      '```',
    ].join('\n');
    const 익명화응답 = JSON.stringify({
      slug: 'cache-flow',
      description: '캐시 흐름 정리',
      body: 코드본문,
    });
    const 편집응답 = (body: string): string =>
      JSON.stringify({
        publishable: true,
        reason: '발행 가능',
        title: draft.title,
        slug: 'cache-flow',
        description: '캐시 흐름 정리',
        body,
      });

    it('편집 모델에는 코드 대신 표식을 보내고, 응답의 표식을 원본 코드로 되돌린다', async () => {
      const { masked } = maskFencedCodeBlocks(코드본문);
      const { usecase, modelRouter, createPreview } = buildUsecase({
        markdown: 코드본문,
        completionText: 익명화응답,
        editText: 편집응답(masked),
      });

      await usecase.execute({
        titleQuery: '',
        slackUserId: 'U1',
        responseUrl: 'https://hooks.slack.test/response',
      });

      const 편집호출 = modelRouter.route.mock.calls.find(([input]) =>
        String(input.request.systemPrompt).includes('블로그의 편집자'),
      );
      expect(편집호출).toBeDefined();
      const 편집프롬프트 = String(편집호출?.[0].request.prompt);
      expect(편집프롬프트).not.toContain('developer.mozilla.org');
      expect(편집프롬프트).toMatch(CODE_MASK_PATTERN);

      // 최종 발행본에는 원본 코드가 그대로 들어간다.
      const payload = createPreview.execute.mock.calls[0][0] as {
        payload: { content: string };
      };
      expect(payload.payload.content).toContain('Host: developer.mozilla.org');
      expect(payload.payload.content).not.toMatch(CODE_MASK_PATTERN);
    });

    // 단계명을 붙인 목적이 진단이다. 두 경로가 서로 다른 이름을 내야 실패 원인을 좁힐 수 있다 —
    // 실제로 같은 메시지 때문에 편집 단계를 고친 뒤에도 어디를 봐야 할지 몰랐다.
    // 공개 프로젝트 계약(오늘의 공부)은 "코드블록 안의 코드·명령어·설정 보존" 을 약속한다.
    // 프롬프트만으로는 지켜지지 않아 익명화 단계에도 표식을 씌운다. 회사 PR 회고 계약은
    // 반대로 코드 안 사내 실명을 지우는 것이 일이라 가리지 않는다 — 두 경로를 함께 고정한다.
    it('공개 프로젝트 계약이면 익명화 모델에도 코드 대신 표식을 보낸다', async () => {
      const 공부초안 = { ...draft, sourceType: '오늘의 공부' };
      const { masked } = maskFencedCodeBlocks(코드본문);
      const { usecase, modelRouter } = buildUsecase({
        drafts: [공부초안],
        markdown: 코드본문,
        completionText: JSON.stringify({
          slug: 'cache-flow',
          description: '캐시 흐름 정리',
          body: masked,
        }),
      });

      await usecase.execute({
        titleQuery: '',
        slackUserId: 'U1',
        responseUrl: 'https://hooks.slack.test/response',
      });

      const 익명화호출 = modelRouter.route.mock.calls.find(
        ([input]) =>
          !String(input.request.systemPrompt).includes('블로그의 편집자'),
      );
      const 익명화프롬프트 = String(익명화호출?.[0].request.prompt);
      expect(익명화프롬프트).not.toContain('developer.mozilla.org');
      expect(익명화프롬프트).toMatch(CODE_MASK_PATTERN);
    });

    // 코드 보존 계약에서는 삭제도 실패다. 표식이 사라지면 복원할 것이 없어 코드가 조용히 빠지고,
    // 남은 표식이 없으니 잔여 표식 검사도 삭제를 허용하는 보존 검사도 통과한다.
    it('공개 프로젝트 계약에서 익명화가 표식을 지우면 발행하지 않는다', async () => {
      const 공부초안 = { ...draft, sourceType: '오늘의 공부' };
      const { masked } = maskFencedCodeBlocks(코드본문);
      const { usecase } = buildUsecase({
        drafts: [공부초안],
        markdown: 코드본문,
        completionText: JSON.stringify({
          slug: 'cache-flow',
          description: '캐시 흐름 정리',
          body: masked.replace(CODE_MASK_PATTERN, ''),
        }),
      });

      await expect(
        usecase.execute({
          titleQuery: '',
          slackUserId: 'U1',
          responseUrl: 'https://hooks.slack.test/response',
        }),
      ).rejects.toThrow(/코드 표식이 사라졌거나 늘어났습니다/);
    });

    it('익명화가 표식을 복제하면 발행하지 않는다', async () => {
      const 공부초안 = { ...draft, sourceType: '오늘의 공부' };
      const { masked } = maskFencedCodeBlocks(코드본문);
      const 표식 = masked.match(CODE_MASK_PATTERN)?.[0] ?? '';
      const { usecase } = buildUsecase({
        drafts: [공부초안],
        markdown: 코드본문,
        completionText: JSON.stringify({
          slug: 'cache-flow',
          description: '캐시 흐름 정리',
          // 한 코드가 두 자리에 복제되면 글이 같은 예시를 두 번 보여준다.
          body: `${masked}\n\n${표식}`,
        }),
      });

      await expect(
        usecase.execute({
          titleQuery: '',
          slackUserId: 'U1',
          responseUrl: 'https://hooks.slack.test/response',
        }),
      ).rejects.toThrow(/코드 표식이 사라졌거나 늘어났습니다/);
    });

    it('회사 회고 계약이면 익명화 모델에 코드를 그대로 보낸다', async () => {
      const { usecase, modelRouter } = buildUsecase({
        markdown: 코드본문,
        completionText: 익명화응답,
      });

      await usecase.execute({
        titleQuery: '',
        slackUserId: 'U1',
        responseUrl: 'https://hooks.slack.test/response',
      });

      const 익명화호출 = modelRouter.route.mock.calls.find(
        ([input]) =>
          !String(input.request.systemPrompt).includes('블로그의 편집자'),
      );
      // 사내 클래스·함수 실명이 코드 안에 있을 수 있어 이 경로는 코드를 봐야 한다.
      expect(String(익명화호출?.[0].request.prompt)).toContain(
        'developer.mozilla.org',
      );
    });

    it('익명화가 코드를 바꾸면 익명화 단계로 알린다', async () => {
      const { usecase } = buildUsecase({
        markdown: 코드본문,
        completionText: JSON.stringify({
          slug: 'cache-flow',
          description: '캐시 흐름 정리',
          // 익명화가 실제 주소를 예시 주소로 바꾼 상황(실측된 오익명화).
          body: 코드본문.replace('developer.mozilla.org', 'example.com'),
        }),
      });

      await expect(
        usecase.execute({
          titleQuery: '',
          slackUserId: 'U1',
          responseUrl: 'https://hooks.slack.test/response',
        }),
      ).rejects.toThrow(/익명화 결과의 코드블록/);
    });

    it('편집이 코드를 바꾸면 편집 단계로 알린다', async () => {
      const { usecase } = buildUsecase({
        markdown: 코드본문,
        completionText: 익명화응답,
        // 표식 자리에 원본과 다른 코드를 직접 써 넣은 응답.
        editText: 편집응답(
          [
            '# 캐시 흐름',
            '',
            '이렇게 요청합니다.',
            '',
            '```http',
            'GET /other HTTP/1.1',
            '```',
          ].join('\n'),
        ),
      });

      await expect(
        usecase.execute({
          titleQuery: '',
          slackUserId: 'U1',
          responseUrl: 'https://hooks.slack.test/response',
        }),
      ).rejects.toThrow(/편집 결과의 코드블록/);
    });

    it('모델이 표식을 변형하면 발행하지 않는다', async () => {
      const { masked } = maskFencedCodeBlocks(코드본문);
      const { usecase } = buildUsecase({
        markdown: 코드본문,
        completionText: 익명화응답,
        editText: 편집응답(
          masked.replace(/CODE_BLOCK_[0-9a-f]+/, 'CODE_BLOCK_deadbeef'),
        ),
      });

      await expect(
        usecase.execute({
          titleQuery: '',
          slackUserId: 'U1',
          responseUrl: 'https://hooks.slack.test/response',
        }),
      ).rejects.toThrow(/코드 표식/);
    });
  });

  describe('buildPublishCandidate', () => {
    it('ready 후보만 만들고 AgentRun과 CreatePreview를 호출하지 않는다', async () => {
      const { usecase, agentRunService, createPreview } = buildUsecase();

      const { candidate, modelUsed } = await usecase.buildPublishCandidate({
        slackUserId: 'U1',
      });
      // autopilot 이 AgentRun 에 기록할 값 — 없으면 원장에 모델이 빈 채로 남는다.
      expect(modelUsed).toBeTruthy();

      expect(candidate).toEqual(
        expect.objectContaining({
          status: 'ready',
          previewText: expect.stringContaining('GitHub 블로그 발행 미리보기'),
          payload: expect.objectContaining({
            pageId: draft.pageId,
            slackUserId: 'U1',
          }),
        }),
      );
      expect(agentRunService.execute).not.toHaveBeenCalled();
      expect(createPreview.execute).not.toHaveBeenCalled();
    });

    it('초안이 없으면 모델·AgentRun·CreatePreview 호출 없이 empty를 반환한다', async () => {
      const { usecase, modelRouter, agentRunService, createPreview } =
        buildUsecase({ drafts: [] });

      await expect(
        usecase.buildPublishCandidate({ slackUserId: 'U1' }),
      ).resolves.toEqual({
        candidate: {
          status: 'empty',
          message: '발행할 초안이 없습니다.',
        },
        // 모델을 부르지 않았으므로 원장에도 결정론 실행으로 남는다.
        modelUsed: 'deterministic',
        // 초안을 열어 보지도 않았다 — 잰 단계가 없다.
        stages: [],
      });
      expect(modelRouter.route).not.toHaveBeenCalled();
      expect(agentRunService.execute).not.toHaveBeenCalled();
      expect(createPreview.execute).not.toHaveBeenCalled();
    });

    it('금지어가 남으면 공개 메시지에 원문을 넣지 않고 preview를 만들지 않는다', async () => {
      const { usecase, agentRunService, createPreview } = buildUsecase({
        completionText: JSON.stringify({
          slug: 'safe-post',
          description: '안전한 설명',
          body: '회사명 서비스의 내부 구조를 정리했다.',
        }),
      });

      const { candidate, modelUsed } = await usecase.buildPublishCandidate({
        slackUserId: 'U1',
      });
      // autopilot 이 AgentRun 에 기록할 값 — 없으면 원장에 모델이 빈 채로 남는다.
      expect(modelUsed).toBeTruthy();

      expect(candidate.status).toBe('blocked');
      if (candidate.status === 'blocked') {
        expect(candidate.message).not.toContain('회사명');
        expect(candidate.message).not.toContain('내부 구조를 정리했다');
        expect(candidate.hits).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              term: '회사명',
              excerpt: expect.any(String),
            }),
          ]),
        );
      }
      expect(agentRunService.execute).not.toHaveBeenCalled();
      expect(createPreview.execute).not.toHaveBeenCalled();
    });
  });

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
        '*GitHub 블로그 발행 미리보기*\n제목: 공유 DB 마이그레이션 회고\n경로: `src/content/posts/2026-08-19-shared-database-migration.md`\n요약: 공유 DB 마이그레이션의 정합성 교훈\nNotion: https://notion.so/page\n정리: 편집 완료 · 말투: 1/1문단 적용\n구조(원문→익명화→편집→최종): 글자 21→26→26→34 · 헤딩 1→1→1→1 · 인용 0→0→0→0 · 링크 0→0→0→0 · 코드 0→0→0→0\n코드 예시: 0개\n문체 지표: 문장 1개 · 평균 13자 · 편차 0 · 짧은문장 100% · 최장 13자 · 구어 100% · 요체 100% · 종결체교대 0% · 금지접속사 0회 · 줄표 0회 (40문장 미만이라 참고값)\n문단 1개 · 벽 0% · 같은크기 100% · 짧은문장 없는 문단 0개\n\n아래 전문을 확인한 뒤 ✅ 적용 / ❌ 취소를 눌러주세요.',
      payload: {
        pageId: draft.pageId,
        path: 'src/content/posts/2026-08-19-shared-database-migration.md',
        content:
          '---\ntitle: "공유 DB 마이그레이션 회고"\ndescription: "공유 DB 마이그레이션의 정합성 교훈"\npubDatetime: 2026-08-19T10:00:00+09:00\ntags:\n  - "migration"\n---\n\n익명화된 본문 그렇더라고요.\n',
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
      expect(outcome.result.message).toContain('회**');
    }
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  // 차단 메시지는 자연어 멘션 경로에서 채널에 그대로 게시된다. 탐지 원문을 실으면
  // 차단한 식별정보를 채널 전체에 다시 뿌리게 된다.
  it('차단 메시지에 탐지 원문과 주변 문맥을 싣지 않는다', async () => {
    const { usecase } = buildUsecase({
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
      expect(outcome.result.message).not.toContain('회사명');
      expect(outcome.result.message).not.toContain('내부 구조를 정리했다');
      // 원문은 실행 기록(agent_run)에만 남는다.
      expect(outcome.result.hits).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            term: '회사명',
            excerpt: expect.any(String),
          }),
        ]),
      );
    }
  });

  // slug 은 공개 저장소의 커밋 경로·URL 로 굳으므로 본문이 안전해도 통과시키면 안 된다.
  it('본문이 안전해도 slug에 금지어가 남으면 preview 없이 차단한다', async () => {
    const { usecase, createPreview } = buildUsecase({
      forbiddenTerms: 'acme-corp',
      completionText: JSON.stringify({
        slug: 'acme-corp-migration',
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

  // 발행 요약의 정본이 편집 단계로 옮겨졌다. Notion 요약은 발행물에 더 이상 들어가지 않으므로
  // 거기 남은 금지어는 공개되지 않는다 — 대신 편집이 내놓은 요약을 검사해야 한다.
  it('편집이 내놓은 요약에 금지어가 남으면 preview 없이 차단한다', async () => {
    const { usecase, createPreview } = buildUsecase({
      editText: JSON.stringify({
        publishable: true,
        reason: '요지는 분명하다.',
        title: '안전한 제목',
        slug: 'safe-post',
        description: '회사명 시스템 마이그레이션 회고',
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

  it('Notion 요약에 금지어가 있어도 발행 요약은 편집 산출이라 새지 않는다', async () => {
    const { usecase, createPreview } = buildUsecase({
      drafts: [{ ...draft, summary: '회사명 시스템 마이그레이션 회고' }],
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result.status).toBe('preview');
    const payload = createPreview.execute.mock.calls[0][0].payload as {
      summary: string;
      content: string;
    };
    expect(payload.summary).not.toContain('회사명');
    expect(payload.content).not.toContain('회사명');
  });

  it('편집이 발행 부적합으로 판정하면 Notion 초안을 보류로 옮기고 발행하지 않는다', async () => {
    const { usecase, notionClient, createPreview } = buildUsecase({
      editText: JSON.stringify({
        publishable: false,
        reason: '강의 필기를 옮겨 적은 수준이라 글쓴이의 판단이 없다.',
        title: '',
        slug: '',
        description: '',
        body: '',
      }),
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result).toEqual({
      status: 'skipped',
      cause: 'hold',
      message: expect.stringContaining('보류로 옮겼습니다'),
    });
    // 보류 전환이 없으면 같은 초안이 매일 다시 뽑혀 뒤 초안이 영구히 발행되지 않는다.
    expect(notionClient.updatePageProperties).toHaveBeenCalledWith({
      pageId: draft.pageId,
      properties: { 상태: { select: { name: '보류' } } },
    });
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('보류 전환은 발행일·태그를 건드리지 않는다', async () => {
    const { usecase, notionClient } = buildUsecase({
      editText: JSON.stringify({
        publishable: false,
        reason: '요지를 정할 수 없다.',
        title: '',
        slug: '',
        description: '',
        body: '',
      }),
    });

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    const properties = notionClient.updatePageProperties.mock.calls[0][0]
      .properties as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(['상태']);
  });

  it('응답하지 않은 발행 카드가 열려 있으면 모델을 부르지 않고 넘긴다', async () => {
    const { usecase, modelRouter, createPreview } = buildUsecase({
      openPreviews: [
        {
          id: 'preview-open',
          kind: 'BLOG_GITHUB_PUBLISH',
          payload: { pageId: draft.pageId },
        },
      ],
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result).toEqual({
      status: 'skipped',
      cause: 'card-open',
      message: expect.stringContaining('아직 열려 있습니다'),
    });
    // 모델 호출 세 번이 그대로 낭비되는 것을 막는 게 이 분기의 목적이다.
    expect(modelRouter.route).not.toHaveBeenCalled();
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('다른 종류의 열린 카드는 발행을 막지 않는다', async () => {
    const { usecase } = buildUsecase({
      openPreviews: [
        {
          id: 'preview-other',
          kind: 'PM_WRITE_BACK',
          payload: { pageId: draft.pageId },
        },
      ],
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result.status).toBe('preview');
  });

  // 외부 리뷰 지적 — "코드 한 글자도 바꾸지 마라" 를 프롬프트로만 두면 집행이 없다.
  it('편집이 코드블록을 바꾸면 발행하지 않고 실패로 끊는다', async () => {
    const { usecase, createPreview } = buildUsecase({
      completionText: JSON.stringify({
        slug: 'safe-post',
        description: '설명',
        body: '설명입니다.\n\n```php\n$row = query("SELECT 1");\n```',
      }),
      editText: JSON.stringify({
        publishable: true,
        reason: '요지는 분명하다.',
        title: '안전한 제목',
        slug: 'safe-post',
        description: '설명',
        body: '설명입니다.\n\n```php\n$row = query("SELECT 2");\n```',
      }),
    });

    await expect(
      usecase.execute({ titleQuery: '', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ blogErrorCode: 'BLOG_EDIT_CODE_CHANGED' });
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  // 외부 리뷰 지적 — 편집 검사는 anonymized.body 를 기준선으로 삼는다. 익명화가 이미 코드를
  // 고쳐 놓으면 그 변경이 기준선이 되어 그대로 통과한다. 초안에 코드가 없던 동안에는 드러나지
  // 않았고, 확장 프롬프트가 코드 예시를 요구하기 시작하면 이 구멍으로 실제 코드가 지나간다.
  it('익명화가 코드를 바꾸면 원문 기준으로 끊는다', async () => {
    const { usecase, createPreview } = buildUsecase({
      markdown:
        '레거시에서 이렇게 조회했다. 이 문장은 60% 가드를 넘길 만큼 길게 둔다.\n\n```php\n$row = query("SELECT 1");\n```',
      completionText: JSON.stringify({
        slug: 'safe-post',
        description: '설명',
        // 익명화가 테이블명을 지운다며 코드를 고친 상태.
        body: '레거시에서 이렇게 조회했다. 이 문장은 60% 가드를 넘길 만큼 길게 둔다.\n\n```php\n$row = query("SELECT masked");\n```',
      }),
    });

    await expect(
      usecase.execute({ titleQuery: '', slackUserId: 'U1' }),
    ).rejects.toThrow('코드블록이 원문과 다릅니다');
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('편집이 코드블록을 지우는 것은 허용한다 (추리기의 일부)', async () => {
    const { usecase } = buildUsecase({
      // 익명화는 코드를 그대로 둔다 — 원문에도 같은 코드블록이 있어야 실제 계약과 같다.
      markdown:
        '설명입니다. 이 문장은 충분히 길어야 60% 가드를 넘는다.\n\n```php\n$row = 1;\n```',
      completionText: JSON.stringify({
        slug: 'safe-post',
        description: '설명',
        body: '설명입니다. 이 문장은 충분히 길어야 60% 가드를 넘는다.\n\n```php\n$row = 1;\n```',
      }),
      editText: JSON.stringify({
        publishable: true,
        reason: '요지는 분명하다.',
        title: '안전한 제목',
        slug: 'safe-post',
        description: '설명',
        body: '설명입니다. 이 문장은 충분히 길어야 60% 가드를 넘는다. 코드는 지웠어요.',
      }),
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result.status).toBe('preview');
  });

  // 외부 리뷰 지적 — 편집본만 보고 통과시키면 윤문이 줄인 최종본은 검사되지 않는다.
  it('윤문이 본문을 크게 줄이면 최종본 기준으로 끊는다', async () => {
    const { usecase, createPreview } = buildUsecase({
      completionText: JSON.stringify({
        slug: 'safe-post',
        description: '설명',
        body: '가'.repeat(300),
      }),
      editText: JSON.stringify({
        publishable: true,
        reason: '요지는 분명하다.',
        title: '안전한 제목',
        slug: 'safe-post',
        description: '설명',
        body: '가'.repeat(300),
      }),
      // 윤문이 문단을 10자로 줄여 돌려주는 상황
      humanizeSuffix: undefined,
    });

    // humanize 목을 "크게 줄이는" 동작으로 갈아끼운다.
    const humanizer = (
      usecase as unknown as { humanizer: { humanize: jest.Mock } }
    ).humanizer;
    humanizer.humanize = jest.fn(async () => ({ '0': '짧게 줄였어요.' }));

    await expect(
      usecase.execute({ titleQuery: '', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ blogErrorCode: 'BLOG_EDIT_TOO_SHORT' });
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  // 외부 리뷰 지적 — 이 메시지는 자연어 멘션 경로에서 채널로도 나간다. 원제목은 익명화 전 값이다.
  it('보류 메시지의 Notion 원제목과 모델 이유에서 금지어를 가린다', async () => {
    const { usecase } = buildUsecase({
      drafts: [{ ...draft, title: '회사명 마이그레이션 회고' }],
      editText: JSON.stringify({
        publishable: false,
        reason: '회사명 내부 문서를 옮겨 적은 수준이다.',
        title: '',
        slug: '',
        description: '',
        body: '',
      }),
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    if (outcome.result.status !== 'skipped') {
      throw new Error('skipped 가 아니다');
    }
    expect(outcome.result.message).not.toContain('회사명');
    expect(outcome.result.message).toContain('회**');
  });

  it('편집이 본문을 60% 미만으로 줄이면 발행하지 않고 실패로 끊는다', async () => {
    const longBody = '가'.repeat(400);
    const { usecase, createPreview } = buildUsecase({
      completionText: JSON.stringify({
        slug: 'safe-post',
        description: '설명',
        body: longBody,
      }),
      editText: JSON.stringify({
        publishable: true,
        reason: '요지는 분명하다.',
        title: '안전한 제목',
        slug: 'safe-post',
        description: '설명',
        body: '가'.repeat(100),
      }),
    });

    await expect(
      usecase.execute({ titleQuery: '', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ blogErrorCode: 'BLOG_EDIT_TOO_SHORT' });
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  it('편집이 제목을 바꾸면 카드에 초안 제목도 함께 보여준다', async () => {
    const { usecase } = buildUsecase({
      editText: JSON.stringify({
        publishable: true,
        reason: '요지는 분명하다.',
        title: '공유 DB는 왜 조용히 어긋나는가',
        slug: 'shared-database-drift',
        description: '공유 DB 마이그레이션의 정합성 교훈',
        body: '# 공유 DB는 왜 조용히 어긋나는가\n\n익명화된 본문',
      }),
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    if (outcome.result.status !== 'preview') {
      throw new Error('preview 가 아니다');
    }
    expect(outcome.result.previewText).toContain(
      '제목: 공유 DB는 왜 조용히 어긋나는가',
    );
    expect(outcome.result.previewText).toContain(
      '(초안 제목: 공유 DB 마이그레이션 회고)',
    );
    expect(outcome.result.path).toContain('shared-database-drift');
  });

  // 리뷰 지적 — 최종 금지어 검사는 편집 제목만 본다. 편집이 안전한 제목으로 바꾸면
  // 원제목의 금지어가 이 줄로만 새어 나간다.
  it('카드에 실리는 초안 원제목도 금지어를 가린다', async () => {
    const { usecase } = buildUsecase({
      drafts: [{ ...draft, title: '회사명 마이그레이션 회고' }],
      editText: JSON.stringify({
        publishable: true,
        reason: '요지는 분명하다.',
        title: '공유 DB는 왜 조용히 어긋나는가',
        slug: 'shared-database-drift',
        description: '공유 DB 마이그레이션의 정합성 교훈',
        body: '# 공유 DB는 왜 조용히 어긋나는가\n\n익명화된 본문',
      }),
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    if (outcome.result.status !== 'preview') {
      throw new Error('preview 가 아니다');
    }
    expect(outcome.result.previewText).toContain(
      '(초안 제목: 회** 마이그레이션 회고)',
    );
    expect(outcome.result.previewText).not.toContain('회사명');
  });

  // 리뷰 지적 — 집합 비교는 [X, Y] → [X, X] 를 통과시킨다(Y 가 X 로 치환됨).
  it('코드블록이 다른 블록 내용으로 치환되거나 복제되면 끊는다', async () => {
    const first = '```php\n$a = 1;\n```';
    const second = '```php\n$b = 2;\n```';
    const { usecase, createPreview } = buildUsecase({
      completionText: JSON.stringify({
        slug: 'safe-post',
        description: '설명',
        body: `설명입니다.\n\n${first}\n\n중간 문단입니다.\n\n${second}`,
      }),
      editText: JSON.stringify({
        publishable: true,
        reason: '요지는 분명하다.',
        title: '안전한 제목',
        slug: 'safe-post',
        description: '설명',
        // 둘째 블록이 첫째 블록 내용으로 바뀌었다 — 집합으로 보면 통과한다.
        body: `설명입니다.\n\n${first}\n\n중간 문단입니다.\n\n${first}`,
      }),
    });

    await expect(
      usecase.execute({ titleQuery: '', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ blogErrorCode: 'BLOG_EDIT_CODE_CHANGED' });
    expect(createPreview.execute).not.toHaveBeenCalled();
  });

  // `42/43` 만 적혀 있으면 승인자도 사후 조사도 그 하나가 왜 빠졌는지 알 수 없다.
  it('건너뛴 문단이 있으면 카드에 사유를 적는다', async () => {
    const { usecase } = buildUsecase({
      editText: JSON.stringify({
        publishable: true,
        reason: '요지는 분명하다.',
        title: '안전한 제목',
        slug: 'safe-post',
        description: '설명',
        body: '# 제목\n\n첫 문단입니다.\n\n둘째 문단입니다.',
      }),
      humanizeSkipKeys: ['0'],
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    if (outcome.result.status !== 'preview') {
      throw new Error('preview 가 아니다');
    }
    expect(outcome.result.previewText).toContain(
      '말투: 1/2문단 적용 (건너뜀: 원문 그대로 1)',
    );
  });

  // 전 문단이 빠지면 `changedParagraphs === 0` 분기로 빠지는데, 거기서 사유를 버리면
  // **가장 심한 경우에 계측이 사라진다**. 모델이 빈 값만 돌려준 것과 호출이 실패한 것은
  // 원인이 다른데 둘 다 「원문 그대로 — 윤문 실패」로 찍히면 이 계측을 넣은 이유가 없다.
  it('전 문단이 빈 값이면 적용 안 됨에도 사유를 적는다', async () => {
    const { usecase } = buildUsecase({ humanizeAllEmpty: true });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    if (outcome.result.status !== 'preview') {
      throw new Error('preview 가 아니다');
    }
    expect(outcome.result.previewText).toContain(
      '말투: 적용 안 됨 (건너뜀: 빈 값 1)',
    );
    expect(outcome.result.previewText).not.toContain('원문 그대로 — 윤문 실패');
  });

  it('윤문이 먹지 않으면 카드에 그 사실을 적는다', async () => {
    const { usecase } = buildUsecase({ humanizeSuffix: null });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    if (outcome.result.status !== 'preview') {
      throw new Error('preview 가 아니다');
    }
    expect(outcome.result.previewText).toContain('말투: 적용 안 됨');
  });

  it('본문 코드블록은 윤문에 넘기지 않고 그대로 발행한다', async () => {
    const body = [
      '# 회고',
      '',
      '레거시에서 이렇게 조회했다.',
      '',
      '```php',
      '$row = query("SELECT 1");',
      '```',
    ].join('\n');
    const { usecase, humanizer } = buildUsecase({
      markdown: body,
      completionText: JSON.stringify({
        slug: 'safe-post',
        description: '설명',
        body,
      }),
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    if (outcome.result.status !== 'preview') {
      throw new Error('preview 가 아니다');
    }
    const passedToHumanizer = Object.values(
      humanizer.humanize.mock.calls[0][0],
    ).join('\n');
    expect(passedToHumanizer).not.toContain('SELECT 1');
    expect(outcome.result.content).toContain('$row = query("SELECT 1");');
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
      expect.objectContaining({ status: 'preview' }),
    );
  });

  // 기존 큐(회사 PR 회고 다수)는 하루 1건씩만 나간다. 오늘의 공부 초안을 뒤에 붙이면
  // 오늘 만든 글이 2주 뒤에 발행돼 기술 내용이 낡는다.
  it('오늘의 공부 초안은 더 오래된 초안보다 먼저 집는다', async () => {
    const oldPrDraft = {
      ...draft,
      pageId: 'page-old-pr',
      title: '오래된 PR 회고',
      sourceType: 'PR',
      createdTime: '2026-08-01T16:00:00.000Z',
    };
    const todayStudyDraft = {
      ...draft,
      pageId: 'page-study-today',
      title: '오늘의 공부 딥다이브',
      sourceType: '오늘의 공부',
      createdTime: '2026-08-20T02:00:00.000Z',
    };
    const { usecase, notionClient } = buildUsecase({
      drafts: [oldPrDraft, todayStudyDraft],
    });

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    expect(notionClient.getPageMarkdown).toHaveBeenCalledWith(
      'page-study-today',
    );
  });

  // 편집이 고른 분류가 발행본 frontmatter 까지 실제로 전달되는지 본다. 파서와 frontmatter
  // 생성기는 각각 덮여 있지만, 그 사이 배선이 끊기면 두 테스트 모두 통과하면서 분류만 조용히
  // 빠진다 — 프롬프트에만 필드를 넣고 출력 스키마를 빠뜨렸을 때 실제로 그렇게 됐다.
  it('편집이 고른 분류를 발행본 frontmatter 에 싣는다', async () => {
    const { usecase, createPreview } = buildUsecase({
      editText: JSON.stringify({
        publishable: true,
        reason: '요지가 분명하다.',
        title: '공유 DB 정합성',
        slug: 'shared-db-consistency',
        category: 'infra',
        description: '공유 DB 전환에서 배운 점.',
        body: '## 문제\n\n익명화된 본문을 정리한 결과입니다. 60% 가드를 넘길 만큼 길게 둔다.',
      }),
    });

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    const payload = createPreview.execute.mock.calls[0][0].payload as {
      content: string;
    };
    expect(payload.content).toContain('\ncategory: infra\n');
  });

  it('편집이 모르는 분류를 내면 frontmatter 에서 분류 줄을 빼고 발행한다', async () => {
    const { usecase, createPreview } = buildUsecase({
      editText: JSON.stringify({
        publishable: true,
        reason: '요지가 분명하다.',
        title: '공유 DB 정합성',
        slug: 'shared-db-consistency',
        category: 'devops',
        description: '공유 DB 전환에서 배운 점.',
        body: '## 문제\n\n익명화된 본문을 정리한 결과입니다. 60% 가드를 넘길 만큼 길게 둔다.',
      }),
    });

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    const payload = createPreview.execute.mock.calls[0][0].payload as {
      content: string;
    };
    expect(payload.content).not.toContain('category:');
  });

  // 익명화 계약이 출처별로 갈린다. 여기서 배선이 끊기면 프롬프트만 새로 쓰고 실제
  // 발행 경로는 그대로인 상태가 되는데, 산출물만 봐서는 구분되지 않는다.
  it('오늘의 공부 초안은 공개 프로젝트 익명화 계약으로 부른다', async () => {
    const studyDraft = { ...draft, sourceType: '오늘의 공부' };
    const { usecase, modelRouter } = buildUsecase({ drafts: [studyDraft] });

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    const anonymizeCall = modelRouter.route.mock.calls.find(
      ([input]) =>
        !String(input.request.systemPrompt).includes('블로그의 편집자'),
    );
    expect(anonymizeCall?.[0].request.systemPrompt).toBe(
      BLOG_ANONYMIZE_PUBLIC_PROJECT_SYSTEM_PROMPT,
    );
  });

  it('회사 PR 회고 초안은 기존 익명화 계약을 그대로 쓴다', async () => {
    const { usecase, modelRouter } = buildUsecase({
      drafts: [{ ...draft, sourceType: 'PR' }],
    });

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    const anonymizeCall = modelRouter.route.mock.calls.find(
      ([input]) =>
        !String(input.request.systemPrompt).includes('블로그의 편집자'),
    );
    expect(anonymizeCall?.[0].request.systemPrompt).toBe(
      BLOG_ANONYMIZE_SYSTEM_PROMPT,
    );
  });

  it('오늘의 공부 초안이 여러 건이면 그 안에서는 오래된 것부터 집는다', async () => {
    const yesterdayStudy = {
      ...draft,
      pageId: 'page-study-yesterday',
      sourceType: '오늘의 공부',
      createdTime: '2026-08-19T02:00:00.000Z',
    };
    const todayStudy = {
      ...draft,
      pageId: 'page-study-today',
      sourceType: '오늘의 공부',
      createdTime: '2026-08-20T02:00:00.000Z',
    };
    const { usecase, notionClient } = buildUsecase({
      drafts: [todayStudy, yesterdayStudy],
    });

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    expect(notionClient.getPageMarkdown).toHaveBeenCalledWith(
      'page-study-yesterday',
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

  // 실제 실패 케이스 (run#864). 개발 블로그 본문에는 코드 블록이 거의 항상 들어가는데,
  // 기존 mock 본문에는 코드펜스가 없어 3,000건 초록불에도 첫 실제 실행이 파싱에서 죽었다.
  it('익명화 본문에 마크다운 코드펜스가 있어도 발행 preview를 만든다', async () => {
    const { usecase, createPreview } = buildUsecase({
      markdown:
        '# 회고\n\n```php\n$row = query("SELECT 1");\n```\n\n## 교훈\n원장을 먼저 남긴다.',
      completionText: JSON.stringify({
        slug: 'shared-database-migration',
        description: '공유 DB 마이그레이션의 정합성 교훈',
        body: '# 회고\n\n```php\n$row = query("SELECT 1");\n```\n\n## 교훈\n원장을 먼저 남긴다.',
      }),
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result.status).toBe('preview');
    expect(createPreview.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          content: expect.stringContaining('```php'),
        }),
      }),
    );
  });

  it('익명화 파싱이 실패하면 cause 에 모델 raw 응답 앞부분을 남긴다', async () => {
    const { usecase } = buildUsecase({
      completionText: '죄송합니다. JSON 을 만들 수 없습니다.',
    });

    await expect(
      usecase.execute({ titleQuery: '', slackUserId: 'U1' }),
    ).rejects.toMatchObject({
      blogErrorCode: 'BLOG_ANONYMIZE_PARSE_FAILED',
      cause: expect.objectContaining({
        message: expect.stringContaining('raw=죄송합니다.'),
      }),
    });
  });

  // 외부 리뷰 지적 — cause 는 실패 로그로 나간다. 익명화가 깨진 응답에는 원문이 남을 수 있다.
  it('파싱 실패 로그에 실리는 모델 응답에서도 금지어를 가린다', async () => {
    const { usecase } = buildUsecase({
      completionText: '회사명 시스템 정리 중 오류가 났습니다.',
    });

    try {
      await usecase.execute({ titleQuery: '', slackUserId: 'U1' });
      throw new Error('여기 도달하면 안 된다');
    } catch (error: unknown) {
      const cause = (error as { cause?: Error }).cause;
      expect(cause?.message).toContain('raw=');
      expect(cause?.message).not.toContain('회사명');
    }
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

  // autopilot 이 이 판정으로 skip 여부를 정한다. mock 이 아니라 실제 ConfigService 경로로 확인한다 —
  // 잘못되면 설정 없는 환경에서 매일 FAILED AgentRun 이 쌓이거나, 반대로 조용히 안 돈다.
  it('속성명 env 가 없으면 기본값 상태/초안 으로 Notion 을 조회한다', async () => {
    const { usecase, notionClient } = buildUsecase({
      omitKeys: ['BLOG_NOTION_PROP_STATUS', 'BLOG_NOTION_STATUS_DRAFT_VALUE'],
    });

    await usecase.buildPublishCandidate({ slackUserId: 'U1' });

    expect(notionClient.queryDraftPages).toHaveBeenCalledWith(
      expect.objectContaining({
        statusPropertyName: '상태',
        statusValue: '초안',
      }),
    );
  });

  describe('isPublishConfigured', () => {
    it('필수 설정이 모두 있으면 true 를 반환한다', () => {
      const { usecase } = buildUsecase();

      expect(usecase.isPublishConfigured()).toBe(true);
    });

    // 실제 .env 에 BLOG_NOTION_PROP_STATUS 가 없어 저녁 task 가 조용히 건너뛴 적이 있다.
    // 기존 발행 경로는 DEFAULT_BLOG_PROP 으로 동작하므로 여기서만 필수로 요구하면 안 된다.
    it('노션 속성명·초안 상태값 env 가 없어도 기본값으로 동작한다', () => {
      const { usecase } = buildUsecase({
        omitKeys: ['BLOG_NOTION_PROP_STATUS', 'BLOG_NOTION_STATUS_DRAFT_VALUE'],
      });

      expect(usecase.isPublishConfigured()).toBe(true);
    });

    it('금지어 목록이 비어 있으면 false 를 반환한다 (.env.example 기본값)', () => {
      const { usecase } = buildUsecase({ forbiddenTerms: '' });

      expect(usecase.isPublishConfigured()).toBe(false);
    });
  });
});

describe('단계 경계 계측', () => {
  // 인용·헤딩이 통째로 사라져도 글자 수 가드는 통과한다. 그 손실이 어느 단계에서 났는지
  // 승인 카드와 원장 어디에도 남지 않아, 사후에 유도로만 좁힐 수 있었다.
  const 원문 = [
    '# 캐시 흐름',
    '',
    '> 인용 첫 줄',
    '> 인용 둘째 줄',
    '',
    '자세한 내용은 https://developer.mozilla.org 를 봤습니다.',
    '',
    '## 정리',
    '',
    '읽어보니 정리가 되었습니다.',
  ].join('\n');
  // 편집이 인용 한 줄과 헤딩 하나를 지운 판. **두 줄 다 지우지는 않는다** — 전부 소실은
  // `assertQuotesNotWiped` 가 끊으므로 계측 표시를 보는 예시로 쓸 수 없다.
  const 편집본 = [
    '# 캐시 흐름',
    '',
    '> 인용 첫 줄',
    '',
    '자세한 내용은 https://developer.mozilla.org 를 봤습니다.',
    '',
    '읽어보니 정리가 되었습니다.',
  ].join('\n');

  const buildForStages = () =>
    buildUsecase({
      markdown: 원문,
      completionText: JSON.stringify({
        slug: 'cache-flow',
        description: '캐시 흐름 정리',
        body: 원문,
      }),
      editText: JSON.stringify({
        publishable: true,
        reason: '발행 가능',
        title: draft.title,
        slug: 'cache-flow',
        description: '캐시 흐름 정리',
        body: 편집본,
      }),
    });

  it('승인 카드에 단계별 구조 수치를 한 줄로 적는다', async () => {
    const { usecase, createPreview } = buildForStages();

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    const previewText = createPreview.execute.mock.calls[0][0]
      .previewText as string;
    const 구조줄 = previewText
      .split('\n')
      .find((line) => line.startsWith('구조('));
    expect(구조줄).toBeDefined();
    expect(구조줄).toContain('구조(원문→익명화→편집→최종)');
    // 편집 단계에서 인용 2줄이 사라진 것이 그대로 읽혀야 한다.
    expect(구조줄).toContain('인용 2→2→1→1');
    expect(구조줄).toContain('헤딩 2→2→1→1');
  });

  it('원장 output 에 단계별 수치를 남긴다 (본문은 담지 않는다)', async () => {
    const { usecase, runOutputs } = buildForStages();

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    const stages = (runOutputs[0] as { stages: Array<Record<string, unknown>> })
      .stages;
    expect(stages.map((stage) => stage.stage)).toEqual([
      '원문',
      '익명화',
      '편집',
      '최종',
    ]);
    expect(stages.map((stage) => stage.quotes)).toEqual([2, 2, 1, 1]);
    // 숫자만 담는다 — 단계별 본문을 담으면 원장이 같은 글 네 벌로 부푼다.
    for (const stage of stages) {
      expect(Object.keys(stage).sort()).toEqual([
        'chars',
        'codeBlocks',
        'headings',
        'links',
        'quotes',
        'stage',
      ]);
    }
  });

  // 과삭제로 끊긴 회차야말로 무엇이 사라졌는지 알아야 하는 회차다(실측 통과율 1/4).
  // 이 경로는 예외로 끊겨 원장에 `output: { error }` 만 남으므로, 수치는 메시지에 실린다.
  it('과삭제로 끊긴 회차는 실패 메시지에 편집 단계까지의 수치를 싣는다', async () => {
    const 긴원문 = ['# 제목', '', '> 인용', '', '가'.repeat(400)].join('\n');
    const { usecase } = buildUsecase({
      markdown: 긴원문,
      completionText: JSON.stringify({
        slug: 'over-trim',
        description: '과삭제 사례',
        body: 긴원문,
      }),
      editText: JSON.stringify({
        publishable: true,
        reason: '발행 가능',
        title: draft.title,
        slug: 'over-trim',
        description: '과삭제 사례',
        body: '# 제목\n\n가',
      }),
    });

    await expect(
      usecase.execute({ titleQuery: '', slackUserId: 'U1' }),
    ).rejects.toThrow(
      // 인용 1줄이 편집에서 사라진 것까지 실패 기록에 남는다 — 글자 수 두 개만으로는
      // 무엇을 잃었는지 알 수 없었다.
      /미만으로 줄었습니다 \(\d+자 → \d+자\)\. 구조\(원문→익명화→편집\): .*인용 1→1→0/,
    );
  });
});

// 금지어 차단은 과삭제와 성질이 다르다 — 사람이 Notion 을 고치기 전까지 매일 같은 결과를 낸다.
// 발행 슬롯이 하루 1회라 그 한 건이 뒤에 쌓인 초안 전부를 무기한 막는다(실측 큐 20건).
describe('차단된 초안 큐 막힘', () => {
  const 막힌초안 = {
    ...draft,
    pageId: 'page-blocked',
    title: '차단된 회고',
    createdTime: '2026-08-01T00:00:00.000Z',
  };
  const 다음초안 = {
    ...draft,
    pageId: 'page-next',
    title: '다음 회고',
    createdTime: '2026-08-10T00:00:00.000Z',
  };
  // 원장이 돌려주는 형태 그대로 — 차단은 예외가 아니라 정상 종료라 SUCCEEDED 로 남는다.
  const 차단이력 = [
    {
      output: { status: 'blocked', message: '금지어가 남았습니다.' },
      inputSnapshot: { pageId: '막힌초안-자리표시' },
    },
  ];

  it('최근 차단된 초안은 뒤로 미루고 다음 초안을 집는다', async () => {
    const { usecase, notionClient } = buildUsecase({
      drafts: [막힌초안, 다음초안],
      recentRuns: [
        {
          ...차단이력[0],
          inputSnapshot: { pageId: 막힌초안.pageId },
        },
      ],
    });

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    // 오래된 순이라면 막힌초안(8/1)이 먼저다. 차단 이력이 그 순서를 뒤집어야 한다.
    expect(notionClient.getPageMarkdown).toHaveBeenCalledWith(다음초안.pageId);
  });

  // 제외가 아니라 후순위다 — 사람이 고쳤는지 코드가 알 방법이 없으니 영구 배제는 위험하다.
  it('큐에 막힌 초안뿐이면 그래도 시도한다', async () => {
    const { usecase, notionClient } = buildUsecase({
      drafts: [막힌초안],
      recentRuns: [
        {
          ...차단이력[0],
          inputSnapshot: { pageId: 막힌초안.pageId },
        },
      ],
    });

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    expect(notionClient.getPageMarkdown).toHaveBeenCalledWith(막힌초안.pageId);
  });

  // 사람이 그 글을 콕 집었으면 차단 이력과 무관하게 그 글을 돌린다.
  it('제목으로 지목하면 후순위를 적용하지 않는다', async () => {
    const { usecase, notionClient, agentRunService } = buildUsecase({
      drafts: [막힌초안, 다음초안],
      recentRuns: [
        {
          ...차단이력[0],
          inputSnapshot: { pageId: 막힌초안.pageId },
        },
      ],
    });

    await usecase.execute({ titleQuery: '차단된', slackUserId: 'U1' });

    expect(notionClient.getPageMarkdown).toHaveBeenCalledWith(막힌초안.pageId);
    // 지목 요청에서는 원장을 읽을 이유도 없다.
    expect(agentRunService.findRecentSucceededRuns).not.toHaveBeenCalled();
  });

  // 차단이 아닌 성공 회차까지 뒤로 미루면 정상 초안이 이유 없이 밀린다.
  it('성공한 회차의 초안은 미루지 않는다', async () => {
    const { usecase, notionClient } = buildUsecase({
      drafts: [막힌초안, 다음초안],
      recentRuns: [
        {
          output: { status: 'preview', previewId: 'preview-1' },
          inputSnapshot: { pageId: 막힌초안.pageId },
        },
      ],
    });

    await usecase.execute({ titleQuery: '', slackUserId: 'U1' });

    expect(notionClient.getPageMarkdown).toHaveBeenCalledWith(막힌초안.pageId);
  });

  // 원장이 안 읽힌다고 그날 발행 자체를 막으면 손해가 더 크다.
  it('차단 이력 조회가 깨져도 발행을 진행한다', async () => {
    const { usecase, notionClient } = buildUsecase({
      drafts: [막힌초안, 다음초안],
      recentRunsError: new Error('DB 연결 실패'),
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result.status).toBe('preview');
    expect(notionClient.getPageMarkdown).toHaveBeenCalledWith(막힌초안.pageId);
  });
});

// 정렬 직후에 큐 머리를 들여다보면, 초안 큐가 빈 채로 pageId 재실행이 들어올 때 터진다.
// 그 경로는 "초안을 찾을 수 없습니다" 라는 제대로 된 예외가 나야 하는 자리다.
describe('빈 큐에서 pageId 재실행', () => {
  it('초안 목록이 비어 있어도 DRAFT_NOT_FOUND 로 끊는다', async () => {
    const { usecase } = buildUsecase({ drafts: [] });

    await expect(
      usecase.execute({
        titleQuery: '',
        slackUserId: 'U1',
        pageId: 'page-gone',
      }),
    ).rejects.toThrow('찾을 수 없습니다');
  });
});

// 글자 수 가드는 인용 소실에 눈이 멀어 있다 — 인용 7줄은 200자 남짓이라 60% 문턱을 넘고도
// 통째로 사라질 수 있다. 실측된 회귀가 정확히 그 형태였다(리뷰 지적).
describe('인용 전부 소실 차단', () => {
  const 인용본문 = [
    '# 캐시 흐름',
    '',
    '> 인용 첫 줄',
    '> 인용 둘째 줄',
    '',
    '가'.repeat(300),
  ].join('\n');

  const buildWithEdited = (editedBody: string) =>
    buildUsecase({
      markdown: 인용본문,
      completionText: JSON.stringify({
        slug: 'cache-flow',
        description: '캐시 흐름 정리',
        body: 인용본문,
      }),
      editText: JSON.stringify({
        publishable: true,
        reason: '발행 가능',
        title: draft.title,
        slug: 'cache-flow',
        description: '캐시 흐름 정리',
        body: editedBody,
      }),
    });

  it('글자 비율은 통과하지만 인용만 사라진 편집본을 끊는다', async () => {
    // 인용 두 줄(14자)만 뺀다 — 글자 수로는 98% 라 과삭제 가드를 여유롭게 통과한다.
    const { usecase } = buildWithEdited(
      ['# 캐시 흐름', '', '가'.repeat(300)].join('\n'),
    );

    await expect(
      usecase.execute({ titleQuery: '', slackUserId: 'U1' }),
    ).rejects.toThrow(/인용 2줄이 모두 사라졌습니다.*인용 2→2→0/);
  });

  // 한 줄이라도 남으면 정당한 편집일 수 있다(중복 인용 덜어내기). 임계값을 세울 근거가 없다.
  it('인용이 일부만 줄면 통과시킨다', async () => {
    const { usecase } = buildWithEdited(
      ['# 캐시 흐름', '', '> 인용 첫 줄', '', '가'.repeat(300)].join('\n'),
    );

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result.status).toBe('preview');
  });

  // 인용을 쓰지 않은 초안이 이 검사에 걸리면 그런 글은 영영 발행되지 않는다.
  it('원문에 인용이 없으면 검사하지 않는다', async () => {
    const 인용없는본문 = ['# 캐시 흐름', '', '가'.repeat(300)].join('\n');
    const { usecase } = buildUsecase({
      markdown: 인용없는본문,
      completionText: JSON.stringify({
        slug: 'cache-flow',
        description: '캐시 흐름 정리',
        body: 인용없는본문,
      }),
      editText: JSON.stringify({
        publishable: true,
        reason: '발행 가능',
        title: draft.title,
        slug: 'cache-flow',
        description: '캐시 흐름 정리',
        body: 인용없는본문,
      }),
    });

    const outcome = await usecase.execute({
      titleQuery: '',
      slackUserId: 'U1',
    });

    expect(outcome.result.status).toBe('preview');
  });
});
