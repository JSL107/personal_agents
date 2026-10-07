export type AutopilotDeliveryRoute = 'slack' | 'console';

// task 성격이 아닌 발송 정책이다. 콘솔 경로는 Slack 에 게시하지 않고 전문을 slack_delivery
// 원장에 보관한다. owner 가 2026-10-07 확정: docs/superpowers/plans/2026-10-07-slack-delivery-gate.md
export const AUTOPILOT_DELIVERY_ROUTE: Readonly<
  Record<string, AutopilotDeliveryRoute>
> = {
  'work-reviewer': 'slack',
  'daily-eval': 'slack',
  'evening-retro-publish': 'slack',
  'blog-github-publish': 'slack',
  'study-applicability': 'slack',
  'study-deepdive': 'slack',
  secretariat: 'slack',
  'morning-briefing': 'slack',
  'po-shadow': 'slack',
  'weekly-summary': 'slack',
  'ceo-meta': 'slack',
  'impact-report': 'slack',
  'run-retro': 'console',
  'blog-revision-report': 'slack',
  'run-sweeper': 'console',
  'preview-sweeper': 'console',
  'ops-supervisor': 'console',
  'stock-monitor': 'slack',
  'paper-trading': 'slack',
  'universe-sweep': 'console',
  'paper-recommend': 'slack',
  'paper-order-fill': 'slack',
  'paper-intraday-stop': 'slack',
  'paper-score': 'slack',
  'stock-alert-scoring': 'console',
  'screening-outcome-scoring': 'console',
  'screening-scorecard': 'console',
  'stock-monitor-us': 'slack',
  'memory-vacuum': 'console',
  'holiday-sync': 'console',
  'knowledge-lint': 'slack',
  'docs-sync-audit': 'console',
  'preference-learning': 'slack',
  'pr-review-sweep': 'console',
  'ai-cli-env-snapshot': 'console',
  'ai-cli-env-apply': 'slack',
  'portfolio-warmup': 'slack',
  'portfolio-publish': 'slack',
  'job-feed': 'slack',
  'job-feed-gap': 'slack',
};

export const resolveAutopilotDeliveryRoute = (
  taskId: string,
): AutopilotDeliveryRoute => {
  const route = AUTOPILOT_DELIVERY_ROUTE[taskId];
  if (!route) {
    throw new Error(`Autopilot: 발송 경로 미등록 — taskId=${taskId}`);
  }
  return route;
};
