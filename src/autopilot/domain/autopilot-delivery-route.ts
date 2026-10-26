export type AutopilotDeliveryRoute = 'slack' | 'console';

// task 성격이 아닌 발송 정책이다. 콘솔 경로는 Slack 에 게시하지 않고 전문을 slack_delivery
// 원장에 보관한다. owner 가 2026-10-07 확정: docs/superpowers/plans/2026-10-07-slack-delivery-gate.md
//
// 2026-10-12 아침 한 통(docs/superpowers/plans/2026-10-08-daily-message-direction.md §3-1): 비서실·
// 공부(적용 판정 요약·딥다이브)·포트폴리오 발행·공고 수집·갭 분석은 콘솔로 보내고, 그 결과를
// 아침 morning-briefing 이 원장에서 읽어 한 줄씩 싣는다. 적용 판정의 승인 카드는 경로와 무관하게 나간다.
//
// 같은 날 저녁 마감 한 통(§3-2): worklog(work-reviewer)·Daily Eval·모의투자 추천·체결 결과는 콘솔로 보내고,
// evening-retro-publish 가 머지 건수·회고 Keep·체결·내일 예정을 한 줄씩 싣는다. 회고 전문은 그 스레드에 있다.
//
// 2026-10-14 주간 보고(knowledge-lint·blog-revision-report)도 콘솔로 보낸다. 원장에 전문이 남고,
// knowledge-lint 의 중복 정리(onDelivered)는 orchestrator 가 원장 기록 직후에 부른다.
// 일요일 ceo-meta task 는 같은 날 폐지했다 — 금요일 weekly-summary 가 같은 CEO 주간 회고를 Slack 으로 낸다.
export const AUTOPILOT_DELIVERY_ROUTE: Readonly<
  Record<string, AutopilotDeliveryRoute>
> = {
  'idea-triage': 'console',
  'work-reviewer': 'console',
  'daily-eval': 'console',
  'evening-retro-publish': 'slack',
  'blog-github-publish': 'slack',
  'study-applicability': 'console',
  'study-deepdive': 'console',
  secretariat: 'console',
  'morning-briefing': 'slack',
  'po-shadow': 'slack',
  'weekly-summary': 'slack',
  'impact-report': 'slack',
  'run-retro': 'console',
  'cuj-check': 'slack',
  'blog-revision-report': 'console',
  'humanize-research': 'slack',
  'run-sweeper': 'console',
  'preview-sweeper': 'console',
  'ops-supervisor': 'console',
  'stock-monitor': 'slack',
  'paper-trading': 'slack',
  'universe-sweep': 'console',
  'paper-recommend': 'console',
  'paper-order-fill': 'console',
  'paper-intraday-stop': 'slack',
  'paper-score': 'slack',
  'stock-alert-scoring': 'console',
  'screening-outcome-scoring': 'console',
  'screening-scorecard': 'console',
  'stock-monitor-us': 'slack',
  'memory-vacuum': 'console',
  'holiday-sync': 'console',
  'knowledge-lint': 'console',
  'docs-sync-audit': 'console',
  'preference-learning': 'slack',
  'pr-review-sweep': 'console',
  'ai-cli-env-snapshot': 'console',
  'ai-cli-env-apply': 'slack',
  'portfolio-warmup': 'slack',
  'portfolio-publish': 'console',
  'job-feed': 'console',
  'job-feed-gap': 'console',
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
