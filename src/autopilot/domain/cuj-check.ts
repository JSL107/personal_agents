import { PaperRecommendationSkipReason } from '../../agent/paper-recommend/domain/paper-recommendation.type';
import { formatKstDate } from '../../common/util/kst-date.util';
import {
  HolidayCalendar,
  isKrxTradingDay,
} from '../../holiday/domain/business-calendar';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  CujDeliveryRow,
  CujMentionReceiptRow,
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
  // 멘션 수신 기록을 판정하기 전 기다리는 시간. 블로그 결과 답장은 Hermes 상한(hermes-cli.runner.ts
  // HERMES_TIMEOUT_MS 12분) 뒤에 나갈 수 있어, 장시간 기한(10분)으로 끊으면 정상 진행을 미응답으로 센다.
  mentionReceiptGraceMs: 1_200_000,
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

export const detectPrReviewViolations = (
  rows: CujRunRow[],
  unpostedFindings: number,
): CujViolation[] => {
  const failed = rows.filter((row) => row.status === 'FAILED').length;
  const parts: string[] = [];
  if (failed >= CUJ_THRESHOLDS.prFailures) {
    parts.push(`실패 ${failed}건 / 전체 ${rows.length}건`);
  }
  // 게시 실패는 한 건이라도 사람이 리뷰를 못 받은 것이라 임계값 없이 알린다.
  if (unpostedFindings > 0) {
    parts.push(`게시 안 된 지적 ${unpostedFindings}건`);
  }
  if (parts.length === 0) {
    return [];
  }
  return violation(1, 'PR 리뷰', parts.join(' · '));
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

const SKIP_REASON_LABELS: Record<PaperRecommendationSkipReason, string> = {
  ALREADY_HELD: '이미 보유',
  NOT_IN_CANDIDATES: '후보 밖 종목',
  ZERO_WEIGHT: '비중 0',
  INSUFFICIENT_CASH: '현금 부족',
  BUY_LIMIT_REACHED: '매수 건수 상한',
  NOT_HELD: '보유하지 않은 종목 매도',
  PENDING_ORDER_EXISTS: '대기 주문 중복',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const skipReasonOf = (skip: unknown): string =>
  isRecord(skip) && typeof skip.reason === 'string'
    ? skip.reason
    : '알 수 없음';

// 회차 하나의 시세 날짜와 0건 사유를 판정한다. 근거가 없으면(필드가 없는 #819 이전 output,
// 모르는 사유 코드) 경보하지 않는다 — 지어낸 경보보다 침묵이 낫다.
// 사유 코드의 의미는 paper-recommendation-empty-reason.ts 가 정한다.
const paperRunProblems = (output: unknown, yesterday: string): string[] => {
  if (!isRecord(output)) {
    return [];
  }
  const problems: string[] = [];
  // 거래일 19:30 회차는 그날 종가를 본다. 날짜가 어긋나면 주문 수와 상관없이 낡은 시세로
  // 판단한 것이다. null 은 시세 자체가 없는 경우(NO_MARKET_DATA)다.
  if ('dataAsOf' in output && output.dataAsOf !== yesterday) {
    problems.push(
      output.dataAsOf === null
        ? '시세 없음'
        : `시세가 ${String(output.dataAsOf)} 기준에 멈춤`,
    );
  }
  if (output.ordersCreated !== 0 || !isRecord(output.emptyReason)) {
    return problems;
  }
  const code = output.emptyReason.code;
  if (code === 'NO_CANDIDATES') {
    problems.push('후보도 보유 종목도 없어 주문 0건 (원인 미상)');
  }
  if (code === 'ALL_FILTERED' && Array.isArray(output.skipped)) {
    // 대기 주문과 겹친 종목을 뺀 것은 중복 주문 방지라 정상이다. 그 주문이 오래 남는 문제는
    // 아래 미종결 주문 검사가 따로 잡는다.
    const reasons = new Set(output.skipped.map(skipReasonOf));
    reasons.delete('PENDING_ORDER_EXISTS');
    if (output.skipped.length === 0) {
      problems.push('제안이 모두 걸렸다는데 걸린 기록이 없음');
    } else if (reasons.size > 0) {
      const labels = [...reasons].map(
        (reason) =>
          SKIP_REASON_LABELS[reason as PaperRecommendationSkipReason] ?? reason,
      );
      problems.push(`제안이 모두 제약에 걸려 주문 0건 (${labels.join(', ')})`);
    }
  }
  // MODEL_HELD 는 모델의 관망 판단이라 정상이다. holdReason 이 비는 회차의 경보는 실측을
  // 본 뒤 정한다(2026-10-14 기준 실측 0건).
  return problems;
};

export const detectPaperInvestmentViolations = (
  runs: CujRunRow[],
  orders: CujOrderRow[],
  yesterday: string,
  calendar: HolidayCalendar,
): CujViolation[] => {
  const parts: string[] = [];
  const tradeDate = new Date(`${yesterday}T00:00:00.000Z`);
  // 휴장일에도 추천이 도는 날이 있지만 그날의 낡은 시세·0건은 장애가 아니므로 거래일만 본다.
  if (isKrxTradingDay(tradeDate, calendar)) {
    const succeeded = runs.filter((row) => row.status === 'SUCCEEDED');
    for (const [strategy, label] of PAPER_STRATEGY_LABELS) {
      // 재시도로 성공이 여럿이면 실제로 반영된 마지막 회차만 본다.
      const latest = succeeded
        .filter((row) => strategyOf(row.output) === strategy)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
      if (latest === undefined) {
        parts.push(`${label} 추천 실행 없음`);
        continue;
      }
      for (const problem of paperRunProblems(latest.output, yesterday)) {
        parts.push(`${label} ${problem}`);
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

// receipts 는 받은 지 mentionReceiptGraceMs 가 지난 멘션만 담아야 한다 — 그 안의 RECEIVED 는 아직
// 처리 중일 수 있다. 기한이 지나도 RECEIVED 면 처리 도중 프로세스가 죽었거나 멈춘 것이다.
export const detectMentionViolations = (
  rows: CujRunRow[],
  receipts: CujMentionReceiptRow[],
): CujViolation[] => {
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
  // 결과 답장(BLOG)이 대기·실패로 남은 멘션도 답이 안 나간 것이다 — ack 만 받고 결과를 못 받았다.
  const unanswered = receipts.filter(
    (row) =>
      row.status === 'RECEIVED' ||
      row.status === 'REPLY_FAILED' ||
      row.finalReplyStatus === 'PENDING' ||
      row.finalReplyStatus === 'FAILED',
  ).length;
  // 처리 실패 안내만 나간 멘션. 워커 실행 실패와 겹칠 수 있지만, 라우터 앞에서 끊겨 agent_run 이
  // 없는 실패는 여기서만 보인다.
  const errorReplied = receipts.filter(
    (row) => row.status === 'ERROR_REPLIED',
  ).length;
  const parts = [
    [failed, `실패 ${failed}건`],
    [late, `지연 ${late}건`],
    [unanswered, `답 안 나감 ${unanswered}건`],
    [errorReplied, `오류 답변 ${errorReplied}건`],
  ] as const;
  const details = parts.filter(([count]) => count > 0).map(([, text]) => text);
  if (details.length === 0) {
    return [];
  }
  return violation(5, '멘션 대화', details.join(' · '));
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
