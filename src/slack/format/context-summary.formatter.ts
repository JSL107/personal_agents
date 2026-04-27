import { ContextSummary } from '../../agent/pm/application/sync-context.usecase';

// /sync-context 결과 — 컨텍스트 재수집 상태 요약을 한국어 Slack 마크다운으로 렌더.
// 모델 호출이 없으므로 formatModelFooter 는 붙이지 않는다 (HOTFIX-1).
export const formatContextSummary = (summary: ContextSummary): string => {
  const githubLine = summary.github.fetchSucceeded
    ? `✅ Issue ${summary.github.issueCount}건 / PR ${summary.github.pullRequestCount}건`
    : `⚠ 수집 실패 (GITHUB_TOKEN 또는 권한 확인)`;

  const lines: string[] = [
    '*컨텍스트 재수집 결과*',
    '',
    `*GitHub*: ${githubLine}`,
    `*Notion*: 활성 task ${summary.notion.taskCount}건`,
    `*Slack*: 본인 멘션 ${summary.slack.mentionCount}건 (최근 ${summary.slack.sinceHours}h)`,
    '',
    summary.previousPlan
      ? `*직전 PM 실행*: #${summary.previousPlan.agentRunId} (${summary.previousPlan.endedAt.slice(0, 10)})`
      : '*직전 PM 실행*: 없음',
    summary.previousWorklog
      ? `*직전 Work Reviewer 실행*: #${summary.previousWorklog.agentRunId} (${summary.previousWorklog.endedAt.slice(0, 10)})`
      : '*직전 Work Reviewer 실행*: 없음',
  ];

  return lines.join('\n');
};
