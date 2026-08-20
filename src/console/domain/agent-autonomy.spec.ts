import { classifyAutonomy, isAutonomousTrigger } from './agent-autonomy';

describe('isAutonomousTrigger', () => {
  it.each([
    'MORNING_BRIEFING_CRON',
    'SCHEDULED',
    'PR_REVIEW_SWEEP',
    'PRICE_COLLECTION_TICK',
  ])('%s를 자율 트리거로 판정한다', (triggerType) => {
    expect(isAutonomousTrigger(triggerType)).toBe(true);
  });

  it.each([
    'SLACK_COMMAND_REVIEW_PR',
    'SLACK_MENTION_CODE_REVIEWER',
    'WEBHOOK_PULL_REQUEST',
    'REPORT_HUMANIZE',
  ])('%s를 자율 트리거로 판정하지 않는다', (triggerType) => {
    expect(isAutonomousTrigger(triggerType)).toBe(false);
  });
});

describe('classifyAutonomy', () => {
  it.each([
    { triggerTypes: [], expected: 'NEVER_RUN' },
    { triggerTypes: ['MORNING_BRIEFING_CRON'], expected: 'AUTONOMOUS' },
    { triggerTypes: ['WEBHOOK_PULL_REQUEST'], expected: 'EVENT_DRIVEN' },
    { triggerTypes: ['SLACK_COMMAND_TODAY'], expected: 'ON_DEMAND' },
  ] as const)('$expected 범주를 판정한다', ({ triggerTypes, expected }) => {
    expect(classifyAutonomy(triggerTypes)).toBe(expected);
  });

  it('자율 트리거와 수동 트리거가 섞이면 자율을 우선한다', () => {
    expect(
      classifyAutonomy(['PR_REVIEW_SWEEP', 'SLACK_MENTION_CODE_REVIEWER']),
    ).toBe('AUTONOMOUS');
  });

  it('미분류 트리거는 수요 기반으로 안전하게 분류한다', () => {
    expect(classifyAutonomy(['REPORT_HUMANIZE'])).toBe('ON_DEMAND');
  });

  it('SCHEDULED 단독 트리거를 자율로 분류한다', () => {
    expect(classifyAutonomy(['SCHEDULED'])).toBe('AUTONOMOUS');
  });

  it('모든 이벤트 트리거가 WEBHOOK_ 접두사일 때만 이벤트 기반으로 분류한다', () => {
    expect(classifyAutonomy(['WEBHOOK_PULL_REQUEST', 'REPORT_HUMANIZE'])).toBe(
      'ON_DEMAND',
    );
  });
});
