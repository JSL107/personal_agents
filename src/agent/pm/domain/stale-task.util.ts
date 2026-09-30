import { AssignedTasks } from '../../../github/domain/github.type';
import { RecentPlanSummary } from './prompt/recent-plan-summary-formatter';

// 오늘 GitHub 목록에 열려 있는 작업 id(`owner/repo#번호`). 조회에 실패해 모르면 null.
export type OpenTaskIds = ReadonlySet<string> | null;

// 순번 id 는 날마다 다른 작업을 가리킨다 — 이어 세면 "rollover:1 이 5일째 정체" 같은 오탐이 난다.
const POSITIONAL_ID_PATTERN = /^(rollover|user):/;
const GITHUB_ID_PATTERN = /^[^\s/]+\/[^\s#]+#\d+$/;

export const collectOpenGithubTaskIds = (
  githubTasks: AssignedTasks | null,
): OpenTaskIds => {
  if (!githubTasks) {
    return null;
  }
  const tasks = [...githubTasks.issues, ...githubTasks.pullRequests];
  return new Set(tasks.map((task) => `${task.repo}#${task.number}`));
};

export const computeStaleTaskIds = (
  summaries: RecentPlanSummary[],
  thresholdDays: number,
  openIds: OpenTaskIds,
): Set<string> => {
  if (thresholdDays <= 1) {
    return new Set();
  }

  const minimumPastDays = thresholdDays - 1;
  const daysById = computeConsecutiveDaysById(summaries, openIds);
  const staleIds = [...daysById.entries()]
    .filter(([, days]) => days >= minimumPastDays)
    .map(([id]) => id);

  return new Set(staleIds);
};

export const computeConsecutiveDaysById = (
  summaries: RecentPlanSummary[],
  openIds: OpenTaskIds,
): Map<string, number> => {
  const idsByDate = groupTaskIdsByDate(summaries, openIds);
  const [latestIds] = idsByDate.values();
  if (!latestIds) {
    return new Map();
  }

  const days = [...idsByDate.values()];
  const entries = [...latestIds].map((id): [string, number] => [
    id,
    countConsecutiveDays(id, days),
  ]);

  return new Map(entries);
};

// 같은 날 여러 번 돈 plan 은 하루로 합친다 — 회차를 세면 수동 /today 재실행이 정체 일수를 부풀린다.
// 날짜 내림차순으로 넣으므로 Map 순회 순서가 곧 최근순이다.
const groupTaskIdsByDate = (
  summaries: RecentPlanSummary[],
  openIds: OpenTaskIds,
): Map<string, Set<string>> => {
  const sortedSummaries = [...summaries].sort((left, right) =>
    right.date.localeCompare(left.date),
  );
  const idsByDate = new Map<string, Set<string>>();
  for (const summary of sortedSummaries) {
    const ids = idsByDate.get(summary.date) ?? new Set<string>();
    for (const id of getCountableTaskIds(summary, openIds)) {
      ids.add(id);
    }
    idsByDate.set(summary.date, ids);
  }
  return idsByDate;
};

const countConsecutiveDays = (id: string, days: Set<string>[]): number => {
  let count = 0;
  for (const ids of days) {
    if (!ids.has(id)) {
      return count;
    }
    count += 1;
  }
  return count;
};

// 강등돼 stalledTasks 로 간 날도 그 작업은 여전히 쌓여 있던 날이다. 이걸 빼면 강등 다음 날
// 연속 기록이 0 으로 돌아가, 5일째에 강등되고 다음 날 다시 계획에 오르는 주기가 반복됐다
// (2026-09 원장: #52 가 09-07 부터 매일 있었는데 정체 일수는 매번 5).
// 다만 이어 세는 것은 오늘 GitHub 목록에 열려 있는 작업뿐이다 — 정체 목록은 프롬프트로 모델에
// 넘어가 다시 stalledTasks 로 돌아오므로, 확인 없이 이으면 닫힌 작업이 영영 따라다닌다.
const getCountableTaskIds = (
  summary: RecentPlanSummary,
  openIds: OpenTaskIds,
): string[] => {
  const carriedIds = (summary.stalledTaskIds ?? []).filter(
    (id) => GITHUB_ID_PATTERN.test(id) && (openIds === null || openIds.has(id)),
  );
  return [...(summary.taskIds ?? []), ...carriedIds].filter(
    (id) => id.length > 0 && !POSITIONAL_ID_PATTERN.test(id),
  );
};
