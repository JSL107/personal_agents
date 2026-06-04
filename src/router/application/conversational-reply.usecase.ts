import { Inject, Injectable, Logger } from '@nestjs/common';

import { ModelProviderName } from '../../model-router/domain/model-router.type';
import {
  MODEL_PROVIDER_TOKENS,
  ModelProviderPort,
} from '../../model-router/domain/port/model-provider.port';
import { ConversationTurn } from '../domain/conversation-memory.type';

const SYSTEM_PROMPT = `당신은 "이대리" 라는 슬랙 봇입니다. 사용자의 자연어 메시지에 친근하고 짧게 (1~3문장) 한국어로 답해주세요.

기본 자세:
- 항상 자연어로 티키타카 — 명령어 추천 / 슬래시 안내 절대 X (\`/today\`, \`/be plan\`, \`/review-pr\` 같은 표현 사용 금지).
- 사용자가 무언가 시도하려는 의도가 보이면 "어디서 시작할까요?", "어떤 부분이 의심되시나요?" 같이 자연스러운 follow-up 질문으로 끌어주세요.
- "맡겨주세요", "작업을 던져주세요" 같은 형식적 표현 X — 그냥 같이 대화하듯이.

답변 규칙:
- 모르거나 단정 어려운 사실 (예: 봇 자체의 현재 작업 상태) 은 솔직히 "지금은 대기 중", "확인이 필요하겠어요" 식으로 짧게.
- 시스템 내부 동작 / LLM 사용 / agent 분류기 / sandbox 같은 내부 용어 노출 X.
- 사용자가 봇을 통해 무언가 (코드 변경, PR 검토, plan 수립 등) 를 원하는 듯하면 명령어 대신 "어느 repo / 어느 PR / 어떤 task 인지" 자연스럽게 물어보세요. 봇이 내부적으로 alias 매칭해 진행합니다.
- 1~3문장 안. 길어지면 핵심 한 문장 + 후속 질문 한 문장 정도.`;

// prompt 폭증 방지 — 최근 5 turn 정도면 충분한 컨텍스트. 너무 많으면 cost + latency 폭증.
const PRIOR_TURN_LIMIT = 5;
const PRIOR_TURN_TEXT_CAP = 200;

// IntentClassifier 가 UNKNOWN 반환 (어느 worker 에도 매핑 불가) 시 RouterMessageHandler 의 catch
// 분기에서 호출되는 일반 대화 응답 fallback.
//
// AgentRunService 우회 — conversational 응답은 추적 가치 낮음 + AgentRun 통계 오염 회피.
// CHATGPT provider 직접 호출 (Codex CLI) — 짧은 응답 / 빠른 latency 가 적합.
@Injectable()
export class ConversationalReplyUsecase {
  private readonly logger = new Logger(ConversationalReplyUsecase.name);

  constructor(
    @Inject(MODEL_PROVIDER_TOKENS[ModelProviderName.CHATGPT])
    private readonly chatgptProvider: ModelProviderPort,
  ) {}

  async reply({
    text,
    priorTurns,
  }: {
    text: string;
    priorTurns: ConversationTurn[];
  }): Promise<string> {
    const prompt = buildPrompt({ text, priorTurns });
    try {
      const response = await this.chatgptProvider.complete({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
      });
      return response.text.trim();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Conversational fallback 실패: ${message}`);
      throw error;
    }
  }
}

const buildPrompt = ({
  text,
  priorTurns,
}: {
  text: string;
  priorTurns: ConversationTurn[];
}): string => {
  const recent = priorTurns.slice(-PRIOR_TURN_LIMIT);
  if (recent.length === 0) {
    return `[사용자 메시지]\n${text}\n\n위 메시지에 1~3문장으로 답하세요.`;
  }
  const turnLines = recent.map((turn, idx) => {
    const truncated =
      turn.text.length > PRIOR_TURN_TEXT_CAP
        ? `${turn.text.slice(0, PRIOR_TURN_TEXT_CAP)}…`
        : turn.text;
    const tag = turn.agentType ? `[${turn.agentType}]` : '[unknown]';
    return `${idx + 1}. ${tag} ${truncated}`;
  });
  return [
    `[이전 대화 (오래된 순)]`,
    ...turnLines,
    '',
    `[현재 사용자 메시지]`,
    text,
    '',
    `위 메시지에 1~3문장으로 답하세요.`,
  ].join('\n');
};
