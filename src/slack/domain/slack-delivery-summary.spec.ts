import { SlackDeliveryStatRow } from './port/slack-delivery.repository.port';
import {
  clampDeliveryListLimit,
  clampDeliveryWindowDays,
  summarizeDeliveries,
} from './slack-delivery-summary';

const row = (
  values: Partial<SlackDeliveryStatRow> = {},
): SlackDeliveryStatRow => ({
  kind: 'autopilot:weekly-summary',
  itemKinds: [],
  threadTs: null,
  status: 'SENT',
  suppressReason: null,
  reactionCount: 0,
  replyCount: 0,
  ...values,
});

describe('summarizeDeliveries', () => {
  it('counts statuses, fans out item kinds, and only sums reactions on sent rows', () => {
    const summary = summarizeDeliveries(
      [
        row({
          kind: 'digest',
          itemKinds: ['taskB', 'taskA'],
          reactionCount: 2,
        }),
        row({ kind: 'digest', itemKinds: ['taskA'], replyCount: 1 }),
        row({ kind: 'plain', itemKinds: [], reactionCount: 1 }),
        row({
          kind: 'digest',
          itemKinds: ['taskA'],
          status: 'SUPPRESSED',
          suppressReason: 'CONSOLE_ROUTE',
          reactionCount: 9,
        }),
        row({ status: 'SUPPRESSED', suppressReason: 'EMPTY', replyCount: 7 }),
        row({ status: 'FAILED', reactionCount: 8 }),
      ],
      { days: 14 },
    );

    expect(summary.totals).toEqual({
      sent: 3,
      threadDetailSent: 0,
      suppressedConsoleRoute: 1,
      suppressedEmpty: 1,
      failed: 1,
      reactionCount: 3,
      replyCount: 1,
      reactedSentCount: 3,
    });
    expect(summary.byKind.map(({ key, sent }) => ({ key, sent }))).toEqual([
      { key: 'digest', sent: 2 },
      { key: 'plain', sent: 1 },
      { key: 'autopilot:weekly-summary', sent: 0 },
    ]);
    expect(summary.byItemKind.map(({ key, sent }) => ({ key, sent }))).toEqual([
      { key: 'taskA', sent: 2 },
      { key: 'plain', sent: 1 },
      { key: 'taskB', sent: 1 },
      { key: 'autopilot:weekly-summary', sent: 0 },
    ]);
    expect(summary.byItemKind.find(({ key }) => key === 'taskA')).toMatchObject(
      {
        suppressedConsoleRoute: 1,
        reactionCount: 2,
        replyCount: 1,
      },
    );
    expect(summary.note).toContain(
      '반응·답글이 없다고 안 읽었다는 증거는 아니다',
    );
  });

  it('flags cleanup candidates only after 14 days and 10 sent messages without reactions or replies', () => {
    const tenSent = Array.from({ length: 10 }, () => row({ kind: 'quiet' }));
    expect(
      summarizeDeliveries(tenSent, { days: 14 }).byKind[0].cleanupCandidate,
    ).toBe(true);
    expect(
      summarizeDeliveries(tenSent, { days: 13 }).byKind[0].cleanupCandidate,
    ).toBe(false);
    expect(
      summarizeDeliveries(tenSent.slice(1), { days: 14 }).byKind[0]
        .cleanupCandidate,
    ).toBe(false);
    expect(
      summarizeDeliveries(
        [...tenSent.slice(1), row({ kind: 'quiet', replyCount: 1 })],
        {
          days: 14,
        },
      ).byKind[0].cleanupCandidate,
    ).toBe(false);
  });

  it('counts a main message plus its thread details as one sent message', () => {
    const summary = summarizeDeliveries(
      [
        row({ kind: 'autopilot:evening' }),
        row({ kind: 'autopilot:evening', threadTs: '1.0' }),
        row({ kind: 'autopilot:evening', threadTs: '1.0' }),
      ],
      { days: 14 },
    );

    expect(summary.totals.sent).toBe(1);
    expect(summary.totals.threadDetailSent).toBe(2);
    expect(summary.byKind[0]).toMatchObject({ sent: 1, threadDetailSent: 2 });
  });

  it('adds reactions and replies on thread details to the group sums', () => {
    const summary = summarizeDeliveries(
      [
        row({ kind: 'autopilot:evening' }),
        row({
          kind: 'autopilot:evening',
          threadTs: '1.0',
          reactionCount: 1,
          replyCount: 1,
        }),
      ],
      { days: 14 },
    );

    expect(summary.byKind[0]).toMatchObject({
      sent: 1,
      reactionCount: 1,
      replyCount: 1,
      reactedSentCount: 0,
    });
  });
});

describe('delivery query clamps', () => {
  it('keeps integer values within the configured bounds', () => {
    expect(clampDeliveryWindowDays(-3)).toBe(1);
    expect(clampDeliveryWindowDays(14.9)).toBe(14);
    expect(clampDeliveryWindowDays(100)).toBe(90);
    expect(clampDeliveryListLimit(0)).toBe(1);
    expect(clampDeliveryListLimit(50.9)).toBe(50);
    expect(clampDeliveryListLimit(300)).toBe(200);
  });
});
