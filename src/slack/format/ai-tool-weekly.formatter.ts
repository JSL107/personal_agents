import { match } from 'ts-pattern';

import {
  AiWeeklyHookCount,
  AiWeeklyMetrics,
  AiWeeklyScope,
  AiWeeklySource,
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

interface ScopeRow {
  label: string;
  cell: (scope: AiWeeklyScope) => string;
}

interface RatioInput {
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

interface PadInput {
  text: string;
  width: number;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const OK = AiWeeklySourceStatus.OK;
const HUNDRED_MILLION = 100_000_000;
const TEN_THOUSAND = 10_000;
const TABLE_LABEL_WIDTH = 14;
const TABLE_CELL_WIDTH = 11;

const SCOPE_LABELS: Record<AiWeeklyScope, string> = {
  [AiWeeklyScope.COMPANY]: '회사',
  [AiWeeklyScope.PERSONAL]: '개인',
  [AiWeeklyScope.UNKNOWN]: '분류 못 함',
};

const SOURCE_LABELS: Record<AiWeeklySource, string> = {
  [AiWeeklySource.CLAUDE]: 'Claude 세션',
  [AiWeeklySource.CODEX]: 'Codex 세션',
  [AiWeeklySource.GIT]: 'git',
  [AiWeeklySource.INVENTORY]: '설치 목록',
  [AiWeeklySource.HOOKS]: '훅 집계',
};

export const formatAiToolWeekly = ({
  period,
  metrics,
  pullRequests,
}: FormatInput): FormattedReport => {
  const summary = [
    formatHeading(period),
    formatResult({ metrics, pullRequests }),
    formatTokens(metrics),
    formatHabits(metrics),
    formatInventory(metrics),
  ].join('\n\n');
  const detail = formatDetail(metrics);
  return { summary, detail };
};

const formatHeading = (period: AiWeeklyPeriod): string => {
  const start = dateLabel(getKstDateOf(period.since));
  const end = dateLabel(addDaysTo(getKstDateOf(period.until), -1));
  return `🧰 *AI 도구 주간 점검* · ${start} ~ ${end}`;
};

const dateLabel = (date: string): string => {
  const [, month, day] = date.split('-');
  const weekday = WEEKDAYS[weekdayOf(date)];
  return `${Number(month)}/${Number(day)}(${weekday})`;
};

const section = (title: string, lines: string[]): string => {
  const bullets = lines.map((line) => `• ${line}`);
  return [`*${title}*`, ...bullets].join('\n');
};

const formatResult = ({ metrics, pullRequests }: ResultInput): string => {
  const lines = [describePullRequests(pullRequests), describeReverts(metrics)];
  if (pullRequests.status === 'ok' && pullRequests.company === 0) {
    lines.push('⚠️ 회사 PR이 0건입니다. 조회 권한을 확인해 주세요');
  }
  return section('📦 이번 주 결과', lines);
};

const describePullRequests = (pullRequests: AiWeeklyPullRequests): string => {
  const text = match(pullRequests)
    .with({ status: 'ok' }, (found) => describeFoundPullRequests(found))
    .with({ status: 'error' }, () => '머지한 PR 조회 실패')
    .with({ status: 'skipped' }, () => '머지한 PR (미리보기라 조회 안 함)')
    .exhaustive();
  return text;
};

const describeFoundPullRequests = ({
  company,
  personal,
  truncated,
}: AiWeeklyPullRequestsFound): string => {
  const total = truncated ? '100건 이상' : `${company + personal}건`;
  return `머지한 PR ${total} (회사 ${company} · 개인 ${personal})`;
};

const describeReverts = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.git !== OK) {
    return '되돌린 커밋 수집 실패';
  }
  return `되돌린 커밋 ${metrics.reverts}건`;
};

const formatTokens = (metrics: AiWeeklyMetrics): string =>
  section('💰 토큰 사용량', [
    describeClaudeTokens(metrics),
    describeCodexTokens(metrics),
  ]);

const describeClaudeTokens = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.claude !== OK) {
    return 'Claude 토큰 수집 실패';
  }
  const { thisWeek, prevWeek } = metrics.tokens.claude;
  const current = sumValues(thisWeek);
  const change = describeChange({ current, previous: sumValues(prevWeek) });
  const opusTokens = sumNamed({ values: thisWeek, name: 'opus' });
  const sonnetTokens = sumNamed({ values: thisWeek, name: 'sonnet' });
  const opus = ratio({ part: opusTokens, total: current, digits: 0 });
  const sonnet = ratio({ part: sonnetTokens, total: current, digits: 0 });
  const tokens = formatTokenCount(current);
  return `Claude ${tokens} (${change}) · Opus ${opus} · Sonnet ${sonnet}`;
};

