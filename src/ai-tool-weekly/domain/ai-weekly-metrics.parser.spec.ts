import { parseAiWeeklyMetrics } from './ai-weekly-metrics.parser';

const fixture = () => ({
  version: 1,
  period: {
    since: '2026-11-02T00:00:00+09:00',
    until: '2026-11-09T00:00:00+09:00',
    prevSince: '2026-10-26T00:00:00+09:00',
  },
  scope_rule: 'fixture',
  sources: {
    claude: 'ok',
    codex: 'ok',
    git: 'ok',
    inventory: 'ok',
    hooks: 'ok',
  },
  scopes: Object.fromEntries(
    ['company', 'personal', 'unknown'].map((scope) => [
      scope,
      {
        tokens: {},
        reverts: 0,
        verify: { total: 0, piped: 0 },
        clarify: { humanTurns: 0, matched: 0 },
      },
    ]),
  ),
  inferredSessions: 0,
  tokens: {
    claude: { thisWeek: { 'claude-opus-4-8[1m]': 3 }, prevWeek: {} },
    codex: { thisWeek: 2, prevWeek: 1, zstSkipped: 0 },
  },
  reverts: 0,
  verify: { total: 0, piped: 0 },
  clarify: { humanTurns: 0, matched: 0 },
  inventory: {
    skills: { total: 0, added: 0, unused: [] },
    plugins: { total: 0, added: 0, unused: [] },
    agents: { total: 0, added: 0, unused: [] },
    hooks: { total: 0 },
  },
  hooks: { hooks: [{ name: 'test', fired: 1, delivered: 1, blocked: 0 }] },
  corrupt: 0,
});

describe('parseAiWeeklyMetrics', () => {
  it('정상 지표와 대괄호 모델 키를 받아들인다', () => {
    expect(
      parseAiWeeklyMetrics(fixture()).metrics.tokens.claude.thisWeek[
        'claude-opus-4-8[1m]'
      ],
    ).toBe(3);
  });

  it('버전이나 숫자 형태가 틀리면 민감 정보를 넣지 않은 SHAPE 오류를 낸다', () => {
    expect(() => parseAiWeeklyMetrics({ ...fixture(), version: 2 })).toThrow(
      'exit=none code=SHAPE',
    );
    const raw = fixture();
    raw.tokens.claude.thisWeek = {
      'claude-opus-4-8[1m]': 'bad',
    } as unknown as typeof raw.tokens.claude.thisWeek;
    expect(() => parseAiWeeklyMetrics(raw)).toThrow('exit=none code=SHAPE');
  });

  it('잘못된 이름을 버리고 잘못된 모델 키의 토큰은 other에 합친다', () => {
    const raw = fixture() as unknown as {
      inventory: { skills: { unused: string[] } };
      tokens: { claude: { thisWeek: Record<string, number> } };
    };
    raw.inventory.skills.unused = ['valid', 'a b', '<x>'];
    raw.tokens.claude.thisWeek = {
      'bad key!': 4,
      other: 2,
      'claude-opus-4-8[1m]': 3,
    };
    const result = parseAiWeeklyMetrics(raw);
    expect(result.metrics.inventory.skills.unused).toEqual(['valid']);
    expect(result.droppedNameCount).toBe(2);
    expect(result.metrics.tokens.claude.thisWeek.other).toBe(6);
  });
});
