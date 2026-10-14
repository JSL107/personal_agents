import { formatKstDate } from '../../common/util/kst-date.util';
import {
  HolidayCalendar,
  isKrxTradingDay,
} from '../../holiday/domain/business-calendar';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  CujDeliveryRow,
  CujOrderRow,
  CujPreviewRow,
  CujRunRow,
} from './port/cuj-ledger.reader.port';

export interface CujViolation {
  cuj: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  detail: string;
}

export const CUJ_THRESHOLDS = {
  prFailures: 3,
  mentionDeadlineMs: 60_000,
  longMentionDeadlineMs: 600_000,
  morningDeadlineHour: 9,
  eveningDeadlineHour: 21,
} as const;

export const CUJ_LONG_AGENT_TYPES: ReadonlySet<string> = new Set([
  AgentType.CAREER_MATE,
  AgentType.BLOG,
  AgentType.VIDEO_WATCH,
  AgentType.CODE_REVIEWER,
]);

const violation = (
  cuj: CujViolation['cuj'],
  title: string,
  detail: string,
): CujViolation[] => [{ cuj, title, detail }];

const kstHour = (date: Date): number =>
  date.getUTCHours() + 9 < 24
    ? date.getUTCHours() + 9
    : date.getUTCHours() - 15;

const kstTime = (date: Date): string =>
  `${String(kstHour(date)).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;

const onDateByDeadline = (date: Date, day: string, hour: number): boolean =>
  formatKstDate(date.toISOString()) === day &&
  kstHour(date) <= hour &&
  (kstHour(date) < hour ||
    (date.getUTCMinutes() === 0 &&
      date.getUTCSeconds() === 0 &&
      date.getUTCMilliseconds() === 0));

export const detectPrReviewViolations = (rows: CujRunRow[]): CujViolation[] => {
  const failed = rows.filter((row) => row.status === 'FAILED').length;
  if (failed < CUJ_THRESHOLDS.prFailures) {
    return [];
  }
  return violation(1, 'PR 리뷰', `실패 ${failed}건 / 전체 ${rows.length}건`);
};

export const detectMorningBriefingViolations = (
  rows: CujDeliveryRow[],
  today: string,
): CujViolation[] => {
  const relevant = rows.filter((row) =>
    row.itemKinds.includes('morning-briefing'),
  );
  const sent = relevant.filter((row) => row.status === 'SENT');
  if (
    sent.some((row) =>
      onDateByDeadline(
        row.createdAt,
        today,
        CUJ_THRESHOLDS.morningDeadlineHour,
      ),
    )
  ) {
    return [];
  }
  const late = sent.sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  )[0];
  const failure = relevant.find(
    (row) => row.status === 'FAILED' && row.errorMessage,
  );
  const detail = late
    ? `늦게 도착 ${kstTime(late.createdAt)}`
    : '09:00까지 도착 안 함';
  const error = failure?.errorMessage
    ? ` · ${failure.errorMessage.slice(0, 100)}`
    : '';
  return violation(2, '아침 브리핑', `${detail}${error}`);
};

export const detectEveningReviewViolations = (
  rows: CujDeliveryRow[],
  yesterday: string,
): CujViolation[] => {
  const required = ['work-reviewer', 'daily-eval', 'evening-retro-publish'];
  // 콘솔 보고서 탭과 같은 이름 — 경보를 읽고 어느 화면을 열지 바로 알 수 있게.
  const labels: Record<string, string> = {
    'work-reviewer': '업무 회고',
    'daily-eval': '일일 평가',
    'evening-retro-publish': '퇴근 회고 발행',
  };
  const missing = required.filter(
    (kind) =>
      !rows.some(
        (row) =>
          row.itemKinds.includes(kind) &&
          (row.status === 'SENT' ||
            (row.status === 'SUPPRESSED' &&
              row.suppressReason === 'CONSOLE_ROUTE')) &&
          onDateByDeadline(
            row.createdAt,
            yesterday,
            CUJ_THRESHOLDS.eveningDeadlineHour,
          ),
      ),
  );
  if (missing.length === 0) {
    return [];
  }
  return violation(
    3,
    '퇴근 회고·평가',
    `21:00까지 도착 안 함: ${missing.map((kind) => labels[kind]).join(', ')}`,
  );
};

// 경보는 사람이 읽으므로 전략 코드 대신 화면에서 쓰는 이름으로 적는다.
const PAPER_STRATEGY_LABELS: ReadonlyArray<[string, string]> = [
  ['LONG_TERM', '장기투자'],
  ['SWING', '스윙'],
];

const strategyOf = (output: unknown): string | null => {
  if (
    typeof output !== 'object' ||
    output === null ||
    !('strategy' in output)
  ) {
    return null;
  }
  return typeof output.strategy === 'string' ? output.strategy : null;
};

export const detectPaperInvestmentViolations = (
  runs: CujRunRow[],
  orders: CujOrderRow[],
  yesterday: string,
  calendar: HolidayCalendar,
): CujViolation[] => {
  const parts: string[] = [];
  const tradeDate = new Date(`${yesterday}T00:00:00.000Z`);
  if (isKrxTradingDay(tradeDate, calendar)) {
    const succeeded = runs.filter((row) => row.status === 'SUCCEEDED');
    for (const [strategy, label] of PAPER_STRATEGY_LABELS) {
      if (!succeeded.some((row) => strategyOf(row.output) === strategy)) {
        parts.push(`${label} 추천 실행 없음`);
      }
    }
  }
  if (orders.length > 0) {
    parts.push(`미종결 주문 ${orders.length}건`);
  }
  if (parts.length === 0) {
    return [];
  }
  return violation(4, '모의투자', parts.join(' · '));
};

export const detectMentionViolations = (rows: CujRunRow[]): CujViolation[] => {
  const failed = rows.filter((row) => row.status === 'FAILED').length;
  const late = rows.filter(
    (row) =>
      row.status === 'SUCCEEDED' &&
      row.durationMs !== null &&
      row.durationMs >
        (CUJ_LONG_AGENT_TYPES.has(row.agentType)
          ? CUJ_THRESHOLDS.longMentionDeadlineMs
          : CUJ_THRESHOLDS.mentionDeadlineMs),
  ).length;
  if (failed === 0 && late === 0) {
    return [];
  }
  return violation(5, '멘션 대화', `실패 ${failed}건 · 지연 ${late}건`);
};

export const detectApprovalViolations = (
  rows: CujPreviewRow[],
): CujViolation[] => {
  if (rows.length === 0) {
    return [];
  }
  const kinds = [...new Set(rows.map((row) => row.kind))].join(', ');
  return violation(
    6,
    '승인 반영',
    `반영 실패 ${rows.length}건 (kind ${kinds})`,
  );
};
