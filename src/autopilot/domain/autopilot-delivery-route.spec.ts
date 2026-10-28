import { AUTOPILOT_PLAYBOOK } from './autopilot.playbook';
import {
  AUTOPILOT_DELIVERY_ROUTE,
  resolveAutopilotDeliveryRoute,
} from './autopilot-delivery-route';

describe('AUTOPILOT_DELIVERY_ROUTE', () => {
  const consoleTaskIds = [
    'idea-triage',
    'pr-review-sweep',
    'run-sweeper',
    'preview-sweeper',
    'universe-sweep',
    'screening-outcome-scoring',
    'stock-alert-scoring',
    'screening-scorecard',
    'ai-cli-env-snapshot',
    'memory-vacuum',
    'holiday-sync',
    'ops-supervisor',
    'docs-sync-audit',
    'run-retro',
    // 2026-10-12 아침 한 통 — 결과는 morning-briefing 이 원장에서 읽어 한 줄씩 싣는다.
    'secretariat',
    'study-applicability',
    'study-deepdive',
    'portfolio-publish',
    'job-feed',
    'job-feed-gap',
    // 저녁 마감 한 통 — 결과는 evening-retro-publish 가 원장·테이블에서 읽어 싣는다.
    'work-reviewer',
    'daily-eval',
    'paper-recommend',
    'paper-order-fill',
    // 2026-10-14 주간 보고 — 원장에 전문을 남긴다. knowledge-lint 의 후처리는 기록 직후에 돈다.
    'knowledge-lint',
    'blog-revision-report',
  ];

  it('모든 playbook taskId 에 경로가 있고 경로 키는 모두 playbook 에 있다', () => {
    const playbookTaskIds = new Set(
      AUTOPILOT_PLAYBOOK.map((entry) => entry.taskId),
    );
    expect(new Set(Object.keys(AUTOPILOT_DELIVERY_ROUTE))).toEqual(
      playbookTaskIds,
    );
    for (const taskId of playbookTaskIds) {
      expect(resolveAutopilotDeliveryRoute(taskId)).toMatch(
        /^(slack|console)$/,
      );
    }
  });

  it('콘솔 경로는 아이디어 판정 요약을 포함하며 paper-score·아침 한 통은 Slack 에 남는다', () => {
    expect(
      Object.entries(AUTOPILOT_DELIVERY_ROUTE)
        .filter(([, route]) => route === 'console')
        .map(([taskId]) => taskId)
        .sort(),
    ).toEqual(consoleTaskIds.sort());
    expect(resolveAutopilotDeliveryRoute('paper-score')).toBe('slack');
    expect(resolveAutopilotDeliveryRoute('goal-checkin')).toBe('slack');
    // 저녁 회고의 pm_plan 판정 버튼은 아침 발송 원장에 morning-briefing 이 SENT 로 있어야 붙는다.
    expect(resolveAutopilotDeliveryRoute('morning-briefing')).toBe('slack');
    // 저녁 마감 한 통과 판정 버튼(retro·pm_plan)이 실리는 자리.
    expect(resolveAutopilotDeliveryRoute('evening-retro-publish')).toBe(
      'slack',
    );
  });

  it('미등록 taskId 는 즉시 오류를 낸다', () => {
    expect(() => resolveAutopilotDeliveryRoute('unknown-task')).toThrow(
      '발송 경로 미등록',
    );
  });
});
