import { wrapUntrustedInput } from '../../../../common/llm/untrusted-input.util';
import { DailyPlan, TaskItem } from '../pm-agent.type';
import { isDailyPlanShape } from './daily-plan.shape';

// 직전 PM run 의 DailyPlan 결과를 모델에게 "어제(=가장 최근) 계획" 으로 보여주는 섹션.
// 모델이 "전일 미완료 추정" 같은 추론을 할 때 활용한다 (기획서 §7.1 입력 요구사항).
export const formatPreviousDailyPlanSection = ({
  plan,
  endedAt,
}: {
  plan: DailyPlan;
  endedAt: Date;
}): string => {
  // 여기 실리는 제목은 어제 GitHub·Notion·Slack 에서 들어온 외부 문자열이 우리 plan 에
  // 저장됐다가 돌아온 것이다 — 한 번 저장됐다고 우리 말이 되지 않는다. 항목은 경계 안에,
  // 헤더와 아래 ※ 지시는 우리가 모델에게 하는 말이라 경계 밖에 둔다.
  const header = `[직전 PM 실행 (${endedAt.toISOString()}) 의 plan]`;
  const lines: string[] = [`- 최우선: ${renderTaskInline(plan.topPriority)}`];

  if (plan.morning.length > 0) {
    lines.push('- 오전:');
    for (const task of plan.morning) {
      lines.push(`  - ${renderTaskInline(task)}`);
    }
  }

  if (plan.afternoon.length > 0) {
    lines.push('- 오후:');
    for (const task of plan.afternoon) {
      lines.push(`  - ${renderTaskInline(task)}`);
    }
  }

  if (plan.blocker) {
    lines.push(`- blocker: ${plan.blocker}`);
  }

  if (plan.varianceAnalysis.rolledOverTasks.length > 0) {
    lines.push('- 어제 미완료 (이월 후보):');
    for (const task of plan.varianceAnalysis.rolledOverTasks) {
      lines.push(`  - ${task}`);
    }
  }

  return [
    header,
    wrapUntrustedInput(lines.join('\n')),
    '',
    '※ 이 plan 의 항목 중 사용자가 오늘도 다시 언급한 것 / GitHub 에 그대로 남아있는 것은 "전일 미완료" 가능성으로 간주해 오늘 plan 에 반영해도 된다.',
  ].join('\n');
};

const renderTaskInline = (task: TaskItem): string => {
  const critical = task.isCriticalPath ? ' ⚠' : '';
  const wbs =
    task.subtasks.length > 0
      ? ` [WBS: ${task.subtasks.map((s) => s.title).join(', ')}]`
      : '';
  return `${task.title}${critical}${wbs}`;
};

// previous output (DB 의 Json) 을 안전하게 DailyPlan 으로 narrow.
// 신버전 (TaskItem) 은 isDailyPlanShape 로 즉시 통과. 구버전 (string[] 기반) 은 migration 후 반환.
// shape 가 안 맞으면 null — 호출자는 "이전 plan 모름" 으로 graceful 처리.
export const coerceToDailyPlan = (value: unknown): DailyPlan | null => {
  if (isDailyPlanShape(value)) {
    return value;
  }
  const migrated = migrateLegacyShape(value);
  if (migrated && isDailyPlanShape(migrated)) {
    return migrated;
  }
  return null;
};

// 구버전 DailyPlan (topPriority: string, morning/afternoon: string[]) 을 신버전으로 승격.
// 구버전은 subtasks/isCriticalPath/varianceAnalysis 가 없으므로 기본값으로 채움.
// 탐지 실패 시 null — 호출자가 신버전 검증으로 빠짐.
const migrateLegacyShape = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.topPriority !== 'string' ||
    !isStringArray(record.morning) ||
    !isStringArray(record.afternoon) ||
    (record.blocker !== null && typeof record.blocker !== 'string') ||
    typeof record.estimatedHours !== 'number' ||
    typeof record.reasoning !== 'string'
  ) {
    return null;
  }
  return {
    topPriority: toLegacyTask(record.topPriority, 'legacy:top', true),
    varianceAnalysis: {
      rolledOverTasks: [],
      analysisReasoning: '(구버전 plan — varianceAnalysis 기록 없음)',
    },
    morning: record.morning.map((t, i) =>
      toLegacyTask(t, `legacy:morning-${i}`, false),
    ),
    afternoon: record.afternoon.map((t, i) =>
      toLegacyTask(t, `legacy:afternoon-${i}`, false),
    ),
    blocker: record.blocker,
    estimatedHours: record.estimatedHours,
    reasoning: record.reasoning,
  };
};

const toLegacyTask = (
  title: string,
  id: string,
  isCriticalPath: boolean,
): TaskItem => ({
  id,
  title,
  source: 'USER_INPUT',
  subtasks: [],
  isCriticalPath,
});

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
