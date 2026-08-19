import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  buildJsonParseCauseMessage,
  extractJsonObjectText,
} from '../../../common/util/llm-json-extract.util';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeMarkdownProse } from '../../../humanize/application/humanize-markdown.adapter';
import {
  formatKoreanStyleMetrics,
  measureKoreanStyle,
} from '../../../humanize/domain/korean-style-metrics';
import {
  extractFencedCodeBlocks,
  HumanizeMarkdownResult,
} from '../../../humanize/domain/markdown-blocks';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
  NotionDraftPage,
} from '../../../notion/domain/port/notion-client.port';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { buildAstroPost } from '../domain/astro-post';
import { BlogException } from '../domain/blog.exception';
import {
  BlogGithubPublishPayload,
  BlogPublishCandidate,
  PublishNotionDraftInput,
  PublishNotionDraftResult,
} from '../domain/blog.type';
import { BlogErrorCode } from '../domain/blog-error-code.enum';
import {
  buildBlogStatusProperty,
  DEFAULT_BLOG_PROP,
  DEFAULT_BLOG_STATUS_DRAFT,
  DEFAULT_BLOG_STATUS_HOLD,
} from '../domain/blog-publish-properties';
import { ForbiddenHit, scanForbiddenTerms } from '../domain/company-info-scan';
import { BLOG_ANONYMIZE_SYSTEM_PROMPT } from '../domain/prompt/blog-anonymize.prompt';
import {
  EditedBlogDraft,
  parseBlogEdit,
} from '../domain/prompt/blog-edit.parser';
import {
  BLOG_EDIT_SYSTEM_PROMPT,
  buildBlogEditPrompt,
} from '../domain/prompt/blog-edit.prompt';
import {
  BLOG_ANONYMIZE_OUTPUT_SCHEMA,
  BLOG_EDIT_OUTPUT_SCHEMA,
} from '../domain/prompt/blog-publish.schema';

// autopilot 의 T1_PREVIEW 와 같은 24시간. 1시간은 이미 실패로 판명된 값이다 — 저녁 블로그 카드가
// 짧은 TTL 때문에 반복적으로 EXPIRED 로 유실돼 autopilot.orchestrator.ts:24 에서 24시간으로 올렸다.
// 이 카드는 글 전문을 읽고 마스킹을 검토한 뒤 누르는 성격이라 더 긴 여유가 필요하다.
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1_000;

// 편집 단계가 '발행 가능' 으로 판정한 결과만 골라낸 타입. 파라미터 타입을 인라인으로 쓰지 않는다.
type PublishableBlogDraft = Extract<EditedBlogDraft, { publishable: true }>;

interface AnonymizedBlogDraft {
  slug: string;
  description: string;
  body: string;
}

interface PublishCandidateContext {
  databaseId: string;
  forbiddenTerms: string[];
  statusPropertyName: string;
  statusValue: string;
  // 편집 단계가 '발행 부적합' 으로 판정한 초안을 옮길 상태값.
  holdStatusValue: string;
}

// 편집이 원문을 이 비율 미만으로 줄이면 과삭제로 보고 끊는다. 덜어내기는 편집의 일이지만,
// 본문 절반이 사라지는 것은 "정리" 가 아니라 사고다.
const MIN_EDITED_BODY_RATIO = 0.6;

interface BuiltPublishCandidate {
  candidate: BlogPublishCandidate;
  modelUsed: string;
}

@Injectable()
export class PublishNotionDraftUsecase {
  private readonly logger = new Logger(PublishNotionDraftUsecase.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly createPreview: CreatePreviewUsecase,
    private readonly config: ConfigService,
    private readonly humanizer: HumanizeService,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
  ) {}

