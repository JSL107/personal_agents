import { ContextSummary } from '../../agent/pm/application/sync-context.usecase';
import { formatContextSummary } from './context-summary.formatter';

const summary: ContextSummary = {
  github: { fetchSucceeded: true, issueCount: 3, pullRequestCount: 1 },
  notion: { taskCount: 2 },
  slack: { mentionCount: 5, sinceHours: 24 },
  previousPlan: { agentRunId: 99, endedAt: '2026-04-26T10:00:00.000Z' },
  previousWorklog: { agentRunId: 100, endedAt: '2026-04-26T11:00:00.000Z' },
};

describe('formatContextSummary', () => {
  it('직전 실행의 날짜를 적고 번호만 있는 실행 식별자는 숨긴다', () => {
    const text = formatContextSummary(summary);
    expect(text).toContain('*직전 오늘 계획*: 2026-04-26');
    expect(text).toContain('*직전 업무 정리*: 2026-04-26');
    expect(text).not.toMatch(/#99|#100/);
  });
});
