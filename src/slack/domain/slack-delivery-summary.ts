import { match } from 'ts-pattern';

import {
  SlackDeliveryActivityRow,
  SlackDeliveryStatRow,
} from './port/slack-delivery.repository.port';

const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 90;
const MIN_LIST_LIMIT = 1;
const MAX_LIST_LIMIT = 200;
const CLEANUP_MIN_DAYS = 14;
const CLEANUP_MIN_SENT = 10;
// 버튼으로 응답받는 카드. 클릭은 Slack 이 알려 주지 않아 반응·답글이 0 인 것이 정상이므로
// "보내도 아무도 안 보는 종류" 로 정리 후보에 올리지 않는다(승인율은 preview_action 등 각자의 원장이 잰다).
const BUTTON_CARD_KINDS: ReadonlySet<string> = new Set([
  'preview-card',
  'subconscious-proposal',
]);

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

// 종류별 마지막 발송. 최신 N건 목록은 잦은 종류(PR 리뷰 스윕·콘솔 전환)가 한도를 채워 하루 두 번
// 오는 원화 공고 같은 종류를 밀어낸다(2026-11-05 run 11600 — 24시간 41건 중 최신 10건에 공고 없음).
// 본문만 세고(스레드 상세 댓글 제외) 묶음 발송은 itemKinds 로 나눈다 — summarizeDeliveries 와 같은 규칙.
// 보낼 것 없이 끝난 회차(SUPPRESSED/EMPTY)도 마지막 시각을 둔다 — 없으면 "새 공고가 없었다" 와 "수집이
// 안 돌았다" 를 가를 수 없다.
export type LatestDeliveryByKind = {
  key: string;
  lastSentAt: Date | null;
  recentSent: number;
  lastConsoleRouteAt: Date | null;
  recentConsoleRoute: number;
  lastEmptyAt: Date | null;
};

export const summarizeLatestDeliveries = ({
  rows,
  recentSince,
}: {
  rows: readonly SlackDeliveryActivityRow[];
  recentSince: Date;
}): LatestDeliveryByKind[] => {
  const groups = new Map<string, LatestDeliveryByKind>();
  for (const row of rows) {
    const isSent = row.status === 'SENT';
    const isConsoleRoute =
      row.status === 'SUPPRESSED' && row.suppressReason === 'CONSOLE_ROUTE';
    const isEmpty =
      row.status === 'SUPPRESSED' && row.suppressReason === 'EMPTY';
    const isCounted = isSent || isConsoleRoute || isEmpty;
    if (row.threadTs || !isCounted) {
      continue;
    }
    const isRecent = row.createdAt >= recentSince;
    const itemKinds = row.itemKinds.length > 0 ? row.itemKinds : [row.kind];
    for (const key of itemKinds) {
      const group = groups.get(key) ?? {
        key,
        lastSentAt: null,
        recentSent: 0,
        lastConsoleRouteAt: null,
        recentConsoleRoute: 0,
        lastEmptyAt: null,
      };
      groups.set(key, group);
      if (isSent) {
        group.lastSentAt = laterOf({
          current: group.lastSentAt,
          candidate: row.createdAt,
        });
        group.recentSent += isRecent ? 1 : 0;
      } else if (isEmpty) {
        group.lastEmptyAt = laterOf({
          current: group.lastEmptyAt,
          candidate: row.createdAt,
        });
      } else {
        group.lastConsoleRouteAt = laterOf({
          current: group.lastConsoleRouteAt,
          candidate: row.createdAt,
        });
        group.recentConsoleRoute += isRecent ? 1 : 0;
      }
    }
  }
  return [...groups.values()].sort(
    (left, right) => lastActivityMs(right) - lastActivityMs(left),
  );
};

// 원장 상태값을 그대로 실으면 답에 `SUPPRESSED` 가 노출되고, 콘솔로 돌린 발송을 "발송된 게 아니야" 로
// 잘못 전한다(2026-11-16 run 12931). 종류별 마지막 발송 블록과 같은 말로 옮긴다.
export const describeDeliveryStatus = ({
  status,
  suppressReason,
}: {
  status: string;
  suppressReason?: string | null;
}): string => {
  const label = match({ status, suppressReason })
    .with({ status: 'SENT' }, () => 'Slack 발송')
    .with({ status: 'FAILED' }, () => '발송 실패')
    .with({ suppressReason: 'CONSOLE_ROUTE' }, () => '콘솔로 돌림')
    .with({ suppressReason: 'EMPTY' }, () => '보낼 내용 없어 생략')
    .otherwise(() => '보내지 않음');
  return label;
};

const laterOf = ({
  current,
  candidate,
}: {
  current: Date | null;
  candidate: Date;
}): Date => (current && current >= candidate ? current : candidate);

const lastActivityMs = (group: LatestDeliveryByKind): number =>
  Math.max(
    group.lastSentAt?.getTime() ?? 0,
    group.lastConsoleRouteAt?.getTime() ?? 0,
    group.lastEmptyAt?.getTime() ?? 0,
  );

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
      !BUTTON_CARD_KINDS.has(key) &&
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
