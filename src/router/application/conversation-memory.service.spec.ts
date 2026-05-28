import { Redis } from 'ioredis';

import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationMemoryService } from './conversation-memory.service';

const TTL_MS = 30 * 60 * 1000;
const MAX_TURNS = 5;

describe('ConversationMemoryService — in-memory (Redis 미주입)', () => {
  let service: ConversationMemoryService;

  beforeEach(() => {
    service = new ConversationMemoryService();
  });

  it('buildKey — slackUserId:channelId 형식', () => {
    expect(service.buildKey({ slackUserId: 'U1', channelId: 'C100' })).toBe(
      'U1:C100',
    );
  });

  it('빈 memory 면 getRecentTurns 가 빈 배열 반환', async () => {
    await expect(service.getRecentTurns('U1:C100')).resolves.toEqual([]);
  });

  it('appendTurn → getRecentTurns 로 회복', async () => {
    const key = service.buildKey({ slackUserId: 'U1', channelId: 'C100' });
    await service.appendTurn(key, {
      text: '오늘 plan?',
      agentType: AgentType.PM,
      agentRunId: 99,
      timestampMs: Date.now(),
    });
    const turns = await service.getRecentTurns(key);
    expect(turns).toHaveLength(1);
    expect(turns[0].agentType).toBe(AgentType.PM);
    expect(turns[0].agentRunId).toBe(99);
  });

  it('appendTurn 여러 번 — MAX_TURNS 캡 (마지막 5개만 보존)', async () => {
    const key = 'U1:C100';
    for (let i = 1; i <= MAX_TURNS + 3; i++) {
      await service.appendTurn(key, {
        text: `turn ${i}`,
        agentType: AgentType.PM,
        agentRunId: i,
        timestampMs: Date.now(),
      });
    }
    const turns = await service.getRecentTurns(key);
    expect(turns).toHaveLength(MAX_TURNS);
    expect(turns[0].agentRunId).toBe(4);
    expect(turns[turns.length - 1].agentRunId).toBe(MAX_TURNS + 3);
  });

  it('TTL 초과 turn 은 dropped (getRecentTurns)', async () => {
    const key = 'U1:C100';
    await service.appendTurn(key, {
      text: 'old',
      agentType: AgentType.PM,
      agentRunId: 1,
      timestampMs: Date.now() - TTL_MS - 60_000,
    });
    await service.appendTurn(key, {
      text: 'fresh',
      agentType: AgentType.PM,
      agentRunId: 2,
      timestampMs: Date.now(),
    });
    const turns = await service.getRecentTurns(key);
    expect(turns).toHaveLength(1);
    expect(turns[0].agentRunId).toBe(2);
  });

  it('모든 turn TTL 초과 시 memory 의 key 자체 제거', async () => {
    const key = 'U1:C100';
    await service.appendTurn(key, {
      text: 'old',
      agentType: AgentType.PM,
      agentRunId: 1,
      timestampMs: Date.now() - TTL_MS - 60_000,
    });
    await expect(service.getRecentTurns(key)).resolves.toEqual([]);
    await expect(service.getRecentTurns(key)).resolves.toEqual([]);
  });

  it('다른 user 의 메모리는 격리', async () => {
    const k1 = service.buildKey({ slackUserId: 'U1', channelId: 'C100' });
    const k2 = service.buildKey({ slackUserId: 'U2', channelId: 'C100' });
    await service.appendTurn(k1, {
      text: 'u1',
      agentType: AgentType.PM,
      agentRunId: 1,
      timestampMs: Date.now(),
    });
    await expect(service.getRecentTurns(k1)).resolves.toHaveLength(1);
    await expect(service.getRecentTurns(k2)).resolves.toEqual([]);
  });

  it('같은 user 의 다른 channel 도 격리', async () => {
    const k1 = service.buildKey({ slackUserId: 'U1', channelId: 'C100' });
    const k2 = service.buildKey({ slackUserId: 'U1', channelId: 'C200' });
    await service.appendTurn(k1, {
      text: 'c100',
      agentType: AgentType.PM,
      agentRunId: 1,
      timestampMs: Date.now(),
    });
    await expect(service.getRecentTurns(k1)).resolves.toHaveLength(1);
    await expect(service.getRecentTurns(k2)).resolves.toEqual([]);
  });

  it('appendTurn — null agentType/agentRunId 도 graceful (분류/dispatch 실패 turn)', async () => {
    const key = 'U1:C100';
    await service.appendTurn(key, {
      text: '뭔말?',
      agentType: null,
      agentRunId: null,
      timestampMs: Date.now(),
    });
    const turns = await service.getRecentTurns(key);
    expect(turns).toHaveLength(1);
    expect(turns[0].agentType).toBeNull();
    expect(turns[0].agentRunId).toBeNull();
  });
});

