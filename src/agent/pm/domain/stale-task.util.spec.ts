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
  topPriorityTitle: `top-${date}`,
  estimatedHours: 5,
  criticalPathCount: 0,
  agentRunId,
});

describe('stale-task.util', () => {
  it('최근일부터 끊기지 않고 등장한 id 별 연속 일수를 계산한다', () => {
    const result = computeConsecutiveDaysById([
      summary('2026-07-07', ['a', 'b'], 3),
      summary('2026-07-06', ['a'], 2),
      summary('2026-07-05', ['a', 'b'], 1),
    ]);

    expect(result.get('a')).toBe(3);
    expect(result.get('b')).toBe(1);
  });

  it('입력이 날짜 내림차순이 아니어도 내부 정렬 후 계산한다', () => {
    const result = computeConsecutiveDaysById([
      summary('2026-07-05', ['a'], 1),
      summary('2026-07-07', ['a'], 3),
      summary('2026-07-06', ['a'], 2),
    ]);

    expect(result.get('a')).toBe(3);
  });

  it('중간에 등장하지 않은 id 는 그 지점에서 연속 일수가 끊긴다', () => {
    const result = computeConsecutiveDaysById([
      summary('2026-07-07', ['a'], 3),
      summary('2026-07-06', ['b'], 2),
      summary('2026-07-05', ['a'], 1),
    ]);

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

    expect(computeConsecutiveDaysById([legacy]).size).toBe(0);
  });

  it('thresholdDays - 1 만큼 최근 plan 에 연속 등장한 id 를 stale 후보로 반환한다', () => {
    const result = computeStaleTaskIds(
      [
        summary('2026-07-07', ['a', 'b'], 3),
        summary('2026-07-06', ['a'], 2),
        summary('2026-07-05', ['a', 'b'], 1),
      ],
      3,
    );

    expect([...result]).toEqual(['a']);
  });

  it('thresholdDays 가 1 이하이면 stale 후보를 만들지 않는다', () => {
    expect(computeStaleTaskIds([summary('2026-07-07', ['a'], 1)], 1).size).toBe(
      0,
    );
  });

  it('빈 입력이면 빈 결과를 반환한다', () => {
    expect(computeConsecutiveDaysById([]).size).toBe(0);
    expect(computeStaleTaskIds([], 5).size).toBe(0);
  });
});
