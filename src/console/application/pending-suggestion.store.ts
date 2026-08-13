import { Injectable } from '@nestjs/common';

import { WorkSuggestion } from '../domain/work-suggestion.type';

// 콘솔 제안 카드가 화면에 남는 30분과 같은 수명으로 번호 선택의 유효 시간을 제한한다.
const SUGGESTION_TTL_MS = 30 * 60 * 1000;

interface PendingSuggestionEntry {
  readonly suggestions: readonly WorkSuggestion[];
  readonly expiresAt: number;
}

@Injectable()
export class PendingSuggestionStore {
  private readonly entries = new Map<string, PendingSuggestionEntry>();

  put(slackUserId: string, suggestions: readonly WorkSuggestion[]): void {
    this.entries.set(slackUserId, {
      suggestions,
      expiresAt: Date.now() + SUGGESTION_TTL_MS,
    });
  }

  peek(slackUserId: string): readonly WorkSuggestion[] {
    const entry = this.entries.get(slackUserId);
    if (entry === undefined) {
      return [];
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(slackUserId);
      return [];
    }
    return entry.suggestions;
  }

  consume(slackUserId: string): void {
    this.entries.delete(slackUserId);
  }
}
