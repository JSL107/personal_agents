import { Injectable, Logger } from '@nestjs/common';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationTurn } from '../../router/domain/conversation-memory.type';
import {
  buildFactAnswerPrompt,
  FACT_ANSWER_SYSTEM_PROMPT,
} from '../domain/fact-answer.prompt';
import { checkAnswerNumbers, NumberCheck } from '../domain/number-check';

export interface FactAnswerInput {
  // 모델 호출을 이 워커 이름으로 남긴다(모델 호출 로그·쿼터 집계).
  agentType: AgentType;
  text: string;
  priorTurns: readonly ConversationTurn[];
  facts: unknown;
  // 답을 못 만들거나 숫자 검사에 걸렸을 때 내보낼 결정론 요약(잔여·내역 표 등).
  fallbackText: string;
}

export interface FactAnswer {
  text: string;
  // 모델 답을 쓰지 않고 결정론 요약을 내보냈는지.
  usedFallback: boolean;
  // 실제로 답을 쓴 모델. 폴백이면 'deterministic'.
  modelUsed: string;
  numberCheck?: NumberCheck;
  answerError?: string;
}

// 메뉴형 워커가 고정 액션으로 처리하지 못한 질문(UNKNOWN)을, 워커가 조회한 사실로 답한다.
// 워커가 자기 AgentRun 안에서 부른다 — 라우팅 근거가 그 행에 한 번만 실리게 하려는 설계다
// (plan §3 「답변이 만들어지는 두 경로」). 이 usecase 자체는 원장을 쓰지 않는다.
@Injectable()
export class FactAnswerUsecase {
  private readonly logger = new Logger(FactAnswerUsecase.name);

  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async answer({
    agentType,
    text,
    priorTurns,
    facts,
    fallbackText,
  }: FactAnswerInput): Promise<FactAnswer> {
    let reply: string;
    let modelUsed: string;
    try {
      const completion = await this.modelRouter.route({
        agentType,
        request: {
          prompt: buildFactAnswerPrompt({ text, priorTurns, facts }),
          systemPrompt: FACT_ANSWER_SYSTEM_PROMPT,
        },
        // 워커의 산출물 계약 머리말은 파서용 JSON 규격이라 대화 답과 맞지 않는다.
        noContractPreamble: true,
      });
      reply = completion.text.trim();
      modelUsed = completion.modelUsed;
    } catch (error: unknown) {
      // 답을 못 만들어도 사용자에게는 조회한 사실이 나가야 한다 — 조용히 실패시키지 않는다.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`사실 기반 답변 생성 실패 (${agentType}): ${message}`);
      return {
        text: fallbackText,
        usedFallback: true,
        modelUsed: 'deterministic',
        answerError: message,
      };
    }

    if (reply.length === 0) {
      return {
        text: fallbackText,
        usedFallback: true,
        modelUsed: 'deterministic',
        answerError: '빈 응답',
      };
    }

    const numberCheck = checkAnswerNumbers({ reply, facts, question: text });
    if (!numberCheck.ok) {
      this.logger.warn(
        `사실 기반 답변 숫자 검사 실패 (${agentType}) — 근거 없는 값: ${numberCheck.unexpected.join(', ')}`,
      );
      return {
        text: fallbackText,
        usedFallback: true,
        modelUsed: 'deterministic',
        numberCheck,
      };
    }
    return { text: reply, usedFallback: false, modelUsed, numberCheck };
  }
}
