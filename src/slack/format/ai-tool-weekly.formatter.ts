import { match } from 'ts-pattern';

import {
  AiWeeklyHookCount,
  AiWeeklyMetrics,
  AiWeeklyScope,
  AiWeeklySourceStatus,
} from '../../ai-tool-weekly/domain/ai-weekly-metrics.type';
import { AiWeeklyPeriod } from '../../ai-tool-weekly/domain/ai-weekly-period';
import {
  addDaysTo,
  getKstDateOf,
  weekdayOf,
} from '../../common/util/kst-date.util';
import { FormattedReport } from './formatted-report.type';

export interface AiWeeklyPullRequestsFound {
  status: 'ok';
  company: number;
  personal: number;
  truncated: boolean;
}

export interface AiWeeklyPullRequestsFailed {
  status: 'error';
}

// dry-run 처럼 GitHub 를 부르지 않은 경우.
export interface AiWeeklyPullRequestsSkipped {
  status: 'skipped';
}

export type AiWeeklyPullRequests =
  | AiWeeklyPullRequestsFound
  | AiWeeklyPullRequestsFailed
  | AiWeeklyPullRequestsSkipped;

interface FormatInput {
  period: AiWeeklyPeriod;
  metrics: AiWeeklyMetrics;
  pullRequests: AiWeeklyPullRequests;
}

interface ResultInput {
  metrics: AiWeeklyMetrics;
  pullRequests: AiWeeklyPullRequests;
}

interface ScopeCellInput {
  metrics: AiWeeklyMetrics;
  scope: AiWeeklyScope;
}

interface ScopeRowInput {
  label: string;
  cell: (scope: AiWeeklyScope) => string;
}

interface PercentInput {
  part: number;
  total: number;
  digits: number;
}

interface ChangeInput {
  current: number;
  previous: number;
}

interface NamedSumInput {
  values: Record<string, number>;
  name: string;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const OK = AiWeeklySourceStatus.OK;

export const formatAiToolWeekly = ({
  period,
  metrics,
  pullRequests,
}: FormatInput): FormattedReport => {
  const summary = [
    formatHeading(period),
    formatResult({ metrics, pullRequests }),
    formatCost(metrics),
    formatSignal(metrics),
    formatClarify(metrics),
    formatInventory(metrics),
  ].join('\n');
  const detail = formatDetail(metrics);
  return { summary, detail };
};

const formatHeading = (period: AiWeeklyPeriod): string => {
  const start = dateLabel(getKstDateOf(period.since));
  const end = dateLabel(addDaysTo(getKstDateOf(period.until), -1));
  return `🧰 AI 도구 주간 점검 ${start}~${end}`;
};

const dateLabel = (date: string): string => {
  const [, month, day] = date.split('-');
  const weekday = WEEKDAYS[weekdayOf(date)];
  return `${month}/${day}(${weekday})`;
};

const formatResult = ({ metrics, pullRequests }: ResultInput): string => {
  const parts = [describePullRequests(pullRequests), describeReverts(metrics)];
  if (pullRequests.status === 'ok' && pullRequests.company === 0) {
    parts.push('회사 PR 0건: 조회 권한 확인 필요');
  }
  const joined = parts.join(' · ');
  return `결과: ${joined}`;
};

const describePullRequests = (pullRequests: AiWeeklyPullRequests): string => {
  const text = match(pullRequests)
    .with({ status: 'ok' }, (found) => describeFoundPullRequests(found))
    .with({ status: 'error' }, () => '머지 PR 조회 실패')
    .with({ status: 'skipped' }, () => '머지 PR (dry-run 생략)')
    .exhaustive();
  return text;
};

const describeFoundPullRequests = ({
  company,
  personal,
  truncated,
}: AiWeeklyPullRequestsFound): string => {
  const total = truncated ? '≥100' : String(company + personal);
  return `머지 PR ${total} (회사 ${company} · 개인 ${personal})`;
};

const describeReverts = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.git !== OK) {
    return 'revert 수집 실패';
  }
  return `revert ${metrics.reverts}`;
};

