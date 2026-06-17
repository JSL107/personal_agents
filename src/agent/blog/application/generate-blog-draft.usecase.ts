import { Inject, Injectable, Logger } from '@nestjs/common';

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
import { buildBlogPublishProperties } from '../domain/blog-publish-properties';
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
        const published = await this.publishToNotion(notionUrl, stdout);
        const result: BlogDraftResult = {
          notionUrl,
          rawOutput: stdout,
          published,
        };
        return { result, modelUsed: 'hermes-cli', output: result };
      },
    });
  }

  // 생성된 Notion 페이지를 발행 상태(상태=발행 + 발행일/태그/요약)로 보강한다.
  // best-effort — 속성 미설정/권한 등으로 실패해도 throw 하지 않고 false 반환(초안 URL 은 회신).
  private async publishToNotion(
    notionUrl: string,
    stdout: string,
  ): Promise<boolean> {
    const pageId = notionPageIdFromUrl(notionUrl);
    if (!pageId) {
      return false;
    }
    try {
      await this.notionClient.updatePageProperties({
        pageId,
        properties: buildBlogPublishProperties({
          tags: extractTags(stdout),
          summary: extractSummary(stdout),
          publishedAt: getTodayKstDate(),
        }),
      });
      return true;
    } catch (error: unknown) {
      this.logger.warn(
        `블로그 Notion 발행 enrich 실패 (초안은 생성됨, 수동 발행 가능): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }
}
