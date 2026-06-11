import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { AgentType } from '../model-router/domain/model-router.type';
import { AGENT_REGISTRY } from './agent-registry';

// repo 루트: <repo>/src/agent-registry → 두 단계 위.
const REPO_ROOT = resolve(__dirname, '..', '..');

describe('AGENT_REGISTRY 교차검증', () => {
  it('agentType 집합이 AgentType enum 과 정확히 일치한다 (양방향)', () => {
    const registered = new Set(AGENT_REGISTRY.map((entry) => entry.agentType));
    const declared = new Set(Object.values(AgentType));

    const missing = [...declared].filter((type) => !registered.has(type));
    const extra = [...registered].filter((type) => !declared.has(type));

    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('agentType 에 중복이 없다', () => {
    const seen = AGENT_REGISTRY.map((entry) => entry.agentType);
    expect(seen.length).toBe(new Set(seen).size);
  });

  it('모든 슬래시 커맨드는 형식이 올바르고 중복이 없다', () => {
    const slashPattern = /^\/[\w가-힣-]+( [\w가-힣-]+)*$/u;
    const all: string[] = [];
    for (const entry of AGENT_REGISTRY) {
      for (const slash of entry.slashCommands) {
        expect(slash).toMatch(slashPattern);
        all.push(slash);
      }
    }
    expect(all.length).toBe(new Set(all).size);
  });

  it('모든 usecasePath 가 실제로 존재한다', () => {
    const missing = AGENT_REGISTRY.filter(
      (entry) => !existsSync(join(REPO_ROOT, entry.usecasePath)),
    ).map((entry) => `${entry.agentType}: ${entry.usecasePath}`);

    expect(missing).toEqual([]);
  });

  it('displayName 과 description 이 비어있지 않다', () => {
    for (const entry of AGENT_REGISTRY) {
      expect(entry.displayName.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }
  });
});