const formatCost = (metrics: AiWeeklyMetrics): string => {
  const claude = describeClaudeTokens(metrics);
  const codex = describeCodexTokens(metrics);
  return `비용: ${claude} · ${codex}`;
};

const describeClaudeTokens = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.claude !== OK) {
    return 'Claude 토큰 수집 실패';
  }
  const { thisWeek, prevWeek } = metrics.tokens.claude;
  const current = sumValues(thisWeek);
  const previous = sumValues(prevWeek);
  const change = formatChange({ current, previous });
  const comparison = previous === 0 ? change : `지난주 대비 ${change}`;
  const opusTokens = sumNamed({ values: thisWeek, name: 'opus' });
  const sonnetTokens = sumNamed({ values: thisWeek, name: 'sonnet' });
  const opus = percent({ part: opusTokens, total: current, digits: 0 });
  const sonnet = percent({ part: sonnetTokens, total: current, digits: 0 });
  const tokens = formatMillions(current);
  return `Claude 토큰 ${tokens} (${comparison}) · Opus ${opus} · Sonnet ${sonnet}`;
};

const describeCodexTokens = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.codex !== OK) {
    return 'Codex 수집 실패';
  }
  const { thisWeek, prevWeek, zstSkipped } = metrics.tokens.codex;
  const tokens = formatMillions(thisWeek);
  const change = formatChange({ current: thisWeek, previous: prevWeek });
  const codex = `Codex ${tokens} (${change})`;
  if (zstSkipped === 0) {
    return codex;
  }
  return `${codex} · 압축 ${zstSkipped}건 제외`;
};

const formatSignal = (metrics: AiWeeklyMetrics): string => {
  const verify = describeVerify(metrics);
  const hooks = describeHooks(metrics);
  return `신호: ${verify} · ${hooks}`;
};

const describeVerify = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.claude !== OK) {
    return '파이프 경유 수집 실패';
  }
  const { piped, total } = metrics.verify;
  const rate = percent({ part: piped, total, digits: 0 });
  return `검증 명령 파이프 경유 ${rate}`;
};

const describeHooks = (metrics: AiWeeklyMetrics): string => {
  const text = match(metrics.sources.hooks)
    .with(AiWeeklySourceStatus.OK, () =>
      describeHookTotals(metrics.hooks.hooks),
    )
    .with(AiWeeklySourceStatus.MISSING, () => '훅 집계 스크립트 미설치')
    .with(AiWeeklySourceStatus.ERROR, () => '훅 집계 실패')
    .exhaustive();
  return text;
};

const describeHookTotals = (hooks: AiWeeklyHookCount[]): string => {
  const fired = sumOf(hooks.map((hook) => hook.fired));
  const delivered = sumOf(hooks.map((hook) => hook.delivered));
  const blocked = sumOf(hooks.map((hook) => hook.blocked));
  return `훅 울림 ${fired} / 전달 ${delivered} / 차단 ${blocked} (차단은 하한값)`;
};

const formatClarify = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.claude !== OK) {
    return '이해: 수집 실패';
  }
  const { matched, humanTurns } = metrics.clarify;
  const rate = percent({ part: matched, total: humanTurns, digits: 1 });
  return `이해: 설명 재요청 ${rate} (휴리스틱)`;
};

const formatInventory = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.inventory !== OK) {
    return '정비 후보: 수집 실패';
  }
  const { skills, plugins, agents, hooks } = metrics.inventory;
  const added = skills.added + plugins.added + agents.added;
  const unused = `0회 사용 스킬 ${skills.unused.length} · 플러그인 ${plugins.unused.length}`;
  const totals = `총 스킬 ${skills.total} · 플러그인 ${plugins.total} · 훅 ${hooks.total} · 에이전트 ${agents.total}`;
  return `정비 후보: ${unused} · 이번 주 추가 ${added} (${totals})`;
};

