import { Injectable, Logger } from '@nestjs/common';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { IntentClassification } from '../domain/intent-classification.type';
import { parseIntentClassification } from '../domain/prompt/intent-classification.parser';
import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from '../domain/prompt/intent-classifier-system.prompt';

// 자연어 메시지를 AgentType 으로 1회 LLM 분류. AgentRun 만들지 않는 internal LLM call.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §6.1)
//
// agentType 매핑: AgentType.PM 의 provider (CHATGPT) 를 분류기로 차용 — 짧은 출력 / 빠른 latency.
// AgentRunService.execute 를 거치지 않아 quota / agent_run row 영향 없음 (내부 분류 비용은
// CLI provider 의 호출량으로만 측정 가능 — 향후 별도 metric 도입 시 분리).
@Injectable()
export class IntentClassifierUsecase {
  private readonly logger = new Logger(IntentClassifierUsecase.name);

  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async classify(text: string): Promise<IntentClassification> {
    const trimmed = text.trim();
    const completion = await this.modelRouter.route({
      agentType: AgentType.PM,
      request: {
        prompt: trimmed,
        systemPrompt: INTENT_CLASSIFIER_SYSTEM_PROMPT,
      },
    });
    const classification = parseIntentClassification(completion.text);
    this.logger.log(
      `Intent classified — text="${trimmed.slice(0, 40)}" → ${classification.agentType} (confidence=${classification.confidence})`,
    );
    return classification;
  }
}
