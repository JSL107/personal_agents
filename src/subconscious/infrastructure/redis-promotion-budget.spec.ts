import { Redis } from 'ioredis';

import { RedisPromotionBudget } from './redis-promotion-budget';

// ioredis-mock 는 모든 인스턴스가 싱글턴 스토어를 공유해 테스트 격리가 안 됨.
// 슬라이딩 윈도우 로직(zremrangebyscore / zcard / zadd / pexpire)만 구현하는 최소 인메모리 페이크.
function makeFakeRedis(): Redis {
  const zsets = new Map<string, Map<string, number>>();

  const getZset = (key: string): Map<string, number> => {
    if (!zsets.has(key)) {
      zsets.set(key, new Map());
    }
    return zsets.get(key)!;
  };

  return {
    zremrangebyscore: (_key: string, _min: number, max: number) => {
      const zset = getZset(_key);
      for (const [member, score] of zset) {
        if (score >= Number(_min) && score <= Number(max)) {
          zset.delete(member);
        }
      }
      return Promise.resolve(0);
    },
    zcard: (_key: string) => {
      return Promise.resolve(getZset(_key).size);
    },
    zadd: (_key: string, score: number, member: string) => {
      getZset(_key).set(member, score);
      return Promise.resolve(1);
    },
    pexpire: () => Promise.resolve(1),
  } as unknown as Redis;
}

describe('RedisPromotionBudget', () => {
  it('cap 까지 허용하고 그 다음은 거부', async () => {
    const budget = new RedisPromotionBudget(makeFakeRedis(), 2);
    const t = 1_000_000;
    expect(await budget.tryConsume('U1', t)).toBe(true);
    expect(await budget.tryConsume('U1', t + 1)).toBe(true);
    expect(await budget.tryConsume('U1', t + 2)).toBe(false);
  });

  it('1시간 지나면 윈도우 비워져 다시 허용', async () => {
    const budget = new RedisPromotionBudget(makeFakeRedis(), 1);
    const t = 1_000_000;
    expect(await budget.tryConsume('U1', t)).toBe(true);
    expect(await budget.tryConsume('U1', t + 3_600_001)).toBe(true);
  });

  it('owner 별로 독립적', async () => {
    const budget = new RedisPromotionBudget(makeFakeRedis(), 1);
    const t = 1_000_000;
    expect(await budget.tryConsume('U1', t)).toBe(true);
    expect(await budget.tryConsume('U2', t)).toBe(true);
  });
});