  async execute(
    input: PublishNotionDraftInput,
  ): Promise<AgentRunOutcome<PublishNotionDraftResult>> {
    const context = this.getPublishCandidateContext();
    const titleQuery = input.titleQuery?.trim() ?? '';

    return this.agentRunService.execute<PublishNotionDraftResult>({
      agentType: AgentType.BLOG_PUBLISH,
      triggerType: input.triggerType ?? TriggerType.SLACK_COMMAND_BLOG_PUBLISH,
      inputSnapshot: {
        slackUserId: input.slackUserId,
        ...(titleQuery ? { titleQuery } : {}),
        ...(input.pageId ? { pageId: input.pageId } : {}),
      },
      evidence: [
        {
          sourceType: 'NOTION_BLOG_DRAFT',
          sourceId: context.databaseId,
          payload: { titleQuery },
        },
      ],
      run: async ({ updateInputSnapshot }) => {
        const built = await this.buildPublishCandidateWithContext(
          input,
          context,
          updateInputSnapshot,
        );
        const candidate = built.candidate;
        if (candidate.status !== 'ready') {
          const result: PublishNotionDraftResult = candidate;
          return { result, modelUsed: built.modelUsed, output: result };
        }
        const preview = await this.createPreview.execute({
          slackUserId: input.slackUserId,
          kind: PREVIEW_KIND.BLOG_GITHUB_PUBLISH,
          payload: candidate.payload,
          previewText: candidate.previewText,
          responseUrl: input.responseUrl ?? null,
          ttlMs: PREVIEW_TTL_MS,
        });
        const result: PublishNotionDraftResult = {
          status: 'preview',
          previewId: preview.id,
          previewText: candidate.previewText,
          title: candidate.title,
          notionUrl: candidate.notionUrl,
          path: candidate.path,
          content: candidate.content,
        };
        return { result, modelUsed: built.modelUsed, output: result };
      },
    });
  }

  // modelUsed 를 함께 돌려준다 — autopilot 경로가 이 값을 AgentRun 에 기록해야
  // 저녁마다 도는 익명화 호출이 원장(실패율·소요시간·쿼터)에 잡힌다.
  async buildPublishCandidate(
    input: PublishNotionDraftInput,
  ): Promise<{ candidate: BlogPublishCandidate; modelUsed: string }> {
    return this.buildPublishCandidateWithContext(
      input,
      this.getPublishCandidateContext(),
    );
  }

