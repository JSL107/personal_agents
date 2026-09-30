import { RecentPlanSummary } from './prompt/recent-plan-summary-formatter';
import {
  computeConsecutiveDaysById,
  computeStaleTaskIds,
} from './stale-task.util';

const summary = (
  date: string,
  taskIds: string[],
  agentRunId: number,
): RecentPlanSummary => ({
  date,
  taskIds,
  stalledTaskIds: [],
  taskTitleById: {},
  topPriorityTitle: `top-${date}`,
  estimatedHours: 5,
  criticalPathCount: 0,
  agentRunId,
});

describe('stale-task.util', () => {
  it('최근일부터 끊기지 않고 등장한 id 별 연속 일수를 계산한다', () => {
    const result = computeConsecutiveDaysById(
      [
        summary('2026-07-07', ['a', 'b'], 3),
        summary('2026-07-06', ['a'], 2),
        summary('2026-07-05', ['a', 'b'], 1),
      ],
      null,
    );

    expect(result.get('a')).toBe(3);
    expect(result.get('b')).toBe(1);
  });

  it('입력이 날짜 내림차순이 아니어도 내부 정렬 후 계산한다', () => {
    const result = computeConsecutiveDaysById(
      [
        summary('2026-07-05', ['a'], 1),
        summary('2026-07-07', ['a'], 3),
        summary('2026-07-06', ['a'], 2),
      ],
      null,
    );

    expect(result.get('a')).toBe(3);
  });

  it('중간에 등장하지 않은 id 는 그 지점에서 연속 일수가 끊긴다', () => {
    const result = computeConsecutiveDaysById(
      [
        summary('2026-07-07', ['a'], 3),
        summary('2026-07-06', ['b'], 2),
        summary('2026-07-05', ['a'], 1),
      ],
      null,
    );

    expect(result.get('a')).toBe(1);
    expect(result.get('b')).toBeUndefined();
  });

  it('구버전 summary 처럼 taskIds 가 없으면 빈 id 목록으로 취급한다', () => {
    const legacy = {
      date: '2026-07-07',
      topPriorityTitle: 'legacy',
      estimatedHours: 5,
      criticalPathCount: 0,
      agentRunId: 1,
    } as RecentPlanSummary;

    expect(computeConsecutiveDaysById([legacy], null).size).toBe(0);
  });

  it('thresholdDays - 1 만큼 최근 plan 에 연속 등장한 id 를 stale 후보로 반환한다', () => {
    const result = computeStaleTaskIds(
      [
        summary('2026-07-07', ['a', 'b'], 3),
        summary('2026-07-06', ['a'], 2),
        summary('2026-07-05', ['a', 'b'], 1),
      ],
      3,
      null,
    );

    expect([...result]).toEqual(['a']);
  });

  it('thresholdDays 가 1 이하이면 stale 후보를 만들지 않는다', () => {
    expect(
      computeStaleTaskIds([summary('2026-07-07', ['a'], 1)], 1, null).size,
    ).toBe(0);
  });

  it('빈 입력이면 빈 결과를 반환한다', () => {
    expect(computeConsecutiveDaysById([], null).size).toBe(0);
    expect(computeStaleTaskIds([], 5, null).size).toBe(0);
  });

  describe('강등 뒤에도 정체 일수를 이어 센다', () => {
    const pr52 = 'owner/pup#52';
    const day = (
      date: string,
      scheduled: string[],
      stalled: string[] = [],
    ) => ({
      ...summary(date, scheduled, 1),
      stalledTaskIds: stalled,
    });
    // 2026-09 원장의 모양 — 5일째 강등돼 stalledTasks 로 갔다가 다음 날 다시 계획에 올랐다.
    const history = [
      day('2026-09-12', [pr52]),
      day('2026-09-11', [pr52]),
      day('2026-09-10', [], [pr52]),
      day('2026-09-09', [pr52]),
      day('2026-09-08', [pr52]),
      day('2026-09-07', [pr52]),
      day('2026-09-06', [pr52]),
      day('2026-09-05', [pr52]),
      day('2026-09-04', [pr52]),
      day('2026-09-03', [pr52]),
    ];

    it('오늘도 열려 있는 GitHub 작업은 강등된 날을 건너뛰지 않고 7일 창 너머까지 센다', () => {
      const result = computeConsecutiveDaysById(history, new Set([pr52]));

      expect(result.get(pr52)).toBe(10);
      expect(computeStaleTaskIds(history, 5, new Set([pr52]))).toEqual(
        new Set([pr52]),
      );
    });

    it('오늘 목록에서 닫힌 작업은 이어 세지도 정체로 올리지도 않는다', () => {
      expect(computeConsecutiveDaysById(history, new Set()).get(pr52)).toBe(
        undefined,
      );
      const stalledOnly = [day('2026-09-12', [], [pr52]), ...history.slice(1)];
      expect(computeStaleTaskIds(stalledOnly, 2, new Set()).size).toBe(0);
    });

    it('어제까지 일정에 있다 오늘 닫힌 작업도 정체로 올리지 않는다', () => {
      const scheduledOnly = ['12', '11', '10', '09', '08'].map((date) =>
        day(`2026-09-${date}`, [pr52]),
      );

      expect(computeStaleTaskIds(scheduledOnly, 5, new Set()).size).toBe(0);
      expect(computeStaleTaskIds(scheduledOnly, 5, new Set([pr52]))).toEqual(
        new Set([pr52]),
      );
    });

    it('GitHub 조회에 실패한 날(null)은 닫혔다고 단정하지 않고 이어 센다', () => {
      expect(computeConsecutiveDaysById(history, null).get(pr52)).toBe(10);
    });
  });

  it('순번 id(rollover:, user:)는 날마다 다른 작업이라 연속으로 세지 않는다', () => {
    const result = computeStaleTaskIds(
      ['07', '06', '05', '04', '03'].map((date, index) =>
        summary(`2026-07-${date}`, ['rollover:1', 'user:1', 'r/a#1'], index),
      ),
      5,
      null,
    );

    expect(result).toEqual(new Set(['r/a#1']));
  });

  it('같은 날 여러 번 돈 plan 은 하루로 센다', () => {
    const result = computeConsecutiveDaysById(
      [
        summary('2026-07-07', ['a'], 3),
        summary('2026-07-07', ['a'], 2),
        summary('2026-07-06', ['a'], 1),
      ],
      null,
    );

    expect(result.get('a')).toBe(2);
  });
});
