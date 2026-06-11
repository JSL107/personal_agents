import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatBlogDraft } from '../../../slack/format/blog.formatter';
import { GenerateBlogDraftUsecase } from '../application/generate-blog-draft.usecase';

// BLOG worker 의 Router dispatcher — 자연어 멘션(input.text)을 Hermes 블로그 스킬 요청으로 릴레이.
@Injectable()
export class BlogDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BLOG;

  constructor(private readonly generateBlogDraft: GenerateBlogDraftUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateBlogDraft.execute({
      requestText: input.text ?? '',
      slackUserId: input.slackUserId,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatBlogDraft(outcome.result),
    };
  }
}