  private async buildPublishCandidateWithContext(
    input: PublishNotionDraftInput,
    context: PublishCandidateContext,
    updateInputSnapshot?: (snapshot: Record<string, unknown>) => Promise<void>,
  ): Promise<BuiltPublishCandidate> {
    const titleQuery = input.titleQuery?.trim() ?? '';
    const drafts = await this.notionClient.queryDraftPages({
      databaseId: context.databaseId,
      statusPropertyName: context.statusPropertyName,
      statusValue: context.statusValue,
    });
    if (drafts.length === 0 && !input.pageId) {
      return {
        candidate: { status: 'empty', message: '발행할 초안이 없습니다.' },
        modelUsed: 'deterministic',
      };
    }

    const target = this.selectDraft(drafts, titleQuery, input.pageId);
    if (updateInputSnapshot) {
      await updateInputSnapshot({
        slackUserId: input.slackUserId,
        ...(titleQuery ? { titleQuery } : {}),
        pageId: target.pageId,
      });
    }
    // 아직 응답하지 않은 발행 카드가 열려 있으면 이번 회차는 넘긴다. 없으면 같은 글 카드가
    // 두 장 뜨고 모델 호출 세 번이 그대로 낭비된다(카드 수명 24시간 = 저녁 크론 한 번과 겹친다).
    const openCard = await this.findOpenPublishCard(target.pageId);
    if (openCard) {
      return {
        candidate: {
          status: 'skipped',
          cause: 'card-open',
          message: `'${this.maskForbidden(target.title, context.forbiddenTerms)}' 발행 승인 카드가 아직 열려 있습니다. 그 카드를 처리하면 다음 초안으로 넘어갑니다.`,
        },
        modelUsed: 'deterministic',
      };
    }

    const markdown = await this.notionClient.getPageMarkdown(target.pageId);
    if (markdown.trim().length === 0) {
      throw new BlogException({
        code: BlogErrorCode.EMPTY_DRAFT_BODY,
        message: `Notion 초안 '${target.title}'의 본문이 비어 있습니다.`,
        status: DomainStatus.BAD_REQUEST,
      });
    }

    const completion = await this.modelRouter.route({
      agentType: AgentType.BLOG_PUBLISH,
      request: {
        systemPrompt: BLOG_ANONYMIZE_SYSTEM_PROMPT,
        prompt: this.buildAnonymizePrompt(target, markdown),
        // 형태를 샘플링 단계에서 고정한다 — 코드펜스로 감싸거나 앞뒤에 설명을 붙일 수 없다.
        outputSchema: BLOG_ANONYMIZE_OUTPUT_SCHEMA,
      },
    });
    const anonymized = this.withMaskedCause(
      () => this.parseAnonymizedDraft(completion.text),
      context.forbiddenTerms,
    );

    // 2) 편집 — 요지를 정하고 발행할 만한 글로 추린다. 익명화(치환)와 계약이 반대라 호출을 나눈다.
    const edited = await this.editDraft(target, anonymized, context);
    if (!edited.publishable) {
      await this.holdDraft(target, context, edited.reason);
      return {
        candidate: {
          status: 'skipped',
          // Notion 원제목은 익명화를 거치지 않은 값이고, 이 메시지는 자연어 멘션 경로에서
          // 채널로도 나간다. 정상 차단 경로가 원문을 마스킹하는 것과 정책을 맞춘다.
          cause: 'hold',
          message: `'${this.maskForbidden(target.title, context.forbiddenTerms)}' 은 발행하지 않고 보류로 옮겼습니다 — ${this.maskForbidden(edited.reason, context.forbiddenTerms)}`,
        },
        modelUsed: completion.modelUsed,
      };
    }
    // 편집이 코드를 바꾸지 않았는지 대조한다. 프롬프트로만 금지하면 집행이 없다 —
    // 공개 저장소에 잘못된 코드가 나가는 것을 막는 마지막 결정론 검사다. 삭제는 허용한다(추리기).
    this.assertCodeBlocksPreserved(target, anonymized.body, edited.body);
    this.assertNotOverTrimmed(target, anonymized.body, edited.body);

    // 3) 말투 — 산문 문단만 사용자 문체로 윤문한다(코드·표·헤딩은 손대지 않는다).
    const humanized = await humanizeMarkdownProse(edited.body, this.humanizer);

    // 윤문이 문단을 크게 줄일 수도 있어 **최종 발행본 기준으로 한 번 더** 본다.
    // 편집본만 보고 통과시키면 최종본이 원문의 60% 미만인 채 발행될 수 있다.
    this.assertNotOverTrimmed(target, anonymized.body, humanized.markdown);

    // 제목·주소·요약의 정본은 편집 단계다. 셋을 한 단계에서 정해야 제목과 URL 이 어긋나지 않는다.
    const post = buildAstroPost({
      title: edited.title,
      description: edited.description,
      slug: edited.slug,
      tags: target.tags,
      // 초안을 쓴 날이 아니라 발행하는 날로 찍는다 — 밀린 초안이 목록 아래에 묻히지 않게.
      publishedAt: new Date().toISOString(),
      pageId: target.pageId,
      body: humanized.markdown,
    });
    const hits = scanForbiddenTerms(
      // frontmatter title/description은 모델 body와 별도 입력이므로 함께 검사하지 않으면
      // 본문은 안전해도 메타데이터에서 회사·기관명이 그대로 발행될 수 있다.
      // slug 과 최종 path 도 같은 이유 — 본문이 안전해도 모델이 slug 에 남긴 ASCII 식별자는
      // 공개 저장소의 커밋 경로와 URL 에 영구히 박힌다. 정규화 전후 표기가 다르므로 둘 다 넣는다.
      // 검사는 파이프라인 **끝**에서 한 번 — 편집·윤문이 만들어낸 표현까지 걸러야 한다.
      {
        body: `${edited.title}\n${edited.description}\n${edited.slug}\n${post.path}\n${humanized.markdown}`,
        tags: target.tags,
      },
      context.forbiddenTerms,
    );
    if (hits.length > 0) {
      return {
        candidate: {
          status: 'blocked',
          message: this.buildForbiddenMessage(hits),
          hits,
        },
        modelUsed: completion.modelUsed,
      };
    }

    const previewText = this.buildPreviewText(
      target,
      post.path,
      edited,
      humanized,
      context.forbiddenTerms,
    );
    const payload: BlogGithubPublishPayload = {
      pageId: target.pageId,
      path: post.path,
      content: post.content,
      title: edited.title,
      notionUrl: target.url,
      tags: target.tags,
      summary: edited.description,
      slackUserId: input.slackUserId,
    };
    return {
      candidate: {
        status: 'ready',
        payload,
        previewText,
        title: edited.title,
        notionUrl: target.url,
        path: post.path,
        content: post.content,
      },
      modelUsed: completion.modelUsed,
    };
  }

