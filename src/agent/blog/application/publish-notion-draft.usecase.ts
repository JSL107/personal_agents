import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { extractJsonObjectText } from '../../../common/util/llm-json-extract.util';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
  NotionDraftPage,
} from '../../../notion/domain/port/notion-client.port';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { buildAstroPost } from '../domain/astro-post';
import { BlogException } from '../domain/blog.exception';
import {
  BlogGithubPublishPayload,
  PublishNotionDraftInput,
  PublishNotionDraftResult,
} from '../domain/blog.type';
import { BlogErrorCode } from '../domain/blog-error-code.enum';
import { ForbiddenHit, scanForbiddenTerms } from '../domain/company-info-scan';
import { BLOG_ANONYMIZE_SYSTEM_PROMPT } from '../domain/prompt/blog-anonymize.prompt';

// autopilot 의 T1_PREVIEW 와 같은 24시간. 1시간은 이미 실패로 판명된 값이다 — 저녁 블로그 카드가
// 짧은 TTL 때문에 반복적으로 EXPIRED 로 유실돼 autopilot.orchestrator.ts:24 에서 24시간으로 올렸다.
// 이 카드는 글 전문을 읽고 마스킹을 검토한 뒤 누르는 성격이라 더 긴 여유가 필요하다.
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1_000;

interface AnonymizedBlogDraft {
  slug: string;
  description: string;
  body: string;
}

@Injectable()
export class PublishNotionDraftUsecase {
  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly createPreview: CreatePreviewUsecase,
    private readonly config: ConfigService,
  ) {}

  async execute(
    input: PublishNotionDraftInput,
  ): Promise<AgentRunOutcome<PublishNotionDraftResult>> {
    const forbiddenTerms = this.getForbiddenTerms();
    const titleQuery = input.titleQuery?.trim() ?? '';
    const databaseId = this.getRequiredConfig(
      'EVENING_RETRO_BLOG_NOTION_DATABASE_ID',
    );
    const statusPropertyName = this.getRequiredConfig(
      'BLOG_NOTION_PROP_STATUS',
    );
    const statusValue = this.getRequiredConfig(
      'BLOG_NOTION_STATUS_DRAFT_VALUE',
    );

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
          sourceId: databaseId,
          payload: { titleQuery },
        },
      ],
      run: async ({ updateInputSnapshot }) => {
        const drafts = await this.notionClient.queryDraftPages({
          databaseId,
          statusPropertyName,
          statusValue,
        });
        if (drafts.length === 0 && !input.pageId) {
          const result: PublishNotionDraftResult = {
            status: 'empty',
            message: '발행할 초안이 없습니다.',
          };
          return { result, modelUsed: 'deterministic', output: result };
        }

        const target = this.selectDraft(drafts, titleQuery, input.pageId);
        await updateInputSnapshot({
          slackUserId: input.slackUserId,
          ...(titleQuery ? { titleQuery } : {}),
          pageId: target.pageId,
        });
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
          },
        });
        const anonymized = this.parseAnonymizedDraft(completion.text);
        const summary = target.summary.trim() || anonymized.description.trim();
        const post = buildAstroPost({
          title: target.title,
          description: summary,
          slug: anonymized.slug,
          tags: target.tags,
          createdTime: target.createdTime,
          pageId: target.pageId,
          body: anonymized.body,
        });
        const hits = scanForbiddenTerms(
          // frontmatter title/description은 모델 body와 별도 입력이므로 함께 검사하지 않으면
          // 본문은 안전해도 메타데이터에서 회사·기관명이 그대로 발행될 수 있다.
          // slug 과 최종 path 도 같은 이유 — 본문이 안전해도 모델이 slug 에 남긴 ASCII 식별자는
          // 공개 저장소의 커밋 경로와 URL 에 영구히 박힌다. 정규화 전후 표기가 다르므로 둘 다 넣는다.
          {
            body: `${target.title}\n${summary}\n${anonymized.slug}\n${post.path}\n${anonymized.body}`,
            tags: target.tags,
          },
          forbiddenTerms,
        );
        if (hits.length > 0) {
          const result: PublishNotionDraftResult = {
            status: 'blocked',
            message: this.buildForbiddenMessage(hits),
            hits,
          };
          return {
            result,
            modelUsed: completion.modelUsed,
            output: result,
          };
        }

        const previewText = this.buildPreviewText(target, post.path, summary);
        const payload: BlogGithubPublishPayload = {
          pageId: target.pageId,
          path: post.path,
          content: post.content,
          title: target.title,
          notionUrl: target.url,
          tags: target.tags,
          summary,
          slackUserId: input.slackUserId,
        };
        const preview = await this.createPreview.execute({
          slackUserId: input.slackUserId,
          kind: PREVIEW_KIND.BLOG_GITHUB_PUBLISH,
          payload,
          previewText,
          responseUrl: input.responseUrl ?? null,
          ttlMs: PREVIEW_TTL_MS,
        });
        const result: PublishNotionDraftResult = {
          status: 'preview',
          previewId: preview.id,
          previewText,
          title: target.title,
          notionUrl: target.url,
          path: post.path,
          content: post.content,
        };
        return { result, modelUsed: completion.modelUsed, output: result };
      },
    });
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
      throw new BlogException({
        code: BlogErrorCode.ANONYMIZE_PARSE_FAILED,
        message: '블로그 익명화 결과를 해석하지 못했습니다.',
        status: DomainStatus.BAD_GATEWAY,
        cause: error,
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
    summary: string,
  ): string {
    return [
      '*GitHub 블로그 발행 미리보기*',
      `제목: ${draft.title}`,
      `경로: \`${path}\``,
      `요약: ${summary}`,
      `Notion: ${draft.url}`,
      '',
      '아래 전문을 확인한 뒤 ✅ 적용 / ❌ 취소를 눌러주세요.',
    ].join('\n');
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
