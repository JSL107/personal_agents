import { Injectable } from '@nestjs/common';

import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { findHypotheticalMarker } from '../../../router/domain/hypothetical-utterance';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { AnswerBlogQuestionUsecase } from '../application/answer-blog-question.usecase';
import { PublishNotionDraftUsecase } from '../application/publish-notion-draft.usecase';
import { isBlogLookup } from '../domain/blog-lookup';

@Injectable()
export class BlogPublishDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BLOG_PUBLISH;

  constructor(
    private readonly publishNotionDraft: PublishNotionDraftUsecase,
    private readonly answerQuestion: AnswerBlogQuestionUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    // "그 글 발행된 거야?" 같은 질문은 발행 요청이 아니다. 승인 카드가 앞에 있어 실제 발행은 없지만,
    // 질문마다 초안 익명화(LLM)와 승인 카드가 만들어지면 묻지도 않은 작업이 생긴다.
    const marker =
      findHypotheticalMarker(input.text ?? '') ??
      (isBlogLookup(input.text ?? '') ? 'BLOG_LOOKUP' : null);
    if (marker !== null) {
      // 발행은 하지 않고, Notion 초안 목록과 최근 발행 이력으로 질문에 답한다.
      const parsedIntent = {
        action: 'UNKNOWN',
        heldWrite: { action: 'PUBLISH', marker },
      };
      const outcome = await this.answerQuestion.execute({
        slackUserId: input.slackUserId,
        text: input.text ?? '',
        priorTurns: input.priorTurns ?? [],
        parsedIntent,
      });
      return {
        agentRunId: outcome.agentRunId,
        output: { ...parsedIntent, usedFallback: outcome.result.usedFallback },
        modelUsed: outcome.modelUsed,
        formattedText: outcome.result.text,
      };
    }
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
