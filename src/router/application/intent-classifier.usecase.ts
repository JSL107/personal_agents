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
import {
  AGENT_DISPATCHER_PORT,
  AgentDispatcher,
} from '../domain/port/agent-dispatcher.port';
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
// 라우팅 불가 타입을 걸러낸 뒤에도 few-shot 을 채울 수 있도록 여유를 두고 뽑는다.
const EPISODIC_SEARCH_LIMIT = EPISODIC_FEWSHOT_LIMIT * 3;

@Injectable()
export class IntentClassifierUsecase {
  private readonly logger = new Logger(IntentClassifierUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    // few-shot 후보를 "실제로 라우팅 가능한 worker" 로 한정하기 위한 등록 목록.
    // AgentRunService 는 성공한 run 의 output 을 전부 episodic 에 적재하는데, 그 안에는
    // 사용자가 부를 수 없는 내부 계측 실행(HUMANIZER · SUBCONSCIOUS_GATE 등)도 섞인다.
    // 그것이 few-shot 예시로 들어가면 classifier 가 미등록 agentType 을 답할 수 있고,
    // parser 는 AgentType 전체를 허용하므로 그대로 통과해 IdaeriRouterUsecase 가
    // UNSUPPORTED_AGENT_TYPE 으로 **사용자 요청을 실패시킨다.**
    @Inject(AGENT_DISPATCHER_PORT)
    private readonly dispatchers: AgentDispatcher[],
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
      // PM 은 provider 선택용으로 빌려 쓸 뿐 실제 PM 업무가 아니다. 계약 머리말이 붙으면
      // 바로 아래 parseIntentClassification 이 기대하는 고정 JSON 스키마와 충돌한다.
      noContractPreamble: true,
    });
    const classification = parseIntentClassification(completion.text);
    this.logger.log(
      `Intent classified — text="${trimmed.slice(0, 40)}" priorTurns=${priorTurns?.length ?? 0} episodic=${episodicHits.length} → ${classification.agentType} (confidence=${classification.confidence})`,
    );
    return classification;
  }

  // best-effort — episodic 미주입 또는 검색 실패 시 빈 배열(분류 본 흐름 비차단).
  /**
   * few-shot 후보에서 라우팅할 수 없는 실행을 걷어낸다.
   *
   * dispatcher 등록 여부라는 구조적 사실로 판정하므로, 내부 워커가 새로 원장에 편입돼도
   * 목록을 손댈 필요가 없다. agentType 이 비어 있는 기록은 worker 라벨이 없어 예시로
   * 쓰이지 않으므로 그대로 통과시킨다.
   */
  private keepRoutableHits(hits: EpisodeSearchHit[]): EpisodeSearchHit[] {
    const routable = new Set<string>(
      this.dispatchers.map((dispatcher) => dispatcher.agentType),
    );
    return hits.filter(
      (hit) => hit.agentType === null || routable.has(hit.agentType),
    );
  }

  private async recallSimilar(query: string): Promise<EpisodeSearchHit[]> {
    if (!this.episodicMemory || query.length === 0) {
      return [];
    }
    try {
      const hits = await this.episodicMemory.searchRelevant({
        query,
        kind: 'agent_run',
        limit: EPISODIC_SEARCH_LIMIT,
      });
      return this.keepRoutableHits(hits).slice(0, EPISODIC_FEWSHOT_LIMIT);
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
      // role 라벨은 시스템 프롬프트의 계약이다 — "[assistant] 는 봇 자신의 직전 응답" 을 전제로
      // 「합의된 작업의 실행 지시」/「순수 재촉」 두 규칙이 분기한다. 라벨 없이 전부 "사용자:" 로
      // 렌더링하면 봇 발화가 사용자 발화로 둔갑해 두 규칙 모두 판별 근거를 잃는다.
      const role = turn.role === 'assistant' ? 'assistant' : 'user';
      // worker 태그는 user turn 에만 — assistant turn 의 agentType 은 직전 user turn 의 미러라
      // 그대로 붙이면 봇이 스스로 worker 를 호출한 것처럼 읽힌다.
      const workerTag =
        role === 'user'
          ? ` → worker ${turn.agentType ?? '(분류 실패)'} ${turn.agentRunId !== null ? `#${turn.agentRunId}` : '-'}`
          : '';
      sections.push(`- [${role}] "${truncate(turn.text)}"${workerTag}`);
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
