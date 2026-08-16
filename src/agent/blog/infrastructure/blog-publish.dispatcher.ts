import { Injectable } from '@nestjs/common';

import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { PublishNotionDraftUsecase } from '../application/publish-notion-draft.usecase';

@Injectable()
export class BlogPublishDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BLOG_PUBLISH;

  constructor(private readonly publishNotionDraft: PublishNotionDraftUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.publishNotionDraft.execute({
      slackUserId: input.slackUserId,
      titleQuery: extractTitleQuery(input.text ?? ''),
      triggerType: TriggerType.SLACK_MENTION_BLOG_PUBLISH,
    });
    const result = outcome.result;
    if (result.status === 'preview') {
      return {
        agentRunId: outcome.agentRunId,
        output: result,
        modelUsed: outcome.modelUsed,
        formattedText: result.previewText,
        preview: {
          id: result.previewId,
          text: result.previewText,
          content: result.content,
        },
      };
    }
    return {
      agentRunId: outcome.agentRunId,
      output: result,
      modelUsed: outcome.modelUsed,
      formattedText: result.message,
    };
  }
}

const extractTitleQuery = (text: string): string => {
  const quoted = text.match(/["'“”]([^"'“”]+)["'“”]/)?.[1]?.trim();
  if (quoted) {
    return quoted;
  }
  return text
    .replace(/^(?:노션|Notion)(?:에 있는|에서)?\s*/i, '')
    .replace(/^(?:블로그\s*)?(?:초안\s*)?/, '')
    .replace(
      /(?:블로그\s*)?(?:초안\s*)?(?:발행|게시|업로드)(?:해줘|해주세요|해 줘|해 주세요|해|좀)?[.!?\s]*$/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
};
