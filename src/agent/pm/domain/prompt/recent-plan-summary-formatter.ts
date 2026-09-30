import { wrapUntrustedInput } from '../../../../common/llm/untrusted-input.util';
import { DailyPlan } from '../pm-agent.type';

const KST_OFFSET_HOURS = 9;
// 정체 일수 때문에 이력은 더 길게 받지만, 모델에게 보여줄 패턴은 최근 7회로 둔다.
const RECENT_PLAN_DISPLAY_LIMIT = 7;

export interface RecentPlanSummary {
  date: string; // YYYY-MM-DD
  taskIds: string[];
  // 강등돼 stalledTasks 에 있던 id — 정체 일수를 강등 뒤에도 이어 세는 데 쓴다(stale-task.util).
  stalledTaskIds: string[];
  // 정체 목록이 id 마다 제 제목을 달게 한다 — 최우선 제목 하나로 모든 id 를 덮으면 엉뚱한 제목이 나간다.
  taskTitleById: Record<string, string>;
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

  // topPriorityTitle 은 저장된 plan 에서 꺼낸 값이라 원래 출처가 외부다 (previous-plan-formatter 와 같은 이유).
  const header = '## 지난 7일 plan 패턴 (최근순)';
  const lines: string[] = [];
  for (const summary of summaries.slice(0, RECENT_PLAN_DISPLAY_LIMIT)) {
    const criticalPathNote =
      summary.criticalPathCount > 0 ? ` ⚠${summary.criticalPathCount}건` : '';
    lines.push(
      `- ${summary.date} — 최우선: ${summary.topPriorityTitle} (${summary.estimatedHours}h${criticalPathNote})`,
    );
  }

  return [
    header,
    wrapUntrustedInput(lines.join('\n')),
    '',
    '※ 같은 태스크가 3일 이상 최우선(topPriority)으로 등장하면 업무 분해 또는 위임을 검토하십시오.',
  ].join('\n');
};

export const createRecentPlanSummary = (
  plan: DailyPlan,
  endedAt: Date,
  agentRunId: number,
): RecentPlanSummary => {
  const allTasks = [plan.topPriority, ...plan.morning, ...plan.afternoon];
  const namedTasks = allTasks.filter((task) => task.id.length > 0);
  const taskIds = namedTasks.map((task) => task.id);
  const stalledTasks = (plan.stalledTasks ?? []).filter(
    (task) => task.id.length > 0,
  );
  const stalledTaskIds = stalledTasks.map((task) => task.id);
  const taskTitleById = Object.fromEntries(
    [...stalledTasks, ...namedTasks].map((task) => [task.id, task.title]),
  );
  const criticalPathCount = allTasks.filter(
    (task) => task.isCriticalPath,
  ).length;

  // 사용자 하루 경계는 KST 기준 (generate-daily-plan.usecase.ts 의 getKstTodayAsUtcDate 와 일관).
  // UTC 기준 그대로 쓰면 한국 자정 직후 ~09:00 까지 endedAt 이 "어제" date 로 찍히는 회귀 발생.
  const kstMs = endedAt.getTime() + KST_OFFSET_HOURS * 60 * 60 * 1000;
  const kstDate = new Date(kstMs).toISOString().split('T')[0];

  return {
    date: kstDate,
    taskIds,
    stalledTaskIds,
    taskTitleById,
    topPriorityTitle: plan.topPriority.title,
    estimatedHours: plan.estimatedHours,
    criticalPathCount,
    agentRunId,
  };
};
