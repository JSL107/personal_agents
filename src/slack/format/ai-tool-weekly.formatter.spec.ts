import {
  AiWeeklyMetrics,
  AiWeeklySourceStatus,
} from '../../ai-tool-weekly/domain/ai-weekly-metrics.type';
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
    claude: AiWeeklySourceStatus.OK,
    codex: AiWeeklySourceStatus.OK,
    git: AiWeeklySourceStatus.OK,
    inventory: AiWeeklySourceStatus.OK,
    hooks: AiWeeklySourceStatus.OK,
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
  it('정상 지표를 구획별 요약으로 표시한다', () => {
    const result = render();
    expect(result.summary).toBe(
      [
        '🧰 *AI 도구 주간 점검* · 11/2(월) ~ 11/8(일)',
        '',
        '*📦 이번 주 결과*',
        '• 머지한 PR 23건 (회사 15 · 개인 8)',
        '• 되돌린 커밋 1건',
        '',
        '*💰 토큰 사용량*',
        '• Claude 4.1억 (지난주보다 8% 줄어듦) · Opus 61% · Sonnet 30%',
        '• Codex 3,800만 (지난주보다 3% 줄어듦)',
        '',
        '*🚦 작업 습관*',
        '• 검증 명령의 84%가 파이프 뒤에서 실행됨 (실패를 놓칠 수 있음)',
        '• 훅 1,339번 울림 → 11번 전달 · 차단 12 (차단은 최소치)',
        '• 설명을 다시 요청한 비율 4.1% (추정치)',
        '',
        '*🧹 정리 후보*',
        '• 한 주 동안 안 쓴 스킬 6개 · 플러그인 2개 · 에이전트 0개 (목록은 스레드)',
        '• 이번 주 새로 들인 것 3개',
      ].join('\n'),
    );
  });

  it('스레드에 고정폭 범위 표와 안 쓴 목록을 붙이고 정상이면 수집 상태를 생략한다', () => {
    const { detail } = render();
    expect(detail).toContain(
      [
        '```',
        '              회사       개인       분류 못 함',
        '토큰          0          0          0',
        '되돌린 커밋   1          0          0',
        '파이프 경유   84%        84%        -',
        '설명 재요청   4.0%       4.3%       -',
        '```',
      ].join('\n'),
    );
    expect(detail).toContain('• 스킬: skill-a, skill-b');
    expect(detail).toContain('• 에이전트: 없음');
    expect(detail).toContain('_작업 경로로 추정해 분류한 세션 3건_');
    expect(detail).not.toContain('일부 기록을 읽지 못함');
  });

  it.each([
    [
      { status: 'ok', company: 0, personal: 100, truncated: true },
      '• 머지한 PR 100건 이상 (회사 0 · 개인 100)',
    ],
    [
      { status: 'ok', company: 0, personal: 3, truncated: false },
      '조회 권한을 확인해 주세요',
    ],
    [{ status: 'error' }, '• 머지한 PR 조회 실패'],
    [{ status: 'skipped' }, '• 머지한 PR (미리보기라 조회 안 함)'],
  ] as const)('PR 상태 %o에 맞춰 결과를 표시한다', (prs, expected) => {
    expect(render(metrics, prs).summary).toContain(expected);
  });

  it('범위별 토큰은 Claude·Codex 합계이고 Codex 수집이 실패하면 숨긴다', () => {
    const changed = structuredClone(metrics);
    changed.scopes.company.tokens = {
      'claude-opus-4-6': 2_000_000_000,
      codex: 260_000_000,
    };
    expect(render(changed).detail).toContain('토큰          22.6억');
    changed.sources.codex = AiWeeklySourceStatus.ERROR;
    expect(render(changed).detail).toContain(
      '토큰          수집 실패  수집 실패  수집 실패',
    );
  });

  it.each([
    [{ current: 412, previous: 0 }, '지난주 기록 없음'],
    [{ current: 412, previous: 100 }, '지난주보다 4.1배'],
    [{ current: 100, previous: 100 }, '지난주와 비슷함'],
    [{ current: 108, previous: 100 }, '지난주보다 8% 늘어남'],
  ])('지난주 대비 %o 를 %s 로 표시한다', ({ current, previous }, expected) => {
    const changed = structuredClone(metrics);
    changed.tokens.codex.thisWeek = current * 1_000_000;
    changed.tokens.codex.prevWeek = previous * 1_000_000;
    expect(render(changed).summary).toContain(expected);
  });

  it('검증 명령 기록이 0건이면 비율 대신 기록 없음을 표시한다', () => {
    const changed = structuredClone(metrics);
    changed.verify = { total: 0, piped: 0 };
    const { summary } = render(changed);
    expect(summary).toContain('• 검증 명령 실행 기록 없음');
    expect(summary).not.toContain('파이프 뒤에서 실행됨');
  });

  it('이번 주 새로 들인 것이 없으면 그 줄을 생략한다', () => {
    const changed = structuredClone(metrics);
    changed.inventory.plugins.added = 0;
    const { summary } = render(changed);
    expect(summary).toContain('• 한 주 동안 안 쓴 스킬 6개');
    expect(summary).not.toContain('새로 들인 것');
  });

  it('압축 파일을 건너뛰면 그 수를 표시한다', () => {
    const changed = structuredClone(metrics);
    changed.tokens.codex.zstSkipped = 2;
    expect(render(changed).summary).toContain('압축 파일 2개 제외');
  });

  it.each([
    [
      'claude',
      AiWeeklySourceStatus.MISSING,
      'Claude 토큰 수집 실패',
      'Claude 4.1억',
      'Claude 세션 없음',
    ],
    [
      'claude',
      AiWeeklySourceStatus.ERROR,
      '설명 재요청 비율 수집 실패',
      '4.1% (추정치)',
      'Claude 세션 실패',
    ],
    [
      'codex',
      AiWeeklySourceStatus.ERROR,
      'Codex 토큰 수집 실패',
      'Codex 3,800만',
      'Codex 세션 실패',
    ],
    [
      'git',
      AiWeeklySourceStatus.ERROR,
      '되돌린 커밋 수집 실패',
      '되돌린 커밋 1건',
      'git 실패',
    ],
    [
      'inventory',
      AiWeeklySourceStatus.MISSING,
      '설치 목록 수집 실패',
      '안 쓴 스킬 6개',
      '설치 목록 없음',
    ],
    [
      'hooks',
      AiWeeklySourceStatus.MISSING,
      '훅 집계 스크립트가 없어 생략',
      '1,339번',
      '훅 집계 없음',
    ],
    [
      'hooks',
      AiWeeklySourceStatus.ERROR,
      '훅 기록 수집 실패',
      '1,339번',
      '훅 집계 실패',
    ],
  ] as const)(
    '%s 소스가 %s이면 숫자를 숨기고 실패를 알린다',
    (name, status, expected, hidden, failure) => {
      const changed = structuredClone(metrics);
      changed.sources[name] = status;
      const { summary, detail } = render(changed);
      expect(summary).toContain(expected);
      expect(summary).not.toContain(hidden);
      expect(detail).toContain(`⚠️ 일부 기록을 읽지 못함: ${failure}`);
    },
  );
});
