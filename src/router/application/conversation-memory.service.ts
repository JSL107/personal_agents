import { Injectable, Logger } from '@nestjs/common';

import { ConversationTurn } from '../domain/conversation-memory.type';

// 자연어 multi-turn 메모리 — Slack app_mention / DM 진입의 사용자별 대화 컨텍스트 보존.
// IntentClassifier 가 지시대명사 ("그거 분배해") 분류 정확도 ↑ + IdaeriRouter 가 직전 worker
// run id 를 contextRefs 로 자동 전달.
//
// 저장: in-memory Map. TTL 30분, 사용자당 최대 5 turn. 봇 재시작 시 메모리 소실
// (사용자 입장에서는 30분 안 회복 가능 — 영향 작음). multi-instance 배포 시 instance 별 분리.
// 영구 저장 (Redis / Prisma) 도입은 follow-up plan.
const TTL_MS = 30 * 60 * 1000;
const MAX_TURNS = 5;

@Injectable()
export class ConversationMemoryService {
  private readonly logger = new Logger(ConversationMemoryService.name);
  private readonly memory = new Map<string, ConversationTurn[]>();

  // conversationKey 정의: slackUserId + channelId. thread 단위 분리 X — 같은 채널/DM 안
  // 사용자 입장에서 한 대화로 본다 (Slack thread 가 비공식 사용 시 혼동 회피).
  buildKey({
    slackUserId,
    channelId,
  }: {
    slackUserId: string;
    channelId: string;
  }): string {
    return `${slackUserId}:${channelId}`;
  }

  // 만료 turn 제거 후 최대 MAX_TURNS 만 반환. 호출 시 cleanup 도 부수효과로 실행.
  // 빈 배열이면 메모리에서 key 제거 (메모리 누수 방지).
  getRecentTurns(key: string): ConversationTurn[] {
    const turns = this.memory.get(key);
    if (!turns) {
      return [];
    }
    const fresh = this.dropExpired(turns);
    if (fresh.length === 0) {
      this.memory.delete(key);
      return [];
    }
    if (fresh.length !== turns.length) {
      this.memory.set(key, fresh);
    }
    return fresh.slice(-MAX_TURNS);
  }

  appendTurn(key: string, turn: ConversationTurn): void {
    const current = this.memory.get(key) ?? [];
    const fresh = this.dropExpired(current);
    fresh.push(turn);
    const capped = fresh.slice(-MAX_TURNS);
    this.memory.set(key, capped);
    this.logger.debug(
      `ConversationMemory append — key=${key} turns=${capped.length} latest=${turn.agentType ?? 'null'}/${turn.agentRunId ?? '-'}`,
    );
  }

  private dropExpired(turns: ConversationTurn[]): ConversationTurn[] {
    const cutoff = Date.now() - TTL_MS;
    return turns.filter((turn) => turn.timestampMs >= cutoff);
  }
}