  // 자동 실행(autopilot) 전용 사전 점검. 수동 경로는 설정이 없으면 **실패해야** 사용자가
  // 무엇을 안 채웠는지 알 수 있지만, 매일 도는 cron 에서 같은 예외는 FAILED AgentRun 만
  // 쌓는 소음이 된다. 블로그 발행을 설정하지 않은 환경에서는 task 가 조용히 건너뛰게 한다.
  isPublishConfigured(): boolean {
    try {
      this.getPublishCandidateContext();
      return true;
    } catch (error: unknown) {
      if (
        error instanceof BlogException &&
        error.blogErrorCode === BlogErrorCode.PUBLISH_CONFIG_REQUIRED
      ) {
        return false;
      }
      throw error;
    }
  }

  private getPublishCandidateContext(): PublishCandidateContext {
    return {
      forbiddenTerms: this.getForbiddenTerms(),
      databaseId: this.getRequiredConfig(
        'EVENING_RETRO_BLOG_NOTION_DATABASE_ID',
      ),
      // 속성명·상태값은 env 가 없으면 레포 기본값을 쓴다. 기존 발행 경로
      // (buildBlogPublishProperties) 가 이미 DEFAULT_BLOG_PROP 으로 동작하는데 여기서만
      // 필수로 요구하면, 같은 DB 를 쓰는 환경이 이 기능에서만 조용히 skip 된다.
      // 실제로 사용자 .env 에 BLOG_NOTION_PROP_STATUS 가 없어 저녁 task 가 건너뛰었다.
      statusPropertyName:
        this.config.get<string>('BLOG_NOTION_PROP_STATUS')?.trim() ||
        DEFAULT_BLOG_PROP.status,
      statusValue:
        this.config.get<string>('BLOG_NOTION_STATUS_DRAFT_VALUE')?.trim() ||
        DEFAULT_BLOG_STATUS_DRAFT,
      holdStatusValue:
        this.config.get<string>('BLOG_NOTION_STATUS_HOLD_VALUE')?.trim() ||
        DEFAULT_BLOG_STATUS_HOLD,
    };
  }

  private selectDraft(
    drafts: NotionDraftPage[],
    titleQuery: string,
    pageId?: string,
  ): NotionDraftPage {
    const oldestFirst = [...drafts].sort((first, second) =>
      first.createdTime.localeCompare(second.createdTime),
    );
    if (pageId) {
      const replayTarget = oldestFirst.find((draft) => draft.pageId === pageId);
      if (replayTarget) {
        return replayTarget;
      }
      throw new BlogException({
        code: BlogErrorCode.DRAFT_NOT_FOUND,
        message: `재실행 대상 Notion 초안(${pageId})을 찾을 수 없습니다. 상태가 여전히 초안인지 확인해주세요.`,
        status: DomainStatus.NOT_FOUND,
      });
    }
    if (!titleQuery) {
      return oldestFirst[0];
    }
    const normalizedQuery = titleQuery.toLocaleLowerCase('ko-KR');
    const found = oldestFirst.find((draft) =>
      draft.title.toLocaleLowerCase('ko-KR').includes(normalizedQuery),
    );
    if (!found) {
      throw new BlogException({
        code: BlogErrorCode.DRAFT_NOT_FOUND,
        message: `제목에 '${titleQuery}'가 포함된 초안이 없습니다. 현재 초안: ${oldestFirst
          .map((draft) => draft.title)
          .join(', ')}`,
        status: DomainStatus.NOT_FOUND,
      });
    }
    return found;
  }