describe('ConversationMemoryService — Redis 백엔드 (multi-instance / 재시작 안전)', () => {
  // ioredis 의 chainable multi() 와 LRANGE 만 mock. 운영 코드 RPUSH/LTRIM/EXPIRE/LRANGE
  // 만 호출하므로 그 4 method 의 contract 만 검증.
  const buildRedisMock = (): {
    redis: Redis;
    multi: { rpush: jest.Mock; ltrim: jest.Mock; expire: jest.Mock; exec: jest.Mock };
    lrange: jest.Mock;
  } => {
    const multi = {
      rpush: jest.fn().mockReturnThis(),
      ltrim: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const lrange = jest.fn();
    const redis = {
      multi: jest.fn(() => multi),
      lrange,
    } as unknown as Redis;
    return { redis, multi, lrange };
  };

  it('appendTurn — RPUSH + LTRIM(-5,-1) + EXPIRE(1800) pipeline 호출', async () => {
    const { redis, multi } = buildRedisMock();
    const service = new ConversationMemoryService(redis);

    await service.appendTurn('U1:C100', {
      text: 'plan?',
      agentType: AgentType.PM,
      agentRunId: 1,
      timestampMs: Date.now(),
    });

    expect(multi.rpush).toHaveBeenCalledWith(
      'conversation:U1:C100',
      expect.stringContaining('"agentRunId":1'),
    );
    expect(multi.ltrim).toHaveBeenCalledWith('conversation:U1:C100', -5, -1);
    expect(multi.expire).toHaveBeenCalledWith('conversation:U1:C100', 1800);
    expect(multi.exec).toHaveBeenCalledTimes(1);
  });

  it('getRecentTurns — LRANGE 결과 JSON.parse + TTL 필터', async () => {
    const { redis, lrange } = buildRedisMock();
    const service = new ConversationMemoryService(redis);
    const fresh = {
      text: 'fresh',
      agentType: AgentType.PM,
      agentRunId: 2,
      timestampMs: Date.now(),
    };
    const old = {
      text: 'old',
      agentType: AgentType.PM,
      agentRunId: 1,
      timestampMs: Date.now() - TTL_MS - 60_000,
    };
    lrange.mockResolvedValue([JSON.stringify(old), JSON.stringify(fresh)]);

    const turns = await service.getRecentTurns('U1:C100');

    expect(lrange).toHaveBeenCalledWith('conversation:U1:C100', 0, -1);
    expect(turns).toHaveLength(1);
    expect(turns[0].agentRunId).toBe(2);
  });

  it('getRecentTurns — 손상된 JSON entry 는 silent drop, 나머지는 보존', async () => {
    const { redis, lrange } = buildRedisMock();
    const service = new ConversationMemoryService(redis);
    const valid = {
      text: 'ok',
      agentType: AgentType.PM,
      agentRunId: 7,
      timestampMs: Date.now(),
    };
    lrange.mockResolvedValue(['not-json', JSON.stringify(valid)]);

    const turns = await service.getRecentTurns('U1:C100');

    expect(turns).toHaveLength(1);
    expect(turns[0].agentRunId).toBe(7);
  });

  it('getRecentTurns — 빈 LRANGE 면 빈 배열', async () => {
    const { redis, lrange } = buildRedisMock();
    const service = new ConversationMemoryService(redis);
    lrange.mockResolvedValue([]);

    await expect(service.getRecentTurns('U1:C100')).resolves.toEqual([]);
  });
});
