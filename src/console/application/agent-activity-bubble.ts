export const ACTIVITY_BUBBLE_MAX_LENGTH = 12;

type ActivityBubbleInput = {
  agentType: string;
  triggerType: string;
  inputSnapshot: Record<string, unknown> | null;
};

type ActivityBubbleRule =
  | string
  | ((inputSnapshot: Record<string, unknown> | null) => string | null);

const ACTIVITY_BUBBLE_RULES: Record<string, ActivityBubbleRule> = {
  'WORK_REVIEWER:DAILY_EVAL_CRON': '오늘 일 정리 중',
  'WORK_REVIEWER:WEEKLY_SUMMARY_CRON': '주간 정리 중',
  'PO_EVAL:DAILY_EVAL_CRON': '오늘 채점 중',
  MORNING_BRIEFING_CRON: '아침 계획 짜는 중',
  SLACK_COMMAND_TODAY: '오늘 계획 짜는 중',
  IMPACT_REPORT_RECENT_CRON: '성과 정리 중',
  WEEKLY_CEO_META_CRON: '주간 리뷰 중',
  SLACK_MENTION_CAREER_MATE: '커리어 보는 중',
  REPORT_HUMANIZE: '문장 다듬는 중',
  AUTOPILOT_PO_SHADOW_CRON: '기획 검토 중',
  SUBCONSCIOUS_TICK: '변화 훑는 중',
  AUTOPILOT_ASSIGN_CRON: '업무 배정 중',
  SLACK_COMMAND_VACATION: '휴가 계산 중',
  STUDY_BRIEF_CRON: '학습 정리 중',
  SLACK_COMMAND_PLAN_TASK: '작업 설계 중',
  AUTOPILOT_EVENING_RETRO_CRON: '하루 회고 쓰는 중',
  SLACK_COMMAND_BE_SCHEMA: '스키마 짜는 중',
  SLACK_COMMAND_BE_SRE: '오류 추적 중',
  SLACK_COMMAND_BE_TEST: '테스트 짜는 중',
  SLACK_MENTION_JOB_APPLICATION: '지원 정리 중',
  'OPS_SUPERVISOR:SCHEDULED': '운영 점검 중',
  PR_REVIEW_SWEEP: createPullRequestReviewBubble,
  SLACK_COMMAND_REVIEW_PR: createPullRequestReviewBubble,
  SLACK_COMMAND_BE_FIX: createPullRequestCheckBubble,
  WEBHOOK_ISSUE_AUTO_LABEL: createIssueLabelBubble,
  AUTOPILOT_INVEST_CRON: createInvestBubble,
};

export function activityBubble(input: ActivityBubbleInput): string | null {
  const pairKey = `${input.agentType}:${input.triggerType}`;
  const rule =
    ACTIVITY_BUBBLE_RULES[pairKey] ?? ACTIVITY_BUBBLE_RULES[input.triggerType];
  if (rule === undefined) {
    return null;
  }

  const bubble = typeof rule === 'string' ? rule : rule(input.inputSnapshot);
  if (bubble === null || bubble.length > ACTIVITY_BUBBLE_MAX_LENGTH) {
    return null;
  }
  return bubble;
}

function createPullRequestReviewBubble(
  inputSnapshot: Record<string, unknown> | null,
): string | null {
  const pullNumber = readInteger(inputSnapshot, 'pullNumber');
  if (pullNumber === null) {
    return null;
  }
  return `#${pullNumber} 리뷰 중`;
}

function createPullRequestCheckBubble(
  inputSnapshot: Record<string, unknown> | null,
): string | null {
  const pullNumber = readInteger(inputSnapshot, 'pullNumber');
  if (pullNumber === null) {
    return null;
  }
  return `#${pullNumber} 점검 중`;
}

// 이름표가 이미 "이슈 분류"라 접두어는 중복이며, 6자리 번호까지 12자 상한 안에 들어와야 한다.
function createIssueLabelBubble(
  inputSnapshot: Record<string, unknown> | null,
): string | null {
  const issueNumber = readInteger(inputSnapshot, 'issueNumber');
  if (issueNumber === null) {
    return null;
  }
  return `#${issueNumber} 분류 중`;
}

function createInvestBubble(
  inputSnapshot: Record<string, unknown> | null,
): string | null {
  if (inputSnapshot?.marketCountry === 'US') {
    return '미국장 보는 중';
  }
  if (inputSnapshot?.marketCountry === 'KR') {
    return '한국장 보는 중';
  }
  return null;
}

function readInteger(
  inputSnapshot: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = inputSnapshot?.[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  return null;
}
