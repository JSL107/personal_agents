import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  UNTRUSTED_INPUT_END,
  UNTRUSTED_INPUT_NOTICE,
  UNTRUSTED_INPUT_START,
  wrapUntrustedInput,
} from '../../common/llm/untrusted-input.util';
import { EpisodeSearchHit } from '../../episodic-memory/domain/episode.type';
import {
  EPISODIC_MEMORY_PORT,
  EpisodicMemoryPort,
} from '../../episodic-memory/domain/port/episodic-memory.port';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import {
  AgentType,
  OutputJsonSchema,
} from '../../model-router/domain/model-router.type';
import {
  PREFERENCE_PROFILE_PORT,
  PreferenceProfilePort,
} from '../../preference-profile/domain/port/preference-profile.port';
import { AUTO_POST_LABEL, isAutoPostTurn } from '../domain/auto-post-turn';
import { ConversationTurn } from '../domain/conversation-memory.type';
import { IntentClassification } from '../domain/intent-classification.type';
import {
  AGENT_DISPATCHER_PORT,
  AgentDispatcher,
} from '../domain/port/agent-dispatcher.port';
import { parseIntentClassification } from '../domain/prompt/intent-classification.parser';
import { buildIntentClassificationOutputSchema } from '../domain/prompt/intent-classification.schema';
import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from '../domain/prompt/intent-classifier-system.prompt';
import {
  decideMemoryShortcut,
  MEMORY_SHORTCUT_RULE,
  MemoryShortcutDecision,
  normalizeRoutingText,
  pickRoutingFewshot,
  ROUTING_MEMORY_SEARCH_LIMIT,
} from '../domain/routing-memory.policy';

// 자연어 메시지를 AgentType 으로 1회 LLM 분류. AgentRun 만들지 않는 internal LLM call.
// (plan: docs/superpowers/plans/2026-05-07-agent-communication-topology.md §6.1)
//
// agentType 매핑: AgentType.PM 의 provider (CHATGPT) 를 분류기로 차용 — 짧은 출력 / 빠른 latency.
//
// priorTurns: 자연어 multi-turn 맥락. 최근 10턴을 "[직전 대화]" 섹션에 prepend.
// episodicHits: 과거 (요청문 → 담당) 짝(routing_example) 중 비슷한 것. 있으면 "[유사 과거 작업]"
// few-shot 섹션 prepend — "이런 요청은 보통 어느 worker 로 갔는지" 힌트.
// 같은 검색 결과로 라우팅 기억 단축도 판정한다(ROUTER_MEMORY_SHORTCUT_MODE).
const EPISODIC_CONTENT_MAX_CHARS = 100;
const CLASSIFIER_TURN_LIMIT = 10;
const CLASSIFIER_AUTO_POST_TEXT_CAP = 300;

type MemoryShortcutMode = 'off' | 'shadow' | 'on';

interface RoutableMemoryDecision {
  agentType: AgentType;
  similarity: number;
}

export interface ClassifyOptions {
  // 30분 대화 기억에 직전 턴이 없었는지. priorTurns 는 DM 이면 24시간 Slack 내역까지 담아
  // 첫 턴 판정에 쓸 수 없어 라우터가 따로 넘긴다. 미지정이면 priorTurns 길이로 판정한다.
  isFirstTurn?: boolean;
}

