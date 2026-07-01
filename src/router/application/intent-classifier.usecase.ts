import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { EpisodeSearchHit } from '../../episodic-memory/domain/episode.type';
import {
  EPISODIC_MEMORY_PORT,
  EpisodicMemoryPort,
} from '../../episodic-memory/domain/port/episodic-memory.port';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  PREFERENCE_PROFILE_PORT,
  PreferenceProfilePort,
} from '../../preference-profile/domain/port/preference-profile.port';
import { ConversationTurn } from '../domain/conversation-memory.type';
import { IntentClassification } from '../domain/intent-classification.type';
import { parseIntentClassification } from '../domain/prompt/intent-classification.parser';
import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from '../domain/prompt/intent-classifier-system.prompt';

// 자연어 메시지를 AgentType 으로 1회 LLM 분류. AgentRun 만들지 않는 internal LLM call.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §6.1)
//
// agentType 매핑: AgentType.PM 의 provider (CHATGPT) 를 분류기로 차용 — 짧은 출력 / 빠른 latency.
//
// priorTurns: 자연어 multi-turn 메모리 (5턴/30분). 있으면 "[직전 대화]" 섹션 prepend.
// episodicHits: episodic 장기기억의 유사 과거 작업 (옵셔널). 있으면 "[유사 과거 작업]" few-shot
// 섹션 prepend — "이런 요청은 보통 어느 worker 로 갔는지" 힌트로 분류 정확도 ↑.
const EPISODIC_FEWSHOT_LIMIT = 3;
const EPISODIC_CONTENT_MAX_CHARS = 100;

@Injectable()
export class IntentClassifierUsecase {
  private readonly logger = new Logger(IntentClassifierUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    // episodic 은 옵셔널 — RouterModule 이 EpisodicMemoryModule 을 import 하면 주입,
    // 미주입(테스트 등) 시 few-shot 없이 기존 분류.
    @Optional()
    @Inject(EPISODIC_MEMORY_PORT)
    private readonly episodicMemory?: EpisodicMemoryPort,
    @Optional()
    @Inject(PREFERENCE_PROFILE_PORT)
    private readonly preferenceProfile?: PreferenceProfilePort,
  ) {}

  async classify(
    text: string,
    priorTurns?: ConversationTurn[],
  ): Promise<IntentClassification> {
    const trimmed = text.trim();
    const episodicHits = await this.recallSimilar(trimmed);
    const prompt = buildPrompt(trimmed, priorTurns, episodicHits);
    const routingBlock = this.preferenceProfile
      ? await this.preferenceProfile.getInjectionBlock('routing')
      : '';
    const systemPrompt = routingBlock
      ? `${INTENT_CLASSIFIER_SYSTEM_PROMPT}\n\n${routingBlock}`
      : INTENT_CLASSIFIER_SYSTEM_PROMPT;
    const completion = await this.modelRouter.route({
      agentType: AgentType.PM,
      request: {
        prompt,
        systemPrompt,
      },
    });
    const classification = parseIntentClassification(completion.text);
    this.logger.log(
      `Intent classified — text="${trimmed.slice(0, 40)}" priorTurns=${priorTurns?.length ?? 0} episodic=${episodicHits.length} → ${classification.agentType} (confidence=${classification.confidence})`,
    );
    return classification;
  }

  // best-effort — episodic 미주입 또는 검색 실패 시 빈 배열(분류 본 흐름 비차단).
  private async recallSimilar(query: string): Promise<EpisodeSearchHit[]> {
    if (!this.episodicMemory || query.length === 0) {
      return [];
    }
    try {
      return await this.episodicMemory.searchRelevant({
        query,
        kind: 'agent_run',
        limit: EPISODIC_FEWSHOT_LIMIT,
      });
    } catch (error) {
      this.logger.warn(
        `Episodic recall 실패 (few-shot 없이 분류 계속): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}

const buildPrompt = (
  text: string,
  priorTurns?: ConversationTurn[],
  episodicHits?: EpisodeSearchHit[],
): string => {
  const sections: string[] = [];

  if (priorTurns && priorTurns.length > 0) {
    sections.push('[직전 대화]');
    for (const turn of priorTurns) {
      const workerLabel = turn.agentType ?? '(분류 실패)';
      const runLabel = turn.agentRunId !== null ? `#${turn.agentRunId}` : '-';
      sections.push(
        `- 사용자: "${truncate(turn.text)}" → worker ${workerLabel} ${runLabel}`,
      );
    }
    sections.push('');
  }

  const fewshot = (episodicHits ?? []).filter((hit) => hit.agentType !== null);
  if (fewshot.length > 0) {
    sections.push('[유사 과거 작업]');
    for (const hit of fewshot) {
      sections.push(
        `- "${truncateContent(hit.content)}" → worker ${hit.agentType}`,
      );
    }
    sections.push('');
  }

  if (sections.length === 0) {
    return text;
  }
  sections.push('[이번 입력]');
  sections.push(text);
  return sections.join('\n');
};

const truncate = (text: string): string =>
  text.length > 60 ? `${text.slice(0, 60)}…` : text;

const truncateContent = (text: string): string => {
  const flattened = text.replace(/\s+/g, ' ').trim();
  return flattened.length > EPISODIC_CONTENT_MAX_CHARS
    ? `${flattened.slice(0, EPISODIC_CONTENT_MAX_CHARS)}…`
    : flattened;
};