  private parseAnonymizedDraft(text: string): AnonymizedBlogDraft {
    try {
      const parsed = JSON.parse(extractJsonObjectText(text)) as unknown;
      if (!isAnonymizedBlogDraft(parsed)) {
        throw new Error('slug, description, body 문자열이 필요합니다.');
      }
      return parsed;
    } catch (error: unknown) {
      // 형제 parser (PM / BE / BE_DIFF / ISSUE_LABELER / WORK_REVIEWER) 와 같은 규약으로
      // raw 응답 앞부분을 cause 에 실어 보낸다. 이게 없으면 실패 원인이 원장에도 로그에도
      // 남지 않아 (run#864) 다음 실패에서도 모델이 무엇을 돌려줬는지 알 수 없다.
      throw new BlogException({
        code: BlogErrorCode.ANONYMIZE_PARSE_FAILED,
        message: '블로그 익명화 결과를 해석하지 못했습니다.',
        status: DomainStatus.BAD_GATEWAY,
        cause: new Error(buildJsonParseCauseMessage(error, text)),
      });
    }
  }

  private buildAnonymizePrompt(
    draft: NotionDraftPage,
    markdown: string,
  ): string {
    return [
      '[Notion 블로그 초안 메타데이터]',
      `제목: ${draft.title}`,
      `카테고리: ${draft.category}`,
      `출처유형: ${draft.sourceType}`,
      `태그: ${draft.tags.join(', ')}`,
      `요약: ${draft.summary}`,
      '',
      '[원문 Markdown]',
      markdown,
    ].join('\n');
  }

  private buildPreviewText(
    draft: NotionDraftPage,
    path: string,
    edited: PublishableBlogDraft,
    humanized: HumanizeMarkdownResult,
    forbiddenTerms: string[],
  ): string {
    const lines = ['*GitHub 블로그 발행 미리보기*', `제목: ${edited.title}`];
    // 편집이 제목을 바꿨으면 초안 제목도 함께 보여준다 — 무엇이 바뀌었는지 모르고 ✅ 를
    // 누르는 상황을 만들지 않는다.
    //
    // 원제목은 **마스킹해서** 넣는다. 최종 금지어 검사는 edited.title 만 보므로, 편집이
    // 안전한 제목으로 바꾼 경우 원제목의 금지어가 이 줄로만 새어 나간다(리뷰 지적).
    if (edited.title !== draft.title) {
      lines.push(
        `(초안 제목: ${this.maskForbidden(draft.title, forbiddenTerms)})`,
      );
    }
    lines.push(
      `경로: \`${path}\``,
      `요약: ${edited.description}`,
      `Notion: ${draft.url}`,
      ...this.buildStageNote(humanized),
      '',
      '아래 전문을 확인한 뒤 ✅ 적용 / ❌ 취소를 눌러주세요.',
    );
    return lines.join('\n');
  }

  // 어느 단계가 실제로 먹었는지 카드에 적는다. 윤문이 조용히 빠져도(플래그 off·모델 실패)
  // 카드만 보고 알 수 있어야 한다 — 원문 발행을 막지 않는 대신 상황을 드러내는 쪽을 골랐다.
  private buildStageNote(humanized: HumanizeMarkdownResult): string[] {
    const stage = ((): string => {
      if (humanized.proseParagraphs === 0) {
        return '정리: 편집 완료 · 말투: 윤문할 산문 문단 없음';
      }
      if (humanized.changedParagraphs === 0) {
        return '정리: 편집 완료 · 말투: 적용 안 됨(원문 그대로 — 윤문 실패 또는 비활성)';
      }
      return `정리: 편집 완료 · 말투: ${humanized.changedParagraphs}/${humanized.proseParagraphs}문단 적용`;
    })();
    // 지표는 판정이 아니라 관측값이다 — 차단 임계값은 발행본이 몇 편 쌓인 뒤에 정한다.
    return [
      stage,
      formatKoreanStyleMetrics(measureKoreanStyle(humanized.markdown)),
    ];
  }

