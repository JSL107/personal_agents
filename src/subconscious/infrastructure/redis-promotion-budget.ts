import { Redis } from 'ioredis';

import { PromotionBudget } from '../domain/port/promotion-budget.port';

const WINDOW_MS = 3_600_000;

// ZSET(score=epoch ms) 슬라이딩 1시간 윈도우. Redis 미가용 시 fail-closed(false).
export class RedisPromotionBudget implements PromotionBudget {
  private readonly capPerHour: number;

  constructor(
    private readonly redis: Redis,
    capPerHour: number,
  ) {
    this.capPerHour = capPerHour;
  }

  async tryConsume(ownerSlackUserId: string, now: number): Promise<boolean> {
    const key = `subconscious:budget:${ownerSlackUserId}`;
    try {
      await this.redis.zremrangebyscore(key, 0, now - WINDOW_MS);
      const count = await this.redis.zcard(key);
      if (count >= this.capPerHour) {
        return false;
      }
      await this.redis.zadd(key, now, `${now}`);
      await this.redis.pexpire(key, WINDOW_MS);
      return true;
    } catch {
      return false;
    }
  }
}
