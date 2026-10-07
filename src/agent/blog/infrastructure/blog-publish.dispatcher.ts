import { Injectable } from '@nestjs/common';

import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { findHypotheticalMarker } from '../../../router/domain/hypothetical-utterance';
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
    // "그 글 발행된 거야?" 같은 질문은 발행 요청이 아니다. 승인 카드가 앞에 있어 실제 발행은 없지만,
    // 질문마다 초안 익명화(LLM)와 승인 카드가 만들어지면 묻지도 않은 작업이 생긴다. 발행 여부를
    // 조회할 수단은 아직 없으므로 지어내지 않고 그 사실을 말한다.
    const marker = findHypotheticalMarker(input.text ?? '');
    if (marker !== null) {
      return {
        agentRunId: 0,
        output: { action: 'UNKNOWN', heldWrite: { action: 'PUBLISH', marker } },
        modelUsed: 'deterministic',
        formattedText:
          '발행 요청으로 보이지 않아 발행 절차를 시작하지 않았어요. 발행 여부를 대화로 확인하는 기능은 아직 없어요. 발행하려면 "노션 초안 <제목> 발행해줘" 처럼 말해 주세요.',
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
