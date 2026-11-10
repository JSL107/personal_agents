import { AiWeeklyMetrics } from '../../ai-tool-weekly/domain/ai-weekly-metrics.type';
import { resolveAiWeeklyPeriod } from '../../ai-tool-weekly/domain/ai-weekly-period';
import {
  AiWeeklyPullRequests,
  formatAiToolWeekly,
} from './ai-tool-weekly.formatter';

const period = resolveAiWeeklyPeriod('2026-11-10');
const metrics: AiWeeklyMetrics = {
  version: 1,
  period: { since: '', until: '', prevSince: '' },
  scope_rule: 'origin remote',
  sources: {
    claude: 'ok',
    codex: 'ok',
    git: 'ok',
    inventory: 'ok',
    hooks: 'ok',
  },
  scopes: {
    company: {
      tokens: {},
      reverts: 1,
      verify: { total: 50, piped: 42 },
      clarify: { humanTurns: 50, matched: 2 },
    },
    personal: {
      tokens: {},
      reverts: 0,
      verify: { total: 50, piped: 42 },
      clarify: { humanTurns: 47, matched: 2 },
    },
    unknown: {
      tokens: {},
      reverts: 0,
      verify: { total: 0, piped: 0 },
      clarify: { humanTurns: 0, matched: 0 },
    },
  },
  inferredSessions: 3,
  tokens: {
    claude: {
      thisWeek: {
        'claude-opus-4-6': 251_320_000,
        'claude-sonnet-4-5': 123_600_000,
        other: 37_080_000,
      },
      prevWeek: { other: 447_826_087 },
    },
    codex: { thisWeek: 38_000_000, prevWeek: 39_175_258, zstSkipped: 0 },
  },
  reverts: 1,
  verify: { total: 100, piped: 84 },
  clarify: { humanTurns: 97, matched: 4 },
  inventory: {
    skills: {
      total: 29,
      added: 0,
      unused: [
        'skill-a',
        'skill-b',
        'skill-c',
        'skill-d',
        'skill-e',
        'skill-f',
      ],
    },
    plugins: { total: 7, added: 3, unused: ['plugin-a', 'plugin-b'] },
    agents: { total: 13, added: 0, unused: [] },
    hooks: { total: 17 },
  },
  hooks: {
    hooks: [{ name: 'audit', fired: 1339, delivered: 11, blocked: 12 }],
  },
  corrupt: 0,
};
const pullRequests: AiWeeklyPullRequests = {
  status: 'ok',
  company: 15,
  personal: 8,
  truncated: false,
};

const render = (
  source: AiWeeklyMetrics = metrics,
  prs: AiWeeklyPullRequests = pullRequests,
) => formatAiToolWeekly({ period, metrics: source, pullRequests: prs });

describe('formatAiToolWeekly', () => {
  it('정상 지표를 정해진 요약과 상세 형식으로 표시한다', () => {
    const result = render();
    expect(result.summary).toBe(
      [
        '🧰 AI 도구 주간 점검 11/02(월)~11/08(일)',
        '결과: 머지 PR 23 (회사 15 · 개인 8) · revert 1',
        '비용: Claude 토큰 412M (지난주 대비 -8%) · Opus 61% · Sonnet 30% · Codex 38M (-3%)',
        '신호: 검증 명령 파이프 경유 84% · 훅 울림 1339 / 전달 11 / 차단 12 (차단은 하한값)',
        '이해: 설명 재요청 4.1% (휴리스틱)',
        '정비 후보: 0회 사용 스킬 6 · 플러그인 2 · 이번 주 추가 3 (총 스킬 29 · 플러그인 7 · 훅 17 · 에이전트 13)',
      ].join('\n'),
    );
    expect(result.detail).toContain('회사');
    expect(result.detail).toContain('개인');
    expect(result.detail).toContain('unknown');
    expect(result.detail).toContain('경로로 추정 분류한 세션 3건');
    expect(result.detail).toContain('skill-a');
    expect(result.detail).toContain('plugin-b');
    expect(result.detail).toContain(
      '수집 상태: claude ok · codex ok · git ok · inventory ok · hooks ok',
    );
  });

  it.each([
    [
      { status: 'ok', company: 0, personal: 100, truncated: true },
      '머지 PR ≥100 (회사 0 · 개인 100) · revert 1 · 회사 PR 0건: 조회 권한 확인 필요',
    ],
    [{ status: 'error' }, '머지 PR 조회 실패'],
    [{ status: 'skipped' }, '머지 PR (dry-run 생략)'],
  ] as const)('PR 상태 %o에 맞춰 결과를 표시한다', (prs, expected) => {
    expect(render(metrics, prs).summary).toContain(expected);
  });

  it('지난주 토큰이 없거나 압축 파일을 건너뛰면 해당 사실을 표시한다', () => {
    const changed = structuredClone(metrics);
    changed.tokens.claude.prevWeek = {};
    changed.tokens.codex.prevWeek = 0;
    changed.tokens.codex.zstSkipped = 2;
    const result = render(changed);
    expect(result.summary).toContain('지난주 데이터 없음');
    expect(result.summary).toContain('압축 2건 제외');
  });

  it.each([
    ['claude', 'ok', 'Claude 토큰 412M', '비용:'],
    ['claude', 'missing', 'Claude 토큰 수집 실패', '신호:'],
    ['claude', 'error', 'Claude 토큰 수집 실패', '이해: 수집 실패'],
    ['codex', 'ok', 'Codex 38M', '비용:'],
    ['codex', 'missing', 'Codex 수집 실패', '비용:'],
    ['codex', 'error', 'Codex 수집 실패', '비용:'],
    ['git', 'ok', 'revert 1', '결과:'],
    ['git', 'missing', 'revert 수집 실패', '결과:'],
    ['git', 'error', 'revert 수집 실패', '결과:'],
    ['inventory', 'ok', '0회 사용 스킬 6', '정비 후보:'],
    ['inventory', 'missing', '정비 후보: 수집 실패', '정비 후보:'],
    ['inventory', 'error', '정비 후보: 수집 실패', '정비 후보:'],
    ['hooks', 'ok', '훅 울림 1339', '신호:'],
    ['hooks', 'missing', '훅 집계 스크립트 미설치', '신호:'],
    ['hooks', 'error', '훅 집계 실패', '신호:'],
  ] as const)(
    '%s 소스가 %s이면 해당 상태 문구를 표시한다',
    (name, status, expected, linePrefix) => {
      const changed = structuredClone(metrics);
      changed.sources[name] = status;
      const summary = render(changed).summary;
      const line = summary
        .split('\n')
        .find((item) => item.startsWith(linePrefix));
      expect(summary).toContain(expected);
      expect(line).toBeDefined();
      if (status !== 'ok') {
        const hiddenNumbers = {
          claude: 'Claude 토큰 412M',
          codex: 'Codex 38M',
          git: 'revert 1',
          inventory: '0회 사용 스킬 6',
          hooks: '훅 울림 1339',
        };
        expect(summary).not.toContain(hiddenNumbers[name]);
      }
    },
  );
});
