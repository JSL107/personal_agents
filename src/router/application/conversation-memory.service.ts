import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import { ConversationTurn } from '../domain/conversation-memory.type';

// 자연어 multi-turn 메모리 — Slack app_mention / DM 진입의 사용자별 대화 컨텍스트 보존.
// IntentClassifier 가 지시대명사 ("그거 분배해") 분류 정확도 ↑ + IdaeriRouter 가 직전 worker
// run id 를 contextRefs 로 자동 전달.
//
// 저장: Redis (prod) 또는 in-memory Map (test / Redis 미주입). TTL 30분, 사용자당 최대 5 turn.
// Redis 모드는 multi-instance 배포 / 재시작 안전 — RouterModule 가 ConfigService 의
// REDIS_HOST/REDIS_PORT 로 IORedis 를 wiring. 둘 다 부재 시 Map fallback (단일 노드).
const TTL_MS = 30 * 60 * 1000;
const TTL_SECONDS = TTL_MS / 1000;
const MAX_TURNS = 5;
const REDIS_KEY_PREFIX = 'conversation:';

@Injectable()
export class ConversationMemoryService implements OnModuleDestroy {
  private readonly logger = new Logger(ConversationMemoryService.name);
  private readonly memory = new Map<string, ConversationTurn[]>();

  // redis 미주입 (테스트 / dev 단일 노드) 시 in-memory Map 으로 fallback. 운영은 RouterModule
  // 가 ConfigService 기반으로 IORedis 를 주입 — multi-instance / 재시작 안전.
  constructor(private readonly redis?: Redis) {}

  // RouterModule useFactory 로 받은 Redis 연결을 본 서비스가 소유. process 종료 시 graceful quit.
  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }

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

  // 만료 turn 제거 후 최대 MAX_TURNS 만 반환. Map 모드는 호출 시 in-place cleanup 부수효과;
  // Redis 모드는 read-only filter 만 (다음 appendTurn 호출 시 LTRIM 으로 정리 — race 회피).
  async getRecentTurns(key: string): Promise<ConversationTurn[]> {
    if (this.redis) {
      return this.getFromRedis(key);
    }
    return this.getFromMemory(key);
  }

  async appendTurn(key: string, turn: ConversationTurn): Promise<void> {
    if (this.redis) {
      await this.appendToRedis(key, turn);
      this.logger.debug(
        `ConversationMemory append (redis) — key=${key} latest=${turn.agentType ?? 'null'}/${turn.agentRunId ?? '-'}`,
      );
      return;
    }
    this.appendToMemory(key, turn);
    this.logger.debug(
      `ConversationMemory append (memory) — key=${key} latest=${turn.agentType ?? 'null'}/${turn.agentRunId ?? '-'}`,
    );
  }

  // === Redis 백엔드 ===

  private async getFromRedis(key: string): Promise<ConversationTurn[]> {
    const redisKey = this.toRedisKey(key);
    const raw = await this.redis!.lrange(redisKey, 0, -1);
    const parsed = raw.flatMap((entry) => this.parseTurn(entry));
    const fresh = this.dropExpired(parsed);
    return fresh.slice(-MAX_TURNS);
  }

  private async appendToRedis(
    key: string,
    turn: ConversationTurn,
  ): Promise<void> {
    const redisKey = this.toRedisKey(key);
    const serialized = JSON.stringify(turn);
    // RPUSH 후 LTRIM 으로 MAX_TURNS 만 보존, EXPIRE 로 TTL 갱신. pipeline 으로 round-trip 1회.
    await this.redis!.multi()
      .rpush(redisKey, serialized)
      .ltrim(redisKey, -MAX_TURNS, -1)
      .expire(redisKey, TTL_SECONDS)
      .exec();
  }

  private toRedisKey(key: string): string {
    return `${REDIS_KEY_PREFIX}${key}`;
  }

  private parseTurn(raw: string): ConversationTurn[] {
    try {
      const parsed = JSON.parse(raw) as ConversationTurn;
      if (typeof parsed.timestampMs !== 'number') {
        return [];
      }
      return [parsed];
    } catch (error) {
      this.logger.warn(
        `ConversationMemory — Redis entry parse 실패 (drop): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // === in-memory 백엔드 (fallback / test) ===

  private getFromMemory(key: string): ConversationTurn[] {
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

  private appendToMemory(key: string, turn: ConversationTurn): void {
    const current = this.memory.get(key) ?? [];
    const fresh = this.dropExpired(current);
    fresh.push(turn);
    const capped = fresh.slice(-MAX_TURNS);
    this.memory.set(key, capped);
  }

  private dropExpired(turns: ConversationTurn[]): ConversationTurn[] {
    const cutoff = Date.now() - TTL_MS;
    return turns.filter((turn) => turn.timestampMs >= cutoff);
  }
}
