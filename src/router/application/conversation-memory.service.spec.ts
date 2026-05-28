import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationMemoryService } from './conversation-memory.service';

const TTL_MS = 30 * 60 * 1000;
const MAX_TURNS = 5;

describe('ConversationMemoryService', () => {
  let service: ConversationMemoryService;

  beforeEach(() => {
    service = new ConversationMemoryService();
  });

  it('buildKey — slackUserId:channelId 형식', () => {
    expect(service.buildKey({ slackUserId: 'U1', channelId: 'C100' })).toBe(
      'U1:C100',
    );
  });

  it('빈 memory 면 getRecentTurns 가 빈 배열 반환', () => {
    expect(service.getRecentTurns('U1:C100')).toEqual([]);
  });

  it('appendTurn → getRecentTurns 로 회복', () => {
    const key = service.buildKey({ slackUserId: 'U1', channelId: 'C100' });
    service.appendTurn(key, {
      text: '오늘 plan?',
      agentType: AgentType.PM,
      agentRunId: 99,
      timestampMs: Date.now(),
    });
    const turns = service.getRecentTurns(key);
    expect(turns).toHaveLength(1);
    expect(turns[0].agentType).toBe(AgentType.PM);
    expect(turns[0].agentRunId).toBe(99);
  });

  it('appendTurn 여러 번 — MAX_TURNS 캡 (마지막 5개만 보존)', () => {
    const key = 'U1:C100';
    for (let i = 1; i <= MAX_TURNS + 3; i++) {
      service.appendTurn(key, {
        text: `turn ${i}`,
        agentType: AgentType.PM,
        agentRunId: i,
        timestampMs: Date.now(),
      });
    }
    const turns = service.getRecentTurns(key);
    expect(turns).toHaveLength(MAX_TURNS);
    expect(turns[0].agentRunId).toBe(4);
    expect(turns[turns.length - 1].agentRunId).toBe(MAX_TURNS + 3);
  });

  it('TTL 초과 turn 은 dropped (getRecentTurns)', () => {
    const key = 'U1:C100';
    service.appendTurn(key, {
      text: 'old',
      agentType: AgentType.PM,
      agentRunId: 1,
      timestampMs: Date.now() - TTL_MS - 60_000,
    });
    service.appendTurn(key, {
      text: 'fresh',
      agentType: AgentType.PM,
      agentRunId: 2,
      timestampMs: Date.now(),
    });
    const turns = service.getRecentTurns(key);
    expect(turns).toHaveLength(1);
    expect(turns[0].agentRunId).toBe(2);
  });

  it('모든 turn TTL 초과 시 memory 의 key 자체 제거', () => {
    const key = 'U1:C100';
    service.appendTurn(key, {
      text: 'old',
      agentType: AgentType.PM,
      agentRunId: 1,
      timestampMs: Date.now() - TTL_MS - 60_000,
    });
    expect(service.getRecentTurns(key)).toEqual([]);
    // 다시 호출해도 빈 배열 — internal map 에서 지워졌는지 함수 외에 직접 확인 불가하지만,
    // 동작이 일관되면 OK.
    expect(service.getRecentTurns(key)).toEqual([]);
  });

  it('다른 user 의 메모리는 격리', () => {
    const k1 = service.buildKey({ slackUserId: 'U1', channelId: 'C100' });
    const k2 = service.buildKey({ slackUserId: 'U2', channelId: 'C100' });
    service.appendTurn(k1, {
      text: 'u1',
      agentType: AgentType.PM,
      agentRunId: 1,
      timestampMs: Date.now(),
    });
    expect(service.getRecentTurns(k1)).toHaveLength(1);
    expect(service.getRecentTurns(k2)).toEqual([]);
  });

  it('같은 user 의 다른 channel 도 격리', () => {
    const k1 = service.buildKey({ slackUserId: 'U1', channelId: 'C100' });
    const k2 = service.buildKey({ slackUserId: 'U1', channelId: 'C200' });
    service.appendTurn(k1, {
      text: 'c100',
      agentType: AgentType.PM,
      agentRunId: 1,
      timestampMs: Date.now(),
    });
    expect(service.getRecentTurns(k1)).toHaveLength(1);
    expect(service.getRecentTurns(k2)).toEqual([]);
  });

  it('appendTurn — null agentType/agentRunId 도 graceful (분류/dispatch 실패 turn)', () => {
    const key = 'U1:C100';
    service.appendTurn(key, {
      text: '뭔말?',
      agentType: null,
      agentRunId: null,
      timestampMs: Date.now(),
    });
    const turns = service.getRecentTurns(key);
    expect(turns).toHaveLength(1);
    expect(turns[0].agentType).toBeNull();
    expect(turns[0].agentRunId).toBeNull();
  });
});
