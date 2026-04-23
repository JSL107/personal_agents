import { DailyPlan } from '../pm-agent.type';

// 직전 PM run 의 DailyPlan 결과를 모델에게 "어제(=가장 최근) 계획" 으로 보여주는 섹션.
// 모델이 "전일 미완료 추정" 같은 추론을 할 때 활용한다 (기획서 §7.1 입력 요구사항).
export const formatPreviousDailyPlanSection = ({
  plan,
  endedAt,
}: {
  plan: DailyPlan;
  endedAt: Date;
}): string => {
  const lines: string[] = [
    `[직전 PM 실행 (${endedAt.toISOString()}) 의 plan]`,
    `- 최우선: ${plan.topPriority}`,
  ];

  if (plan.morning.length > 0) {
    lines.push('- 오전:');
    for (const task of plan.morning) {
      lines.push(`  - ${task}`);
    }
  }

  if (plan.afternoon.length > 0) {
    lines.push('- 오후:');
    for (const task of plan.afternoon) {
      lines.push(`  - ${task}`);
    }
  }

  if (plan.blocker) {
    lines.push(`- blocker: ${plan.blocker}`);
  }

  lines.push(
    '',
    '※ 이 plan 의 항목 중 사용자가 오늘도 다시 언급한 것 / GitHub 에 그대로 남아있는 것은 "전일 미완료" 가능성으로 간주해 오늘 plan 에 반영해도 된다.',
  );

  return lines.join('\n');
};

// previous output (DB 의 Json) 을 안전하게 DailyPlan 으로 narrow.
// shape 가 안 맞으면 null — 호출자는 "이전 plan 모름" 으로 graceful 처리.
export const coerceToDailyPlan = (value: unknown): DailyPlan | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.topPriority !== 'string' ||
    !Array.isArray(record.morning) ||
    !record.morning.every((m) => typeof m === 'string') ||
    !Array.isArray(record.afternoon) ||
    !record.afternoon.every((a) => typeof a === 'string') ||
    (record.blocker !== null && typeof record.blocker !== 'string') ||
    typeof record.estimatedHours !== 'number' ||
    typeof record.reasoning !== 'string'
  ) {
    return null;
  }
  return record as unknown as DailyPlan;
};
