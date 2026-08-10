import { Injectable, Logger } from '@nestjs/common';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CodexQuotaExceededException } from '../../../model-router/infrastructure/codex-cli.provider';
import {
  ContradictionJudgePort,
  ContradictionVerdict,
} from '../domain/contradiction-judge.port';
import {
  buildContradictionPrompt,
  CONTRADICTION_SYSTEM_PROMPT,
} from '../domain/prompt/contradiction.prompt';

// L4 — 두 에피소드 기록의 의미 충돌을 ChatGPT(codex) 로 판정. model-router 경유(API/claude -p 미사용).
// 쿼터 소진은 route() 가 ModelRouterException 으로 감싸고 cause 에 원본을 넣으므로, 체인에서
// CodexQuotaExceededException 을 추출해 re-throw → service 가 circuit break 한다.
//
// ⚠️ 이 usecase 만 실행 원장(AgentRun) 밖에 남아 있다 — 같은 세대의 다른 내부 워커
// (SUBCONSCIOUS_GATE · REVIEW_REPLY_JUDGE · HUMANIZER)는 전부 편입했지만 여기는 **모듈 순환**에
// 막힌다: AgentRunModule → EpisodicMemoryModule → ContradictionJudgeModule 이 이미 있어서,
// 여기서 AgentRunModule 을 import 하면 순환이 닫힌다(EpisodicMemoryModule 주석의 "순환 없음" 이
// 성립하는 이유이기도 하다). forwardRef 로 뚫는 대신 그대로 두었다 —
// L4 는 주간 1회·기본 최대 5쌍(DEFAULT_L4_MAX_PAIRS)이라 계측 이득이 순환을 감수할 만큼 크지 않다.
// 편입하려면 EpisodicMemoryModule 에서 ContradictionJudgeModule 의존을 걷어내는 것이 먼저다.
@Injectable()
export class JudgeContradictionUsecase implements ContradictionJudgePort {
  private readonly logger = new Logger(JudgeContradictionUsecase.name);

  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async judge(input: {
    textA: string;
    textB: string;
  }): Promise<ContradictionVerdict> {
    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.CONTRADICTION_JUDGE,
        request: {
          prompt: buildContradictionPrompt(input.textA, input.textB),
          systemPrompt: CONTRADICTION_SYSTEM_PROMPT,
        },
      });
      return this.parse(completion.text);
    } catch (error) {
      const quota = this.extractQuota(error);
      if (quota) {
        throw quota;
      }
      throw error;
    }
  }

  private parse(text: string): ContradictionVerdict {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { contradiction: false, reason: '' };
    }
    try {
      const parsed = JSON.parse(match[0]) as {
        contradiction?: unknown;
        reason?: unknown;
      };
      return {
        contradiction: parsed.contradiction === true,
        reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      };
    } catch {
      return { contradiction: false, reason: '' };
    }
  }

  // route() 의 ModelRouterException cause 체인(자신/cause/{primaryError,lastError})에서
  // CodexQuotaExceededException 을 찾는다. 순환 참조 방지용 seen 셋.
  private extractQuota(error: unknown): CodexQuotaExceededException | null {
    const seen = new Set<unknown>();
    const stack: unknown[] = [error];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current == null || seen.has(current)) {
        continue;
      }
      seen.add(current);
      if (current instanceof CodexQuotaExceededException) {
        return current;
      }
      if (typeof current === 'object') {
        const record = current as Record<string, unknown>;
        stack.push(record.cause, record.primaryError, record.lastError);
      }
    }
    return null;
  }
}