const describeCodexTokens = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.codex !== OK) {
    return 'Codex 토큰 수집 실패';
  }
  const { thisWeek, prevWeek, zstSkipped } = metrics.tokens.codex;
  const tokens = formatTokenCount(thisWeek);
  const change = describeChange({ current: thisWeek, previous: prevWeek });
  const codex = `Codex ${tokens} (${change})`;
  if (zstSkipped === 0) {
    return codex;
  }
  return `${codex} · 압축 파일 ${zstSkipped}개 제외`;
};

const formatHabits = (metrics: AiWeeklyMetrics): string =>
  section('🚦 작업 습관', [
    describeVerify(metrics),
    describeHooks(metrics),
    describeClarify(metrics),
  ]);

const describeVerify = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.claude !== OK) {
    return '검증 명령 기록 수집 실패';
  }
  const { piped, total } = metrics.verify;
  if (total === 0) {
    return '검증 명령 실행 기록 없음';
  }
  const rate = ratio({ part: piped, total, digits: 0 });
  return `검증 명령의 ${rate}가 파이프 뒤에서 실행됨 (실패를 놓칠 수 있음)`;
};

const describeHooks = (metrics: AiWeeklyMetrics): string => {
  const text = match(metrics.sources.hooks)
    .with(AiWeeklySourceStatus.OK, () =>
      describeHookTotals(metrics.hooks.hooks),
    )
    .with(AiWeeklySourceStatus.MISSING, () => '훅 집계 스크립트가 없어 생략')
    .with(AiWeeklySourceStatus.ERROR, () => '훅 기록 수집 실패')
    .exhaustive();
  return text;
};

const describeHookTotals = (hooks: AiWeeklyHookCount[]): string => {
  const fired = formatCount(sumOf(hooks.map((hook) => hook.fired)));
  const delivered = formatCount(sumOf(hooks.map((hook) => hook.delivered)));
  const blocked = formatCount(sumOf(hooks.map((hook) => hook.blocked)));
  return `훅 ${fired}번 울림 → ${delivered}번 전달 · 차단 ${blocked} (차단은 최소치)`;
};

const describeClarify = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.claude !== OK) {
    return '설명 재요청 비율 수집 실패';
  }
  const { matched, humanTurns } = metrics.clarify;
  const rate = ratio({ part: matched, total: humanTurns, digits: 1 });
  return `설명을 다시 요청한 비율 ${rate} (추정치)`;
};

const formatInventory = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.inventory !== OK) {
    return section('🧹 정리 후보', ['설치 목록 수집 실패']);
  }
  const { skills, plugins, agents } = metrics.inventory;
  const unused = `스킬 ${skills.unused.length}개 · 플러그인 ${plugins.unused.length}개 · 에이전트 ${agents.unused.length}개`;
  const lines = [`한 주 동안 안 쓴 ${unused} (목록은 스레드)`];
  const added = skills.added + plugins.added + agents.added;
  if (added > 0) {
    lines.push(`이번 주 새로 들인 것 ${added}개`);
  }
  return section('🧹 정리 후보', lines);
};

const formatDetail = (metrics: AiWeeklyMetrics): string => {
  const parts = [
    formatScopeTable(metrics),
    formatUnused(metrics),
    `_작업 경로로 추정해 분류한 세션 ${formatCount(metrics.inferredSessions)}건_`,
  ];
  const failures = describeSourceFailures(metrics);
  if (failures) {
    parts.push(failures);
  }
  return parts.join('\n\n');
};

// Slack 기본 글꼴은 글자 폭이 달라 표가 틀어진다. 코드 블록(고정폭)에 넣고 한글은 두 칸으로 센다.
const formatScopeTable = (metrics: AiWeeklyMetrics): string => {
  const rows: ScopeRow[] = [
    { label: '', cell: (scope) => SCOPE_LABELS[scope] },
    { label: '토큰', cell: (scope) => scopeToken({ metrics, scope }) },
    { label: '되돌린 커밋', cell: (scope) => scopeRevert({ metrics, scope }) },
    { label: '파이프 경유', cell: (scope) => scopeVerify({ metrics, scope }) },
    { label: '설명 재요청', cell: (scope) => scopeClarify({ metrics, scope }) },
  ];
  const lines = rows.map(({ label, cell }) => {
    const head = padDisplay({ text: label, width: TABLE_LABEL_WIDTH });
    const cells = Object.values(AiWeeklyScope).map((scope) =>
      padDisplay({ text: cell(scope), width: TABLE_CELL_WIDTH }),
    );
    const line = [head, ...cells].join('');
    return line.trimEnd();
  });
  const table = lines.join('\n');
  return [
    '*회사·개인 나눠 보기* (토큰은 Claude+Codex)',
    '```',
    table,
    '```',
  ].join('\n');
};