  // 편집 단계 — 익명화된 본문을 받아 요지를 정하고 발행 가능 여부까지 판정한다.
  private async editDraft(
    draft: NotionDraftPage,
    anonymized: AnonymizedBlogDraft,
    context: PublishCandidateContext,
  ): Promise<EditedBlogDraft> {
    const completion = await this.modelRouter.route({
      agentType: AgentType.BLOG_PUBLISH,
      request: {
        systemPrompt: BLOG_EDIT_SYSTEM_PROMPT,
        outputSchema: BLOG_EDIT_OUTPUT_SCHEMA,
        prompt: buildBlogEditPrompt({
          title: draft.title,
          category: draft.category,
          tags: draft.tags,
          summary: draft.summary,
          markdown: anonymized.body,
        }),
      },
    });
    return this.withMaskedCause(
      () => parseBlogEdit(completion.text),
      context.forbiddenTerms,
    );
  }

  // 발행 부적합 초안을 보류 상태로 옮긴다. 실패하면 예외를 그대로 올린다 — 조용히 넘기면
  // 같은 초안이 매일 다시 뽑혀 뒤에 있는 초안이 영구히 발행되지 않는다.
  private async holdDraft(
    draft: NotionDraftPage,
    context: PublishCandidateContext,
    reason: string,
  ): Promise<void> {
    // 반환 메시지에만 마스킹을 걸면 같은 값이 로그로 새어 나간다(리뷰 지적).
    this.logger.log(
      `Notion 초안 '${this.maskForbidden(draft.title, context.forbiddenTerms)}' 을 '${context.holdStatusValue}' 로 옮깁니다 — ${this.maskForbidden(reason, context.forbiddenTerms)}`,
    );
    await this.notionClient.updatePageProperties({
      pageId: draft.pageId,
      properties: buildBlogStatusProperty(context.holdStatusValue, {
        ...DEFAULT_BLOG_PROP,
        status: context.statusPropertyName,
      }),
    });
  }

