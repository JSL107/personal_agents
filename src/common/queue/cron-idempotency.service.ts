import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

// cron 중복 발송 차단 — stalled 재처리로 같은 슬롯이 2회 처리될 때 두 번째를 skip.
// "오늘 이미 발송했으면 두 번째는 skip" 하는 idempotency 가드.
//
// Redis (prod) 또는 in-memory Set (테스트 / Redis 미주입) 두 가지 백엔드.
// Redis 명령 실패 시 경고 로그 + in-memory fallback — ConversationMemoryService 와 동일 철학.
@Injectable()
export class CronIdempotencyService {
  private readonly logger = new Logger(CronIdempotencyService.name);
  // in-memory fallback — Redis 미주입 또는 Redis 장애 시 사용 (단일 노드/테스트 전용).
  private readonly inMemoryKeys = new Set<string>();

  // redis 미주입 (테스트 / dev 단일 노드) 시 in-memory Set 으로 fallback.
  // 운영은 CronIdempotencyModule 이 ConfigService 기반으로 IORedis 를 주입.
  constructor(private readonly redis?: Redis) {}

  // 키를 원자적으로 획득 시도.
  // 반환: true = 이번이 첫 실행 (발송 진행), false = 이미 실행됨 (중복 차단).
  //
  // Redis 모드: SET key 1 EX ttlSeconds NX — NX 로 atomic 보장.
  // in-memory 모드: Set.has + Set.add + setTimeout cleanup.
  // Redis 명령 throw 시: 경고 로그 + in-memory fallback.
  async acquireOnce(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.redis) {
      try {
        return await this.acquireFromRedis(key, ttlSeconds);
      } catch (error) {
        this.logger.warn(
          `CronIdempotency — Redis set 실패, in-memory fallback: ${error instanceof Error ? error.message : String(error)}`,
        );
        return this.acquireFromMemory(key, ttlSeconds);
      }
    }
    return this.acquireFromMemory(key, ttlSeconds);
  }

  // === Redis 백엔드 ===

  private async acquireFromRedis(
    key: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    // SET key 1 EX ttlSeconds NX — 키가 없을 때만 set, 있으면 null 반환 (atomic).
    const result = await this.redis!.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  // === in-memory 백엔드 (fallback / 단일 노드 / 테스트) ===

  private acquireFromMemory(key: string, ttlSeconds: number): boolean {
    if (this.inMemoryKeys.has(key)) {
      return false;
    }
    this.inMemoryKeys.add(key);
    // TTL 후 자동 제거 — 다음 날 같은 슬롯 재실행 허용.
    setTimeout(() => {
      this.inMemoryKeys.delete(key);
    }, ttlSeconds * 1000);
    return true;
  }
}
