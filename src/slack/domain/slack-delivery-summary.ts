import { SlackDeliveryStatRow } from './port/slack-delivery.repository.port';

const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 90;
const MIN_LIST_LIMIT = 1;
const MAX_LIST_LIMIT = 200;
const CLEANUP_MIN_DAYS = 14;
const CLEANUP_MIN_SENT = 10;

export const SLACK_DELIVERY_SUMMARY_NOTE =
  '반응·답글이 없다고 안 읽었다는 증거는 아니다. 클릭은 Slack 이 알려 주지 않아 세지 못한다. 합쳐진 다이제스트의 반응은 그 안의 모든 종류에 똑같이 더해진다.';

// sent·reactedSentCount 는 본문 메시지만 센다. 오케스트레이터가 상세를 같은 kind 의 스레드
// 댓글로 붙이므로(autopilot.orchestrator.ts) 댓글까지 세면 발송 1건이 1+N건으로 부풀고 정리 후보
// 문턱(sent >= 10)에 일찍 닿는다. 댓글은 threadDetailSent 로 따로 세고, 댓글에 달린 반응·답글은
// reactionCount·replyCount 에 그대로 더한다.
export type SlackDeliveryCounts = {
  sent: number;
  threadDetailSent: number;
  suppressedConsoleRoute: number;
  suppressedEmpty: number;
  failed: number;
  reactionCount: number;
  replyCount: number;
  reactedSentCount: number;
};

export type SlackDeliveryGroup = SlackDeliveryCounts & {
  key: string;
  cleanupCandidate: boolean;
};

export type SlackDeliverySummary = {
  days: number;
  note: string;
  totals: SlackDeliveryCounts;
  byKind: SlackDeliveryGroup[];
  byItemKind: SlackDeliveryGroup[];
};

export type SlackDeliverySummaryOptions = {
  days: number;
};

export const clampDeliveryWindowDays = (value: number): number =>
  clampInteger(value, MIN_WINDOW_DAYS, MAX_WINDOW_DAYS);

export const clampDeliveryListLimit = (value: number): number =>
  clampInteger(value, MIN_LIST_LIMIT, MAX_LIST_LIMIT);

export const summarizeDeliveries = (
  rows: SlackDeliveryStatRow[],
  { days }: SlackDeliverySummaryOptions,
): SlackDeliverySummary => {
  const totals = emptyCounts();
  const byKind = new Map<string, SlackDeliveryCounts>();
  const byItemKind = new Map<string, SlackDeliveryCounts>();

  for (const row of rows) {
    addRow(totals, row);
    addRow(getCounts(byKind, row.kind), row);
    const itemKinds = row.itemKinds.length > 0 ? row.itemKinds : [row.kind];
    for (const itemKind of itemKinds) {
      addRow(getCounts(byItemKind, itemKind), row);
    }
  }

  return {
    days,
    note: SLACK_DELIVERY_SUMMARY_NOTE,
    totals,
    byKind: toGroups(byKind, days),
    byItemKind: toGroups(byItemKind, days),
  };
};

const clampInteger = (
  value: number,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
};

const emptyCounts = (): SlackDeliveryCounts => ({
  sent: 0,
  threadDetailSent: 0,
  suppressedConsoleRoute: 0,
  suppressedEmpty: 0,
  failed: 0,
  reactionCount: 0,
  replyCount: 0,
  reactedSentCount: 0,
});

const getCounts = (
  groups: Map<string, SlackDeliveryCounts>,
  key: string,
): SlackDeliveryCounts => {
  const counts = groups.get(key);
  if (counts) {
    return counts;
  }
  const created = emptyCounts();
  groups.set(key, created);
  return created;
};

const addRow = (
  counts: SlackDeliveryCounts,
  row: SlackDeliveryStatRow,
): void => {
  if (row.status === 'SENT') {
    counts.reactionCount += row.reactionCount;
    counts.replyCount += row.replyCount;
    if (row.threadTs) {
      counts.threadDetailSent += 1;
      return;
    }
    counts.sent += 1;
    if (row.reactionCount > 0 || row.replyCount > 0) {
      counts.reactedSentCount += 1;
    }
  } else if (row.status === 'SUPPRESSED') {
    if (row.suppressReason === 'CONSOLE_ROUTE') {
      counts.suppressedConsoleRoute += 1;
    } else if (row.suppressReason === 'EMPTY') {
      counts.suppressedEmpty += 1;
    }
  } else if (row.status === 'FAILED') {
    counts.failed += 1;
  }
};

const toGroups = (
  groups: Map<string, SlackDeliveryCounts>,
  days: number,
): SlackDeliveryGroup[] => {
  const result = Array.from(groups, ([key, counts]) => ({
    key,
    ...counts,
    cleanupCandidate:
      days >= CLEANUP_MIN_DAYS &&
      counts.sent >= CLEANUP_MIN_SENT &&
      counts.reactionCount === 0 &&
      counts.replyCount === 0,
  }));
  result.sort(
    (left, right) =>
      right.sent - left.sent || left.key.localeCompare(right.key),
  );
  return result;
};
