import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { getTodayKstDate } from '../../../common/util/kst-date.util';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../../../notion/domain/port/notion-client.port';
import { BlogException } from '../domain/blog.exception';
import { BlogDraftResult, GenerateBlogDraftInput } from '../domain/blog.type';
import { BlogErrorCode } from '../domain/blog-error-code.enum';
import {
  BlogPublishPropertyNames,
  buildBlogPublishProperties,
  DEFAULT_BLOG_PROP,
  DEFAULT_BLOG_STATUS_PUBLISHED,
} from '../domain/blog-publish-properties';
import {
  HERMES_RUNNER_PORT,
  HermesRunnerPort,
} from '../domain/port/hermes-runner.port';
import { buildBlogPrompt } from './build-blog-prompt';
import {
  extractSummary,
  extractTags,
  notionPageIdFromUrl,
} from './extract-blog-metadata';
import { extractNotionUrl } from './extract-notion-url';

/**
 * 발행 상태 전환 시도의 결과.
 *
 * 실패(`published: false`)면 이유가 **반드시** 있다는 걸 타입으로 강제한다.
 * 이유 없는 false 는 formatter 에서 정상 초안 안내로 렌더돼 실패가 위장되므로,
 * 런타임 방어가 아니라 컴파일 단계에서 막는다.
 */
type PublishAttempt =
  | { published: true; error?: undefined }
  | { published: false; error: string };

// 자연어 멘션 → Hermes tistory-blog 스킬 릴레이. model-router 미경유(Hermes 가 모델 자체 선택).
@Injectable()
export class GenerateBlogDraftUsecase {
  private readonly logger = new Logger(GenerateBlogDraftUsecase.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    @Inject(HERMES_RUNNER_PORT)
    private readonly hermesRunner: HermesRunnerPort,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly configService: ConfigService,
  ) {}

  async execute({
    requestText,
    slackUserId,
  }: GenerateBlogDraftInput): Promise<AgentRunOutcome<BlogDraftResult>> {
    const trimmed = requestText.trim();
    if (trimmed.length === 0) {
      throw new BlogException({
        code: BlogErrorCode.EMPTY_REQUEST,
        message: '블로그 요청이 비어 있습니다. 어떤 주제로 쓸지 적어주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    return this.agentRunService.execute({
      agentType: AgentType.BLOG,
      triggerType: TriggerType.SLACK_MENTION_BLOG,
      inputSnapshot: { requestText: trimmed, slackUserId },
      evidence: [
        {
          sourceType: 'SLACK_MENTION_BLOG',
          sourceId: slackUserId,
          payload: { requestText: trimmed },
        },
      ],
      run: async () => {
        const { stdout } = await this.hermesRunner.run(
          buildBlogPrompt(trimmed),
        );
        const notionUrl = extractNotionUrl(stdout);
        if (!notionUrl) {
          throw new BlogException({
            code: BlogErrorCode.NOTION_URL_NOT_FOUND,
            message:
              '초안은 작성됐을 수 있으나 Notion 링크를 찾지 못했습니다. Notion "블로그 초안" DB 를 확인해주세요.',
            status: DomainStatus.INTERNAL,
          });
        }
        const summary = extractSummary(stdout);
        const publish = await this.publishToNotion(notionUrl, stdout, summary);
        const result: BlogDraftResult = {
          notionUrl,
          rawOutput: stdout,
          published: publish.published,
          ...(summary !== null ? { summary } : {}),
          // 실패면 이유가 반드시 붙는다(PublishAttempt 가 타입으로 보장).
          ...(publish.published ? {} : { publishError: publish.error }),
        };
        return { result, modelUsed: 'hermes-cli', output: result };
      },
    });
  }

  // 생성된 Notion 페이지를 발행 상태(상태=발행 + 발행일/태그/요약)로 보강한다.
  // best-effort — 속성 미설정/권한 등으로 실패해도 throw 하지 않는다(초안 URL 은 회신).
  // 다만 실패 **이유**는 함께 돌려준다. warn 로그로만 남기면 사용자에게는 정상 초안
  // 생성과 구분되지 않아, 실측(2026-06)에서 4회 연속 실패를 아무도 눈치채지 못했다.
  private async publishToNotion(
    notionUrl: string,
    stdout: string,
    summary: string | null,
  ): Promise<PublishAttempt> {
    const pageId = notionPageIdFromUrl(notionUrl);
    if (!pageId) {
      return {
        published: false,
        error: 'Notion 링크에서 페이지 id 를 추출하지 못했습니다.',
      };
    }
    try {
      await this.notionClient.updatePageProperties({
        pageId,
        properties: buildBlogPublishProperties(
          {
            tags: extractTags(stdout),
            summary,
            publishedAt: getTodayKstDate(),
          },
          this.getBlogPublishPropertyNames(),
          this.getBlogStatusPublishedValue(),
        ),
      });
      return { published: true };
    } catch (error: unknown) {
      const raw = error instanceof Error ? error.message : String(error);
      // 메시지가 빈 에러(`new Error('')` 등)를 그대로 흘리면 호출부의 `error ? ... : {}`
      // 에서 필드가 통째로 사라져, 실패가 다시 "이유 없는 published:false" = 정상 초안
      // 안내로 위장된다. 이 PR 이 없애려던 바로 그 구멍이라 여기서 반드시 채운다.
      const message =
        raw.trim().length > 0 ? raw : '알 수 없는 오류 (에러 메시지 없음)';
      this.logger.warn(
        `블로그 Notion 발행 enrich 실패 (초안은 생성됨, 수동 발행 가능): ${message}`,
      );
      return { published: false, error: message };
    }
  }

  private getBlogPublishPropertyNames(): BlogPublishPropertyNames {
    return {
      status:
        this.configService.get<string>('BLOG_NOTION_PROP_STATUS') ??
        DEFAULT_BLOG_PROP.status,
      publishedAt:
        this.configService.get<string>('BLOG_NOTION_PROP_PUBLISHED_AT') ??
        DEFAULT_BLOG_PROP.publishedAt,
      tags:
        this.configService.get<string>('BLOG_NOTION_PROP_TAGS') ??
        DEFAULT_BLOG_PROP.tags,
      summary:
        this.configService.get<string>('BLOG_NOTION_PROP_SUMMARY') ??
        DEFAULT_BLOG_PROP.summary,
    };
  }

  private getBlogStatusPublishedValue(): string {
    const statusPublishedValue =
      this.configService.get<string>('BLOG_NOTION_STATUS_PUBLISHED_VALUE') ??
      DEFAULT_BLOG_STATUS_PUBLISHED;

    return statusPublishedValue;
  }
}
