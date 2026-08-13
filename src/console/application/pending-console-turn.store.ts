import { Injectable } from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import { WorkSuggestion } from '../domain/work-suggestion.type';

export type PendingConsoleTurn =
  | {
      readonly kind: 'SUGGESTIONS';
      readonly suggestions: readonly WorkSuggestion[];
    }
  | {
      readonly kind: 'AWAITING_INPUT';
      readonly agentType: AgentType;
      readonly displayName: string;
    };

// 제안 선택과 후속 입력 대기 모두 기존 콘솔 제안 보관 수명인 30분만 유효하다.
const CONSOLE_TURN_TTL_MS = 30 * 60 * 1000;

interface PendingConsoleTurnEntry {
  readonly turn: PendingConsoleTurn;
  readonly expiresAt: number;
}

@Injectable()
export class PendingConsoleTurnStore {
  private readonly entries = new Map<string, PendingConsoleTurnEntry>();

  putSuggestions(
    slackUserId: string,
    suggestions: readonly WorkSuggestion[],
  ): void {
    this.put(slackUserId, { kind: 'SUGGESTIONS', suggestions });
  }

  putAwaitingInput(
    slackUserId: string,
    target: { readonly agentType: AgentType; readonly displayName: string },
  ): void {
    this.put(slackUserId, { kind: 'AWAITING_INPUT', ...target });
  }

  peek(slackUserId: string): PendingConsoleTurn | null {
    const entry = this.entries.get(slackUserId);
    if (entry === undefined) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(slackUserId);
      return null;
    }
    return entry.turn;
  }

  consume(slackUserId: string): void {
    this.entries.delete(slackUserId);
  }

  private put(slackUserId: string, turn: PendingConsoleTurn): void {
    // 다음 입력의 해석은 하나여야 하므로 새 상태가 이전 제안/입력 대기 상태를 덮어쓴다.
    this.entries.set(slackUserId, {
      turn,
      expiresAt: Date.now() + CONSOLE_TURN_TTL_MS,
    });
  }
}
