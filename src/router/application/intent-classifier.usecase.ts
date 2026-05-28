import { Injectable, Logger } from '@nestjs/common';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationTurn } from '../domain/conversation-memory.type';
import { IntentClassification } from '../domain/intent-classification.type';
import { parseIntentClassification } from '../domain/prompt/intent-classification.parser';
import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from '../domain/prompt/intent-classifier-system.prompt';

// 자연어 메시지를 AgentType 으로 1회 LLM 분류. AgentRun 만들지 않는 internal LLM call.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §6.1)
//
// agentType 매핑: AgentType.PM 의 provider (CHATGPT) 를 분류기로 차용 — 짧은 출력 / 빠른 latency.
// AgentRunService.execute 를 거치지 않아 quota / agent_run row 영향 없음 (내부 분류 비용은
// CLI provider 의 호출량으로만 측정 가능 — 향후 별도 metric 도입 시 분리).
//
// priorTurns: 자연어 multi-turn 메모리. 있으면 "[직전 대화]" 섹션을 prompt 앞에 prepend 해
// 지시대명사 ("그거 분배해") 분류 정확도 ↑. ConversationMemoryService 의 응답을 그대로 받는다.
@Injectable()
export class IntentClassifierUsecase {
  private readonly logger = new Logger(IntentClassifierUsecase.name);

  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async classify(
    text: string,
    priorTurns?: ConversationTurn[],
  ): Promise<IntentClassification> {
    const trimmed = text.trim();
    const prompt = buildPrompt(trimmed, priorTurns);
    const completion = await this.modelRouter.route({
      agentType: AgentType.PM,
      request: {
        prompt,
        systemPrompt: INTENT_CLASSIFIER_SYSTEM_PROMPT,
      },
    });
    const classification = parseIntentClassification(completion.text);
    this.logger.log(
      `Intent classified — text="${trimmed.slice(0, 40)}" priorTurns=${priorTurns?.length ?? 0} → ${classification.agentType} (confidence=${classification.confidence})`,
    );
    return classification;
  }
}

const buildPrompt = (text: string, priorTurns?: ConversationTurn[]): string => {
  if (!priorTurns || priorTurns.length === 0) {
    return text;
  }
  const lines: string[] = ['[직전 대화]'];
  for (const turn of priorTurns) {
    const workerLabel = turn.agentType ?? '(분류 실패)';
    const runLabel = turn.agentRunId !== null ? `#${turn.agentRunId}` : '-';
    lines.push(
      `- 사용자: "${truncate(turn.text)}" → worker ${workerLabel} ${runLabel}`,
    );
  }
  lines.push('');
  lines.push('[이번 입력]');
  lines.push(text);
  return lines.join('\n');
};

const truncate = (text: string): string =>
  text.length > 60 ? `${text.slice(0, 60)}…` : text;
