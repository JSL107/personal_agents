import {
  ACTIVITY_BUBBLE_MAX_LENGTH,
  activityBubble,
} from './agent-activity-bubble';

describe('activityBubble', () => {
  it('PR 번호로 리뷰 대상을 표시한다', () => {
    const result = activityBubble({
      agentType: 'CODE_REVIEWER',
      triggerType: 'PR_REVIEW_SWEEP',
      inputSnapshot: { pullNumber: 273 },
    });

    expect(result).toBe('#273 리뷰 중');
  });

  it.each([{}, { pullNumber: '273' }])(
    'PR 번호가 정수가 아니면 문구를 만들지 않는다: %p',
    (inputSnapshot) => {
      const result = activityBubble({
        agentType: 'CODE_REVIEWER',
        triggerType: 'PR_REVIEW_SWEEP',
        inputSnapshot,
      });

      expect(result).toBeNull();
    },
  );

  it('미국 시장 코드를 한국어 시장 문구로 바꾼다', () => {
    const result = activityBubble({
      agentType: 'INVEST',
      triggerType: 'AUTOPILOT_INVEST_CRON',
      inputSnapshot: { marketCountry: 'US' },
    });

    expect(result).toBe('미국장 보는 중');
  });

  it('지원하지 않는 시장 코드는 문구를 만들지 않는다', () => {
    const result = activityBubble({
      agentType: 'INVEST',
      triggerType: 'AUTOPILOT_INVEST_CRON',
      inputSnapshot: { marketCountry: 'JP' },
    });

    expect(result).toBeNull();
  });

  it('같은 계기도 agentType 쌍 키에 따라 다른 문구를 쓴다', () => {
    const workReviewer = activityBubble({
      agentType: 'WORK_REVIEWER',
      triggerType: 'DAILY_EVAL_CRON',
      inputSnapshot: null,
    });
    const poEval = activityBubble({
      agentType: 'PO_EVAL',
      triggerType: 'DAILY_EVAL_CRON',
      inputSnapshot: null,
    });

    expect(workReviewer).toBe('오늘 일 정리 중');
    expect(poEval).toBe('오늘 채점 중');
  });

  it('미등록 triggerType은 문구를 만들지 않는다', () => {
    const result = activityBubble({
      agentType: 'PM',
      triggerType: 'UNKNOWN_TRIGGER',
      inputSnapshot: null,
    });

    expect(result).toBeNull();
  });

  it('대상이 필요 없는 문구는 inputSnapshot이 null이어도 반환한다', () => {
    const result = activityBubble({
      agentType: 'PM',
      triggerType: 'MORNING_BRIEFING_CRON',
      inputSnapshot: null,
    });

    expect(result).toBe('아침 계획 짜는 중');
  });

  it.each([
    ['WORK_REVIEWER', 'DAILY_EVAL_CRON', null],
    ['WORK_REVIEWER', 'WEEKLY_SUMMARY_CRON', null],
    ['PO_EVAL', 'DAILY_EVAL_CRON', null],
    ['PM', 'MORNING_BRIEFING_CRON', null],
    ['PM', 'SLACK_COMMAND_TODAY', null],
    ['IMPACT_REPORT', 'IMPACT_REPORT_RECENT_CRON', null],
    ['CEO_META_REVIEW', 'WEEKLY_CEO_META_CRON', null],
    ['CAREER_MATE', 'SLACK_MENTION_CAREER_MATE', null],
    ['HUMANIZER', 'REPORT_HUMANIZE', null],
    ['PO', 'AUTOPILOT_PO_SHADOW_CRON', null],
    ['SUBCONSCIOUS', 'SUBCONSCIOUS_TICK', null],
    ['SECRETARIAT', 'AUTOPILOT_ASSIGN_CRON', null],
    ['VACATION', 'SLACK_COMMAND_VACATION', null],
    ['STUDY_BRIEF', 'STUDY_BRIEF_CRON', null],
    ['PM', 'SLACK_COMMAND_PLAN_TASK', null],
    ['WORK_REVIEWER', 'AUTOPILOT_EVENING_RETRO_CRON', null],
    ['BE', 'SLACK_COMMAND_BE_SCHEMA', null],
    ['BE', 'SLACK_COMMAND_BE_SRE', null],
    ['BE', 'SLACK_COMMAND_BE_TEST', null],
    ['JOB_APPLICATION', 'SLACK_MENTION_JOB_APPLICATION', null],
    ['OPS_SUPERVISOR', 'SCHEDULED', null],
    ['CODE_REVIEWER', 'PR_REVIEW_SWEEP', { pullNumber: 99_999 }],
    ['CODE_REVIEWER', 'SLACK_COMMAND_REVIEW_PR', { pullNumber: 99_999 }],
    ['BE', 'SLACK_COMMAND_BE_FIX', { pullNumber: 99_999 }],
    ['ISSUE_LABELER', 'WEBHOOK_ISSUE_AUTO_LABEL', { issueNumber: 12 }],
    ['INVEST', 'AUTOPILOT_INVEST_CRON', { marketCountry: 'KR' }],
  ] as const)(
    '%s:%s 문구가 12자를 넘지 않는다',
    (agentType, triggerType, inputSnapshot) => {
      const result = activityBubble({
        agentType,
        triggerType,
        inputSnapshot,
      });

      expect(result).not.toBeNull();
      expect(result?.length).toBeLessThanOrEqual(ACTIVITY_BUBBLE_MAX_LENGTH);
    },
  );

  it('5자리 이슈 번호가 상한을 넘으면 문구를 만들지 않는다', () => {
    const result = activityBubble({
      agentType: 'ISSUE_LABELER',
      triggerType: 'WEBHOOK_ISSUE_AUTO_LABEL',
      inputSnapshot: { issueNumber: 99_999 },
    });

    expect(result).toBeNull();
  });
});
