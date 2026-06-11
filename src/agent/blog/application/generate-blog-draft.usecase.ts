import { Inject, Injectable } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { BlogException } from '../domain/blog.exception';
import { BlogDraftResult, GenerateBlogDraftInput } from '../domain/blog.type';
import { BlogErrorCode } from '../domain/blog-error-code.enum';
import {
  HERMES_RUNNER_PORT,
  HermesRunnerPort,
} from '../domain/port/hermes-runner.port';
import { buildBlogPrompt } from './build-blog-prompt';
import { extractNotionUrl } from './extract-notion-url';

// 자연어 멘션 → Hermes tistory-blog 스킬 릴레이. model-router 미경유(Hermes 가 모델 자체 선택).
@Injectable()
export class GenerateBlogDraftUsecase {
  constructor(
    private readonly agentRunService: AgentRunService,
    @Inject(HERMES_RUNNER_PORT)
    private readonly hermesRunner: HermesRunnerPort,
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
        const result: BlogDraftResult = { notionUrl, rawOutput: stdout };
        return { result, modelUsed: 'hermes-cli', output: result };
      },
    });
  }
}