const formatUnused = (metrics: AiWeeklyMetrics): string => {
  if (metrics.sources.inventory !== OK) {
    return '*한 주 동안 안 쓴 것*\n• 설치 목록 수집 실패';
  }
  const { skills, plugins, agents } = metrics.inventory;
  return section('한 주 동안 안 쓴 것', [
    `스킬: ${formatNames(skills.unused)}`,
    `플러그인: ${formatNames(plugins.unused)}`,
    `에이전트: ${formatNames(agents.unused)}`,
  ]);
};

// 모두 정상이면 아무것도 붙이지 않는다. 실패한 소스만 이름과 상태로 알린다.
const describeSourceFailures = (metrics: AiWeeklyMetrics): string | null => {
  const failed = Object.values(AiWeeklySource)
    .filter((source) => metrics.sources[source] !== OK)
    .map((source) => {
      const status =
        metrics.sources[source] === AiWeeklySourceStatus.MISSING
          ? '없음'
          : '실패';
      return `${SOURCE_LABELS[source]} ${status}`;
    });
  if (failed.length === 0) {
    return null;
  }
  const joined = failed.join(' · ');
  return `⚠️ 일부 기록을 읽지 못함: ${joined}`;
};

// Claude·Codex 합계라 둘 중 하나라도 읽다 실패하면 합계를 보이지 않는다. Codex 미설치(missing)는 0 으로 본다.
const scopeToken = ({ metrics, scope }: ScopeCellInput): string => {
  const { claude, codex } = metrics.sources;
  if (claude !== OK || codex === AiWeeklySourceStatus.ERROR) {
    return '수집 실패';
  }
  const count = sumValues(metrics.scopes[scope].tokens);
  return formatTokenCount(count);
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
  return scopeRatio({ part: piped, total, digits: 0 });
};

const scopeClarify = ({ metrics, scope }: ScopeCellInput): string => {
  if (metrics.sources.claude !== OK) {
    return '수집 실패';
  }
  const { matched, humanTurns } = metrics.scopes[scope].clarify;
  return scopeRatio({ part: matched, total: humanTurns, digits: 1 });
};

const scopeRatio = ({ part, total, digits }: RatioInput): string => {
  if (total === 0) {
    return '-';
  }
  return ratio({ part, total, digits });
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

const ratio = ({ part, total, digits }: RatioInput): string => {
  const value = total === 0 ? 0 : (part / total) * 100;
  const fixed = value.toFixed(digits);
  return `${fixed}%`;
};

const formatCount = (count: number): string => count.toLocaleString('ko-KR');

// 억 이상은 소수 첫째 자리 억, 그 아래는 만 단위로 쓴다(4,925,000,000 → 49.3억, 38,000,000 → 3,800만).
const formatTokenCount = (count: number): string => {
  if (count >= HUNDRED_MILLION) {
    const value = (count / HUNDRED_MILLION).toFixed(1).replace(/\.0$/, '');
    return `${value}억`;
  }
  if (count >= TEN_THOUSAND) {
    const value = formatCount(Math.round(count / TEN_THOUSAND));
    return `${value}만`;
  }
  return formatCount(count);
};

const describeChange = ({ current, previous }: ChangeInput): string => {
  if (previous === 0) {
    return '지난주 기록 없음';
  }
  if (current >= previous * 2) {
    const times = (current / previous).toFixed(1);
    return `지난주보다 ${times}배`;
  }
  const rate = Math.round(((current - previous) / previous) * 100);
  if (rate === 0) {
    return '지난주와 비슷함';
  }
  const direction = rate > 0 ? '늘어남' : '줄어듦';
  return `지난주보다 ${Math.abs(rate)}% ${direction}`;
};

const formatNames = (names: string[]): string => {
  if (names.length === 0) {
    return '없음';
  }
  return names.join(', ');
};

const padDisplay = ({ text, width }: PadInput): string => {
  const gap = Math.max(1, width - displayWidth(text));
  const padding = ' '.repeat(gap);
  return `${text}${padding}`;
};

// 고정폭 글꼴에서 한글은 두 칸을 차지한다.
const WIDE_CHARACTER = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/;

const displayWidth = (text: string): number => {
  const width = [...text].reduce(
    (sum, character) => sum + (WIDE_CHARACTER.test(character) ? 2 : 1),
    0,
  );
  return width;
};
