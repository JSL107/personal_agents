import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

// cron 중복 발송 차단 — stalled 재처리로 같은 슬롯이 2회 처리될 때 두 번째를 skip.
// "오늘 이미 발송했으면 두 번째는 skip" 하는 idempotency 가드.
//
// Redis (prod) 또는 in-memory Set (테스트 / Redis 미주입) 두 가지 백엔드.
// Redis 명령 실패 시 경고 로그 + in-memory fallback — ConversationMemoryService 와 동일 철학.
//
// ⚠️ split-brain 한계: 첫 호출이 Redis 로 키를 set 한 뒤 같은 날 다른 호출이 Redis 일시 장애로
// in-memory fallback 을 타면 first-run 으로 오인해 중복 발송될 수 있다 (success-then-failure window).
// 단일 노드 + Redis 안정 환경에선 무시 가능 — Redis 가 정상이면 모든 호출이 동일 atomic 키를 본다.
@Injectable()
export class CronIdempotencyService implements OnModuleDestroy {
  private readonly logger = new Logger(CronIdempotencyService.name);
  // in-memory fallback — Redis 미주입 또는 Redis 장애 시 사용 (단일 노드/테스트 전용).
  private readonly inMemoryKeys = new Set<string>();

  // redis 미주입 (테스트 / dev 단일 노드) 시 in-memory Set 으로 fallback.
  // 운영은 CronIdempotencyModule 이 ConfigService 기반으로 IORedis 를 주입.
  constructor(private readonly redis?: Redis) {}

  // process 종료 시 소유한 Redis 연결 graceful quit. 이미 끊겼으면 swallow (종료 흐름 보호).
  async onModuleDestroy(): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.quit();
    } catch (error) {
      this.logger.warn(
        `CronIdempotency — Redis quit() 실패 (이미 끊김 가능, swallow): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 키를 원자적으로 획득 시도.
  // 반환: true = 이번이 첫 실행 (발송 진행), false = 이미 실행됨 (중복 차단).
  //
  // Redis 모드: SET key 1 EX ttlSeconds NX — NX 로 atomic 보장.
  // in-memory 모드: Set.has + Set.add + setTimeout cleanup.
  // Redis 명령 throw 시: 경고 로그 + in-memory fallback (위 split-brain 한계 주석 참조).
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

  // 획득한 키를 해제(삭제)한다 — "발송 성공 시에만 가드를 소비" 하기 위한 롤백 연산.
  // acquireOnce 로 키를 선점한 뒤 발송이 실패하면 이 메서드로 키를 되돌려, BullMQ 재시도가
  // 같은 슬롯을 "이미 발송됨" 으로 오인해 영구 차단하지 않고 다시 발송하게 한다.
  //
  // Redis 모드: DEL. in-memory 모드: Set.delete.
  // Redis del 실패 시: 경고 로그 + in-memory fallback 삭제도 시도 (release 가 throw 해
  // 상위 재시도/에러 흐름을 어지럽히지 않도록 swallow — graceful degradation).
  async release(key: string): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.del(key);
      } catch (error) {
        this.logger.warn(
          `CronIdempotency — Redis del 실패, in-memory fallback 삭제 시도: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.inMemoryKeys.delete(key);
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
    const timer = setTimeout(() => {
      this.inMemoryKeys.delete(key);
    }, ttlSeconds * 1000);
    // 이벤트 루프를 붙들지 않도록 unref — graceful shutdown 보장 (jest 강제 종료 경고 해소).
    timer.unref();
    return true;
  }
}