@Injectable()
export class IntentClassifierUsecase {
  private readonly logger = new Logger(IntentClassifierUsecase.name);
  // 분류 결과의 형태를 강제하는 스키마. dispatcher 등록에서 파생하므로 호출마다 만들 필요가 없다.
  private readonly outputSchema: OutputJsonSchema;

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    // few-shot·단축 후보를 "실제로 라우팅 가능한 worker" 로 한정하기 위한 등록 목록.
    // 과거 예시의 담당이 그 뒤 폐지·미등록됐을 수 있다. 그것이 예시로 들어가거나 단축되면
    // IdaeriRouterUsecase 가 UNSUPPORTED_AGENT_TYPE 으로 **사용자 요청을 실패시킨다.**
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
    @Optional()
    private readonly configService?: ConfigService,
  ) {
    // 분류 후보를 바로 위 dispatchers 에서 받는다 — few-shot 을 걸러내는 근거(라우팅 가능 여부)와
    // 같은 소스여야 "예시로는 안 보여주는데 스키마로는 고를 수 있는" 값이 생기지 않는다.
    this.outputSchema = buildIntentClassificationOutputSchema(
      this.dispatchers.map((dispatcher) => dispatcher.agentType),
    );
  }

  async classify(
    text: string,
    priorTurns?: ConversationTurn[],
    { isFirstTurn = !priorTurns?.length }: ClassifyOptions = {},
  ): Promise<IntentClassification> {
    const trimmed = text.trim();
    const memoryHits = await this.recallSimilar(trimmed);
    // 직전 대화가 있으면 단축하지 않는다 — userInstruction 은 직전 대화에서만 나오고,
    // 맥락에 기대는 발화("응 해줘")는 문장만 같아도 뜻이 다르다.
    const mode = this.shortcutMode();
    const decision =
      mode !== 'off' && isFirstTurn
        ? this.toRoutableDecision(
            decideMemoryShortcut({
              hits: memoryHits,
              rule: MEMORY_SHORTCUT_RULE,
            }),
          )
        : null;
    if (decision !== null && mode === 'on') {
      this.logger.log(
        `Intent memory shortcut — text="${trimmed.slice(0, 40)}" → ${decision.agentType} (similarity=${decision.similarity.toFixed(3)})`,
      );
      return {
        agentType: decision.agentType,
        // cosine 은 확신도가 아니다. 라우터는 이 경로의 confidence 를 원장에 싣지 않는다.
        confidence: decision.similarity,
        reason: `routing memory shortcut (similarity=${decision.similarity.toFixed(3)})`,
        memoryShortcut: { ...decision, applied: true },
      };
    }
    const episodicHits = pickRoutingFewshot({ hits: memoryHits });
    const prompt = buildPrompt(trimmed, priorTurns, episodicHits);
    const routingBlock = this.preferenceProfile
      ? await this.preferenceProfile.getInjectionBlock('routing')
      : '';
    const baseSystemPrompt = routingBlock
      ? `${INTENT_CLASSIFIER_SYSTEM_PROMPT}\n\n${routingBlock}`
      : INTENT_CLASSIFIER_SYSTEM_PROMPT;
    const hasAutoPost = priorTurns
      ?.slice(-CLASSIFIER_TURN_LIMIT)
      .some(isAutoPostTurn);
    const systemPrompt = hasAutoPost
      ? `${baseSystemPrompt}\n\n${UNTRUSTED_INPUT_NOTICE}`
      : baseSystemPrompt;
    const completion = await this.modelRouter.route({
      agentType: AgentType.PM,
      request: {
        prompt,
        systemPrompt,
        outputSchema: this.outputSchema,
      },
      // PM 은 provider 선택용으로 빌려 쓸 뿐 실제 PM 업무가 아니다. 계약 머리말이 붙으면
      // 바로 아래 parseIntentClassification 이 기대하는 고정 JSON 스키마와 충돌한다.
      noContractPreamble: true,
    });
    const classification = parseIntentClassification(completion.text);
    this.logger.log(
      `Intent classified — text="${trimmed.slice(0, 40)}" priorTurns=${priorTurns?.length ?? 0} episodic=${episodicHits.length} → ${classification.agentType} (confidence=${classification.confidence})${decision ? ` memory=${decision.agentType}` : ''}`,
    );
    if (decision === null) {
      return classification;
    }
    return {
      ...classification,
      memoryShortcut: { ...decision, applied: false },
    };
  }

  /**
   * 라우팅 예시 저장 — 라우터가 첫 턴 분류 결과로 실행이 성공했을 때만 부른다(자격 판정은 라우터 몫).
   * 저장·검색이 같은 정규화와 같은 접두어('query')를 써야 같은 문장의 cosine 이 1 에 붙는다.
   */
  async rememberRoutingExample(input: {
    text: string;
    agentType: AgentType;
    agentRunId: number;
  }): Promise<void> {
    if (!this.episodicMemory) {
      return;
    }
    const content = normalizeRoutingText(input.text);
    if (content.length === 0) {
      return;
    }
    await this.episodicMemory.record({
      kind: 'routing_example',
      agentRunId: input.agentRunId,
      agentType: input.agentType,
      content,
      embedAs: 'query',
      occurredAt: new Date(),
      skipIfSameContent: true,
    });
  }

  // 모르는 값은 off — app.config 가 부팅에서 막지만, 판정부도 켜진 쪽으로 기울지 않는다.
  private shortcutMode(): MemoryShortcutMode {
    const mode = this.configService?.get<string>('ROUTER_MEMORY_SHORTCUT_MODE');
    if (mode === 'shadow' || mode === 'on') {
      return mode;
    }
    return 'off';
  }

  // 판정의 담당은 DB 문자열이다. 등록된 dispatcher 에서 찾은 AgentType 만 쓰고, 없으면 단축하지 않는다.
  private toRoutableDecision(
    decision: MemoryShortcutDecision | null,
  ): RoutableMemoryDecision | null {
    if (decision === null) {
      return null;
    }
    const dispatcher = this.dispatchers.find(
      (candidate) => candidate.agentType === decision.agentType,
    );
    if (dispatcher === undefined) {
      return null;
    }
    return { agentType: dispatcher.agentType, similarity: decision.similarity };
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
        query: normalizeRoutingText(query),
        kind: 'routing_example',
        limit: ROUTING_MEMORY_SEARCH_LIMIT,
        // 감쇠를 끈다 — 같은 문장의 판정이 날짜에 따라 바뀌면 안 된다. 정렬도 순수 cosine 순.
        halfLifeDays: Number.POSITIVE_INFINITY,
        exact: true,
      });
      return this.keepRoutableHits(hits);
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
    for (const turn of priorTurns.slice(-CLASSIFIER_TURN_LIMIT)) {
      if (isAutoPostTurn(turn)) {
        sections.push(renderAutoPostTurn(turn.text));
        continue;
      }
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

const renderAutoPostTurn = (text: string): string => {
  const startIndex = text.indexOf(UNTRUSTED_INPUT_START);
  const endIndex = text.indexOf(UNTRUSTED_INPUT_END);
  const body =
    startIndex >= 0 && endIndex > startIndex
      ? text.slice(startIndex + UNTRUSTED_INPUT_START.length, endIndex).trim()
      : text.slice(AUTO_POST_LABEL.length).trim();
  // 이미 감싼 Slack 본문을 다시 300자로 제한하고 경계를 닫아 지시처럼 읽히지 않게 한다.
  const wrappedExcerpt = wrapUntrustedInput(
    body.slice(0, CLASSIFIER_AUTO_POST_TEXT_CAP),
  );
  return `- [자동 발송 글]\n${wrappedExcerpt}`;
};

const truncate = (text: string): string =>
  text.length > 60 ? `${text.slice(0, 60)}…` : text;

const truncateContent = (text: string): string => {
  const flattened = text.replace(/\s+/g, ' ').trim();
  return flattened.length > EPISODIC_CONTENT_MAX_CHARS
    ? `${flattened.slice(0, EPISODIC_CONTENT_MAX_CHARS)}…`
    : flattened;
};
