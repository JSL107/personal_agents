import { DailyPlan, StalledTask, TaskItem } from '../domain/pm-agent.type';

export interface ApplyStaleDemotionInput {
  plan: DailyPlan;
  staleIds: Set<string>;
  daysById: Map<string, number>;
}

const FALLBACK_TOP_PRIORITY: TaskItem = {
  id: 'stalled-review',
  title: '정체 항목 종결/위임/보류 결정',
  source: 'USER_INPUT',
  subtasks: [],
  isCriticalPath: true,
  lineage: 'NEW',
  url: '',
};

export const applyStaleDemotion = ({
  plan,
  staleIds,
  daysById,
}: ApplyStaleDemotionInput): DailyPlan => {
  if (staleIds.size === 0) {
    return plan;
  }

  const scheduledTasks = [plan.topPriority, ...plan.morning, ...plan.afternoon];
  const movedTasks = scheduledTasks.filter((task) => staleIds.has(task.id));
  const topPriority = selectTopPriority({ plan, staleIds });
  const morning = plan.morning.filter(
    (task) => !staleIds.has(task.id) && task.id !== topPriority.id,
  );
  const afternoon = plan.afternoon.filter(
    (task) => !staleIds.has(task.id) && task.id !== topPriority.id,
  );
  const stalledTasks = mergeStalledTasks({
    current: plan.stalledTasks ?? [],
    movedTasks,
    daysById,
  });

  return {
    ...plan,
    topPriority,
    morning,
    afternoon,
    stalledTasks,
  };
};

const selectTopPriority = ({
  plan,
  staleIds,
}: {
  plan: DailyPlan;
  staleIds: Set<string>;
}): TaskItem => {
  if (!staleIds.has(plan.topPriority.id)) {
    return plan.topPriority;
  }

  const promoted = [...plan.morning, ...plan.afternoon].find(
    (task) => !staleIds.has(task.id),
  );
  return promoted ?? FALLBACK_TOP_PRIORITY;
};

const mergeStalledTasks = ({
  current,
  movedTasks,
  daysById,
}: {
  current: StalledTask[];
  movedTasks: TaskItem[];
  daysById: Map<string, number>;
}): StalledTask[] => {
  const byId = new Map<string, StalledTask>();
  for (const task of current) {
    byId.set(task.id, task);
  }
  for (const task of movedTasks) {
    byId.set(task.id, {
      id: task.id,
      title: task.title,
      daysStalled: (daysById.get(task.id) ?? 0) + 1,
      url: task.url,
    });
  }
  return [...byId.values()];
};