const formatDetail = (metrics: AiWeeklyMetrics): string => {
  const lines = [
    scopeRow({ label: '범위', cell: (scope) => SCOPE_LABELS[scope] }),
    scopeRow({
      label: '토큰',
      cell: (scope) => scopeToken({ metrics, scope }),
    }),
    scopeRow({
      label: 'revert',
      cell: (scope) => scopeRevert({ metrics, scope }),
    }),
    scopeRow({
      label: '검증',
      cell: (scope) => scopeVerify({ metrics, scope }),
    }),
    scopeRow({
      label: '설명 재요청',
      cell: (scope) => scopeClarify({ metrics, scope }),
    }),
    `경로로 추정 분류한 세션 ${metrics.inferredSessions}건`,
    ...describeUnused(metrics),
  ];
  const { sources } = metrics;
  lines.push(
    `수집 상태: claude ${sources.claude} · codex ${sources.codex} · git ${sources.git} · inventory ${sources.inventory} · hooks ${sources.hooks}`,
  );
  return lines.join('\n');
};

const SCOPE_LABELS: Record<AiWeeklyScope, string> = {
  [AiWeeklyScope.COMPANY]: '회사',
  [AiWeeklyScope.PERSONAL]: '개인',
  [AiWeeklyScope.UNKNOWN]: 'unknown',
};

const scopeRow = ({ label, cell }: ScopeRowInput): string => {
  const cells = Object.values(AiWeeklyScope).map(cell);
  return [label, ...cells].join(' | ');
};

const describeUnused = (metrics: AiWeeklyMetrics): string[] => {
  if (metrics.sources.inventory !== OK) {
    return ['0회 사용 목록: 수집 실패'];
  }
  const { skills, plugins, agents } = metrics.inventory;
  return [
    `0회 사용 스킬: ${formatNames(skills.unused)}`,
    `0회 사용 플러그인: ${formatNames(plugins.unused)}`,
    `0회 사용 에이전트: ${formatNames(agents.unused)}`,
  ];
};

const scopeToken = ({ metrics, scope }: ScopeCellInput): string => {
  if (metrics.sources.claude !== OK) {
    return '수집 실패';
  }
  const count = sumValues(metrics.scopes[scope].tokens);
  return formatMillions(count);
};

const scopeRevert = ({ metrics, scope }: ScopeCellInput): string => {
  if (metrics.sources.git !== OK) {
    return '수집 실패';
  }
  return String(metrics.scopes[scope].reverts);
};

const scopeVerify = ({ metrics, scope }: ScopeCellInput): string => {
  if (metrics.sources.claude !== OK) {
    return '수집 실패';
  }
  const { piped, total } = metrics.scopes[scope].verify;
  return `${piped}/${total}`;
};

const scopeClarify = ({ metrics, scope }: ScopeCellInput): string => {
  if (metrics.sources.claude !== OK) {
    return '수집 실패';
  }
  const { matched, humanTurns } = metrics.scopes[scope].clarify;
  return `${matched}/${humanTurns}`;
};

const sumValues = (values: Record<string, number>): number =>
  sumOf(Object.values(values));

const sumNamed = ({ values, name }: NamedSumInput): number => {
  const matched = Object.entries(values).filter(([model]) =>
    model.toLowerCase().includes(name),
  );
  const counts = matched.map(([, count]) => count);
  return sumOf(counts);
};

const sumOf = (numbers: number[]): number => {
  const total = numbers.reduce((sum, value) => sum + value, 0);
  return total;
};

const percent = ({ part, total, digits }: PercentInput): string => {
  const ratio = total === 0 ? 0 : (part / total) * 100;
  const fixed = ratio.toFixed(digits);
  return `${fixed}%`;
};

const formatMillions = (count: number): string => {
  const millions = Math.round(count / 1_000_000);
  return `${millions}M`;
};

const formatChange = ({ current, previous }: ChangeInput): string => {
  if (previous === 0) {
    return '지난주 데이터 없음';
  }
  const rate = Math.round(((current - previous) / previous) * 100);
  const sign = rate > 0 ? '+' : '';
  return `${sign}${rate}%`;
};

const formatNames = (names: string[]): string => {
  if (names.length === 0) {
    return '없음';
  }
  return names.join(', ');
};