  private assertCodeBlocksPreserved(
    draft: NotionDraftPage,
    before: string,
    after: string,
  ): void {
    // 집합이 아니라 **개수까지** 센다. Set 으로 보면 원문 [X, Y] 가 [X, X] 로 바뀌어도
    // (Y 가 X 로 치환되거나 X 가 복제돼도) 통과한다 — 코드 변경을 놓치는 구멍이다(리뷰 지적).
    const budget = new Map<string, number>();
    for (const block of extractFencedCodeBlocks(before)) {
      budget.set(block, (budget.get(block) ?? 0) + 1);
    }
    const changed = extractFencedCodeBlocks(after).filter((block) => {
      const remaining = budget.get(block) ?? 0;
      if (remaining === 0) {
        return true;
      }
      budget.set(block, remaining - 1);
      return false;
    });
    if (changed.length === 0) {
      return;
    }
    throw new BlogException({
      code: BlogErrorCode.EDIT_CODE_CHANGED,
      message: `'${draft.title}' 편집 결과의 코드블록이 원문과 다릅니다 (${changed.length}개). 코드는 편집 대상이 아닙니다.`,
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  private assertNotOverTrimmed(
    draft: NotionDraftPage,
    before: string,
    after: string,
  ): void {
    const beforeLength = before.trim().length;
    const afterLength = after.trim().length;
    if (afterLength >= beforeLength * MIN_EDITED_BODY_RATIO) {
      return;
    }
    throw new BlogException({
      code: BlogErrorCode.EDIT_TOO_SHORT,
      message: `'${draft.title}' 편집 결과가 원문의 ${Math.round(
        MIN_EDITED_BODY_RATIO * 100,
      )}% 미만으로 줄었습니다 (${beforeLength}자 → ${afterLength}자).`,
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  // 파싱 실패 cause 에는 모델 raw 응답 앞부분이 실린다(원인 추적에 필요). 다만 익명화가
  // 깨진 응답에는 원문 회사명이 그대로 되풀이될 수 있어, 로그로 나가기 전에 가린다.
  private withMaskedCause<T>(run: () => T, terms: string[]): T {
    try {
      return run();
    } catch (error: unknown) {
      if (
        !(error instanceof BlogException) ||
        !(error.cause instanceof Error)
      ) {
        throw error;
      }
      throw new BlogException({
        code: error.blogErrorCode,
        message: error.message,
        status: error.status,
        cause: new Error(this.maskForbidden(error.cause.message, terms)),
      });
    }
  }

  private maskForbidden(text: string, terms: string[]): string {
    return terms.reduce((masked, term) => {
      const trimmed = term.trim();
      return trimmed.length === 0
        ? masked
        : masked.split(trimmed).join(maskTerm(trimmed));
    }, text);
  }

  private async findOpenPublishCard(
    pageId: string,
  ): Promise<PreviewAction | null> {
    const openPreviews = await this.findAllOpenPreviews.execute({});
    const found = openPreviews.find((preview) => {
      if (preview.kind !== PREVIEW_KIND.BLOG_GITHUB_PUBLISH) {
        return false;
      }
      const payload = preview.payload as { pageId?: unknown } | null;
      return payload?.pageId === pageId;
    });
    return found ?? null;
  }

  // 이 메시지는 자연어 멘션 경로에서 채널에 그대로 게시된다 (blog-publish.dispatcher.ts →
  // router-message.handler.ts 의 say). 탐지 지점 주변 원문(excerpt)이나 매치 문자열을 그대로
  // 실으면 차단한 식별정보를 오히려 채널 전체에 재노출하므로 마스킹한 단서와 건수만 남긴다.
  // 원본 hit 은 result.hits 로 agent_run 에 남으니 작성자는 실행 기록에서 확인한다.
  private buildForbiddenMessage(hits: ForbiddenHit[]): string {
    const details = [...new Set(hits.map((hit) => maskTerm(hit.term)))]
      .slice(0, 10)
      .map((masked) => `- ${masked}`)
      .join('\n');
    return `익명화 결과에 금지어 또는 식별 패턴이 ${hits.length}건 남아 발행을 차단했습니다.\n${details}\nNotion에서 직접 수정 후 재시도해주세요. (원문은 실행 기록에만 남깁니다.)`;
  }

  private getForbiddenTerms(): string[] {
    const raw = this.config.get<string>('BLOG_MASK_FORBIDDEN_TERMS')?.trim();
    if (!raw) {
      throw this.configException('BLOG_MASK_FORBIDDEN_TERMS');
    }
    const terms = raw
      .split(',')
      .map((term) => term.trim())
      .filter((term) => term.length > 0);
    if (terms.length === 0) {
      throw this.configException('BLOG_MASK_FORBIDDEN_TERMS');
    }
    return terms;
  }

  private getRequiredConfig(key: string): string {
    const value = this.config.get<string>(key)?.trim();
    if (!value) {
      throw this.configException(key);
    }
    return value;
  }

  private configException(key: string): BlogException {
    return new BlogException({
      code: BlogErrorCode.PUBLISH_CONFIG_REQUIRED,
      message: `${key} 가 설정되지 않았습니다 (.env 확인).`,
      status: DomainStatus.PRECONDITION_FAILED,
    });
  }
}

const maskTerm = (term: string): string =>
  term.length <= 1 ? '*' : `${term[0]}${'*'.repeat(term.length - 1)}`;

const isAnonymizedBlogDraft = (
  value: unknown,
): value is AnonymizedBlogDraft => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const draft = value as Partial<AnonymizedBlogDraft>;
  return (
    typeof draft.slug === 'string' &&
    draft.slug.trim().length > 0 &&
    typeof draft.description === 'string' &&
    draft.description.trim().length > 0 &&
    typeof draft.body === 'string' &&
    draft.body.trim().length > 0
  );
};
