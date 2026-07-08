import { RecentPlanSummary } from './prompt/recent-plan-summary-formatter';

export const computeStaleTaskIds = (
  summaries: RecentPlanSummary[],
  thresholdDays: number,
): Set<string> => {
  if (thresholdDays <= 1) {
    return new Set();
  }

  const minimumPastDays = thresholdDays - 1;
  const daysById = computeConsecutiveDaysById(summaries);
  const staleIds = [...daysById.entries()]
    .filter(([, days]) => days >= minimumPastDays)
    .map(([id]) => id);

  return new Set(staleIds);
};

export const computeConsecutiveDaysById = (
  summaries: RecentPlanSummary[],
): Map<string, number> => {
  const sortedSummaries = [...summaries].sort((left, right) =>
    right.date.localeCompare(left.date),
  );
  const latestSummary = sortedSummaries[0];
  if (!latestSummary) {
    return new Map();
  }

  const latestIds = getTaskIds(latestSummary);
  const entries = latestIds.map((id): [string, number] => [
    id,
    countConsecutiveDays({ id, summaries: sortedSummaries }),
  ]);

  return new Map(entries);
};

const countConsecutiveDays = ({
  id,
  summaries,
}: {
  id: string;
  summaries: RecentPlanSummary[];
}): number => {
  let count = 0;
  for (const summary of summaries) {
    const ids = getTaskIds(summary);
    if (!ids.includes(id)) {
      return count;
    }
    count += 1;
  }
  return count;
};

const getTaskIds = (summary: RecentPlanSummary): string[] => {
  const taskIds = summary.taskIds ?? [];
  return [...new Set(taskIds.filter((id) => id.length > 0))];
};
