import { AUTOPILOT_PLAYBOOK } from './autopilot.playbook';
import {
  AUTOPILOT_DELIVERY_ROUTE,
  resolveAutopilotDeliveryRoute,
} from './autopilot-delivery-route';

describe('AUTOPILOT_DELIVERY_ROUTE', () => {
  const consoleTaskIds = [
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

  it('콘솔 경로는 owner 가 확정한 13개이며 paper-score 는 Slack 에 남는다', () => {
    expect(
      Object.entries(AUTOPILOT_DELIVERY_ROUTE)
        .filter(([, route]) => route === 'console')
        .map(([taskId]) => taskId)
        .sort(),
    ).toEqual(consoleTaskIds.sort());
    expect(resolveAutopilotDeliveryRoute('paper-score')).toBe('slack');
  });

  it('미등록 taskId 는 즉시 오류를 낸다', () => {
    expect(() => resolveAutopilotDeliveryRoute('unknown-task')).toThrow(
      '발송 경로 미등록',
    );
  });
});
