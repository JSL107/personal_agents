import { DailyPlan } from '../pm-agent.type';

const KST_OFFSET_HOURS = 9;

export interface RecentPlanSummary {
  date: string; // YYYY-MM-DD
  topPriorityTitle: string;
  estimatedHours: number;
  criticalPathCount: number;
  agentRunId: number;
}

// V3-1: 과거 계획들을 모델에게 요약해서 보여주기 위한 포맷터.
// 한 계획당 한 줄로 압축해 토큰을 절약하면서도 핵심 패턴(반복 태스크, 과부하)을 전달한다.
export const formatRecentPlanSummariesSection = (
  summaries: RecentPlanSummary[],
): string | null => {
  if (summaries.length === 0) {
    return null;
  }

  const lines: string[] = ['## 지난 7일 plan 패턴 (최근순)'];
  for (const summary of summaries) {
    const criticalPathNote =
      summary.criticalPathCount > 0 ? ` ⚠${summary.criticalPathCount}건` : '';
    lines.push(
      `- ${summary.date} — 최우선: ${summary.topPriorityTitle} (${summary.estimatedHours}h${criticalPathNote})`,
    );
  }

  lines.push(
    '',
    '※ 같은 태스크가 3일 이상 최우선(topPriority)으로 등장하면 업무 분해 또는 위임을 검토하십시오.',
  );

  return lines.join('\n');
};

export const createRecentPlanSummary = (
  plan: DailyPlan,
  endedAt: Date,
  agentRunId: number,
): RecentPlanSummary => {
  const allTasks = [plan.topPriority, ...plan.morning, ...plan.afternoon];
  const criticalPathCount = allTasks.filter(
    (task) => task.isCriticalPath,
  ).length;

  // 사용자 하루 경계는 KST 기준 (generate-daily-plan.usecase.ts 의 getKstTodayAsUtcDate 와 일관).
  // UTC 기준 그대로 쓰면 한국 자정 직후 ~09:00 까지 endedAt 이 "어제" date 로 찍히는 회귀 발생.
  const kstMs = endedAt.getTime() + KST_OFFSET_HOURS * 60 * 60 * 1000;
  const kstDate = new Date(kstMs).toISOString().split('T')[0];

  return {
    date: kstDate,
    topPriorityTitle: plan.topPriority.title,
    estimatedHours: plan.estimatedHours,
    criticalPathCount,
    agentRunId,
  };
};
