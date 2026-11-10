import { AiWeeklyMetrics } from '../../ai-tool-weekly/domain/ai-weekly-metrics.type';
import { AiWeeklyPeriod } from '../../ai-tool-weekly/domain/ai-weekly-period';
import { FormattedReport } from './formatted-report.type';

export type AiWeeklyPullRequests =
  | { status: 'ok'; company: number; personal: number; truncated: boolean }
  | { status: 'error' }
  | { status: 'skipped' };

type FormatInput = {
  period: AiWeeklyPeriod;
  metrics: AiWeeklyMetrics;
  pullRequests: AiWeeklyPullRequests;
};

export const formatAiToolWeekly = ({
  period,
  metrics,
  pullRequests,
}: FormatInput): FormattedReport => {
  const summary = [
    formatHeading(period),
    formatResult(metrics, pullRequests),
    formatCost(metrics),
    formatSignal(metrics),
    formatClarify(metrics),
    formatInventory(metrics),
  ].join('\n');
  const detail = formatDetail(metrics);
  return { summary, detail };
};

const formatHeading = (period: AiWeeklyPeriod): string => {
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const start = new Date(period.since.getTime() + 9 * 60 * 60 * 1000);
  const end = new Date(
    period.until.getTime() - 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000,
  );
  const dateLabel = (date: Date): string => {
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${month}/${day}(${weekdays[date.getUTCDay()]})`;
  };
  return `🧰 AI 도구 주간 점검 ${dateLabel(start)}~${dateLabel(end)}`;
};

const formatResult = (
  metrics: AiWeeklyMetrics,
  pullRequests: AiWeeklyPullRequests,
): string => {
  let prText = '머지 PR (dry-run 생략)';
  if (pullRequests.status === 'error') {
    prText = '머지 PR 조회 실패';
  }
  if (pullRequests.status === 'ok') {
    const total = pullRequests.company + pullRequests.personal;
    const count = pullRequests.truncated ? '≥100' : String(total);
    prText = `머지 PR ${count} (회사 ${pullRequests.company} · 개인 ${pullRequests.personal})`;
  }
  const revertText =
    metrics.sources.git === 'ok'
      ? `revert ${metrics.reverts}`
      : 'revert 수집 실패';
  let result = `결과: ${prText} · ${revertText}`;
  if (pullRequests.status === 'ok' && pullRequests.company === 0) {
    result += ' · 회사 PR 0건: 조회 권한 확인 필요';
  }
  return result;
};

const formatCost = (metrics: AiWeeklyMetrics): string => {
  const parts: string[] = [];
  if (metrics.sources.claude === 'ok') {
    const current = sumValues(metrics.tokens.claude.thisWeek);
    const previous = sumValues(metrics.tokens.claude.prevWeek);
    const change = formatChange(current, previous);
    const opus = sumNamed(metrics.tokens.claude.thisWeek, 'opus');
    const sonnet = sumNamed(metrics.tokens.claude.thisWeek, 'sonnet');
    const comparison = previous === 0 ? change : `지난주 대비 ${change}`;
    parts.push(
      `Claude 토큰 ${formatMillions(current)} (${comparison}) · Opus ${percent(opus, current, 0)} · Sonnet ${percent(sonnet, current, 0)}`,
    );
  } else {
    parts.push('Claude 토큰 수집 실패');
  }
  if (metrics.sources.codex === 'ok') {
    const { thisWeek, prevWeek, zstSkipped } = metrics.tokens.codex;
    let codex = `Codex ${formatMillions(thisWeek)} (${formatChange(thisWeek, prevWeek)})`;
    if (zstSkipped > 0) {
      codex += ` · 압축 ${zstSkipped}건 제외`;
    }
    parts.push(codex);
  } else {
    parts.push('Codex 수집 실패');
  }
  return `비용: ${parts.join(' · ')}`;
};

const formatSignal = (metrics: AiWeeklyMetrics): string => {
  const verify =
    metrics.sources.claude === 'ok'
      ? `검증 명령 파이프 경유 ${percent(metrics.verify.piped, metrics.verify.total, 0)}`
      : '파이프 경유 수집 실패';
  let hooks = '훅 집계 실패';
  if (metrics.sources.hooks === 'missing') {
    hooks = '훅 집계 스크립트 미설치';
  }
  if (metrics.sources.hooks === 'ok') {
    const totals = metrics.hooks.hooks.reduce(
      (total, item) => ({
        fired: total.fired + item.fired,
        delivered: total.delivered + item.delivered,
        blocked: total.blocked + item.blocked,
      }),
      { fired: 0, delivered: 0, blocked: 0 },
    );
    hooks = `훅 울림 ${totals.fired} / 전달 ${totals.delivered} / 차단 ${totals.blocked} (차단은 하한값)`;
  }
  return `신호: ${verify} · ${hooks}`;
};

const formatClarify = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.claude !== 'ok') {
    return '이해: 수집 실패';
  }
  const rate = percent(metrics.clarify.matched, metrics.clarify.humanTurns, 1);
  return `이해: 설명 재요청 ${rate} (휴리스틱)`;
};

const formatInventory = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.inventory !== 'ok') {
    return '정비 후보: 수집 실패';
  }
  const { skills, plugins, agents, hooks } = metrics.inventory;
  const added = skills.added + plugins.added + agents.added;
  return `정비 후보: 0회 사용 스킬 ${skills.unused.length} · 플러그인 ${plugins.unused.length} · 이번 주 추가 ${added} (총 스킬 ${skills.total} · 플러그인 ${plugins.total} · 훅 ${hooks.total} · 에이전트 ${agents.total})`;
};

const formatDetail = (metrics: AiWeeklyMetrics): string => {
  const lines = [
    '범위 | 회사 | 개인 | unknown',
    `토큰 | ${scopeToken(metrics, 'company')} | ${scopeToken(metrics, 'personal')} | ${scopeToken(metrics, 'unknown')}`,
    `revert | ${scopeRevert(metrics, 'company')} | ${scopeRevert(metrics, 'personal')} | ${scopeRevert(metrics, 'unknown')}`,
    `검증 | ${scopeVerify(metrics, 'company')} | ${scopeVerify(metrics, 'personal')} | ${scopeVerify(metrics, 'unknown')}`,
    `설명 재요청 | ${scopeClarify(metrics, 'company')} | ${scopeClarify(metrics, 'personal')} | ${scopeClarify(metrics, 'unknown')}`,
    `경로로 추정 분류한 세션 ${metrics.inferredSessions}건`,
  ];
  if (metrics.sources.inventory === 'ok') {
    lines.push(
      `0회 사용 스킬: ${formatNames(metrics.inventory.skills.unused)}`,
    );
    lines.push(
      `0회 사용 플러그인: ${formatNames(metrics.inventory.plugins.unused)}`,
    );
    lines.push(
      `0회 사용 에이전트: ${formatNames(metrics.inventory.agents.unused)}`,
    );
  } else {
    lines.push('0회 사용 목록: 수집 실패');
  }
  const { sources } = metrics;
  lines.push(
    `수집 상태: claude ${sources.claude} · codex ${sources.codex} · git ${sources.git} · inventory ${sources.inventory} · hooks ${sources.hooks}`,
  );
  return lines.join('\n');
};

const scopeToken = (
  metrics: AiWeeklyMetrics,
  scope: keyof AiWeeklyMetrics['scopes'],
): string => {
  if (metrics.sources.claude !== 'ok') {
    return '수집 실패';
  }
  const count = sumValues(metrics.scopes[scope].tokens);
  return formatMillions(count);
};

const scopeRevert = (
  metrics: AiWeeklyMetrics,
  scope: keyof AiWeeklyMetrics['scopes'],
): string => {
  if (metrics.sources.git !== 'ok') {
    return '수집 실패';
  }
  return String(metrics.scopes[scope].reverts);
};

const scopeVerify = (
  metrics: AiWeeklyMetrics,
  scope: keyof AiWeeklyMetrics['scopes'],
): string => {
  if (metrics.sources.claude !== 'ok') {
    return '수집 실패';
  }
  const value = metrics.scopes[scope].verify;
  return `${value.piped}/${value.total}`;
};

const scopeClarify = (
  metrics: AiWeeklyMetrics,
  scope: keyof AiWeeklyMetrics['scopes'],
): string => {
  if (metrics.sources.claude !== 'ok') {
    return '수집 실패';
  }
  const value = metrics.scopes[scope].clarify;
  return `${value.matched}/${value.humanTurns}`;
};

const sumValues = (values: Record<string, number>): number =>
  Object.values(values).reduce((sum, value) => sum + value, 0);

const sumNamed = (values: Record<string, number>, name: string): number =>
  Object.entries(values)
    .filter(([model]) => model.toLowerCase().includes(name))
    .reduce((sum, [, count]) => sum + count, 0);

const percent = (part: number, total: number, digits: number): string => {
  if (total === 0) {
    return `${(0).toFixed(digits)}%`;
  }
  return `${((part / total) * 100).toFixed(digits)}%`;
};

const formatMillions = (count: number): string =>
  `${Math.round(count / 1_000_000)}M`;

const formatChange = (current: number, previous: number): string => {
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
