import {
  GithubIssue,
  GithubPullRequest,
  GithubPullRequestSummary,
} from '../../../github/domain/github.type';
import { WaitingItem } from '../../../github/domain/pr-engagement.type';
import { DailyPlan, TaskItem } from '../../pm/domain/pm-agent.type';
import { PoShadowContext } from './po-shadow.type';

export type PlanRealityFactKind =
  | 'PLANNED_MERGED'
  | 'PLANNED_STALLED'
  | 'PLANNED_NOT_FOUND'
  | 'PLANNED_UNVERIFIABLE'
  | 'UNPLANNED_ASSIGNED'
  | 'UNPLANNED_MENTION'
  | 'WORKER_FAILED';

export interface PlanRealityFact {
  id: string;
  kind: PlanRealityFactKind;
  label: string;
  detail: string;
  url?: string;
}

interface ActualGithubItem {
  key: string;
  number: number;
  title: string;
  url: string;
  type: 'ISSUE' | 'PULL_REQUEST';
}

const MISMATCH_KINDS = new Set<PlanRealityFactKind>([
  'PLANNED_STALLED',
  'PLANNED_NOT_FOUND',
  'UNPLANNED_ASSIGNED',
  'UNPLANNED_MENTION',
  'WORKER_FAILED',
]);

const NATURAL_GITHUB_KEY_PATTERN = /^[^/#\s]+\/[^#\s]+#\d+$/;
const GITHUB_NUMBER_PATTERN = /#(\d+)\b/;
// 멘션 본문을 그대로 label 에 넣으면 카드 한 줄이 화면을 넘긴다. 원문은 permalink 로 따라간다.
const MENTION_LABEL_MAX_LENGTH = 40;
// label 은 "무엇에 관한 것인가" 만 담는다. 상태("완료"/"대기"/"확인 불가")는 detail 이 말하므로
// label 에 접미어까지 붙이면 근거 한 줄이 지적 문장보다 길어진다.
const FACT_LABEL_MAX_LENGTH = 30;

export const buildPlanRealityFacts = (
  plan: DailyPlan,
  context: PoShadowContext,
): PlanRealityFact[] => {
  const planTasks = collectUniquePlanTasks(plan);
  const actualItems = collectActualGithubItems(context);
  const actualItemsByKey = new Map(actualItems.map((item) => [item.key, item]));
  const actualItemsByNumber = groupActualItemsByNumber(actualItems);
  const waitingItemsByUrl = new Map(
    context.waitingItems.map((item) => [item.url, item]),
  );
  const plannedActualKeys = new Set<string>();
  const facts: PlanRealityFact[] = [];

  for (const task of planTasks) {
    if (task.source !== 'GITHUB') {
      facts.push(buildUnverifiableFact(task));
      continue;
    }

    const actualItem = findActualGithubItem({
      task,
      actualItemsByKey,
      actualItemsByNumber,
    });
    if (actualItem) {
      plannedActualKeys.add(actualItem.key);
      const waitingItem = waitingItemsByUrl.get(actualItem.url);
      if (actualItem.type === 'PULL_REQUEST' && waitingItem) {
        facts.push(buildStalledFact(actualItem, waitingItem));
      }
      continue;
    }

    // 담당 목록에 없다고 곧바로 "못 찾음" 이 아니다 — 계획대로 오전에 머지했으면
    // open 목록에서 사라진다. 머지 쪽을 먼저 확인해야 끝낸 일이 지적으로 뒤집히지 않는다.
    const mergedPullRequest = findMergedPullRequest({
      task,
      mergedPullRequests: context.mergedPullRequests,
    });
    if (mergedPullRequest) {
      facts.push(buildMergedFact(task, mergedPullRequest));
      continue;
    }

    // 담당 목록 조회 자체가 실패한 회차에는 부재를 근거로 삼을 수 없다. 조회 실패는
    // context.degradedSources 로 카드에 따로 드러난다.
    if (!context.assignedTasks) {
      continue;
    }
    facts.push(buildNotFoundFact(task));
  }

  for (const actualItem of actualItems) {
    if (!plannedActualKeys.has(actualItem.key)) {
      facts.push(buildUnplannedAssignedFact(actualItem));
    }
  }

  for (const mention of context.newMentions) {
    facts.push({
      id: `mention:${mention.channelId}:${mention.ts}`,
      kind: 'UNPLANNED_MENTION',
      label: truncateForLabel(mention.text),
      detail: `${mention.channelName ?? mention.channelId}에서 계획 이후 새 멘션`,
      ...(mention.permalink ? { url: mention.permalink } : {}),
    });
  }

  for (const failedRun of context.failedRunsToday) {
    facts.push({
      id: `failed:${failedRun.agentType}:${failedRun.endedAt.toISOString()}`,
      kind: 'WORKER_FAILED',
      label: `${failedRun.agentType} 워커`,
      detail: `실패 — ${failedRun.reason}`,
    });
  }

  return facts;
};

export const hasPlanRealityMismatch = (facts: PlanRealityFact[]): boolean => {
  return facts.some((fact) => MISMATCH_KINDS.has(fact.kind));
};

const collectUniquePlanTasks = (plan: DailyPlan): TaskItem[] => {
  const tasks = [plan.topPriority, ...plan.morning, ...plan.afternoon];
  const uniqueTasks = new Map<string, TaskItem>();
  for (const task of tasks) {
    if (!uniqueTasks.has(task.id)) {
      uniqueTasks.set(task.id, task);
    }
  }
  return [...uniqueTasks.values()];
};

const collectActualGithubItems = (
  context: PoShadowContext,
): ActualGithubItem[] => {
  if (!context.assignedTasks) {
    return [];
  }

  const issues = context.assignedTasks.issues.map(buildActualIssue);
  const pullRequests = context.assignedTasks.pullRequests.map(
    buildActualPullRequest,
  );
  const uniqueItems = new Map<string, ActualGithubItem>();
  for (const item of [...issues, ...pullRequests]) {
    if (!uniqueItems.has(item.key)) {
      uniqueItems.set(item.key, item);
    }
  }
  return [...uniqueItems.values()];
};

const buildActualIssue = (issue: GithubIssue): ActualGithubItem => ({
  key: `${issue.repo}#${issue.number}`,
  number: issue.number,
  title: issue.title,
  url: issue.url,
  type: 'ISSUE',
});

const buildActualPullRequest = (
  pullRequest: GithubPullRequest,
): ActualGithubItem => ({
  key: `${pullRequest.repo}#${pullRequest.number}`,
  number: pullRequest.number,
  title: pullRequest.title,
  url: pullRequest.url,
  type: 'PULL_REQUEST',
});

const groupActualItemsByNumber = (
  actualItems: ActualGithubItem[],
): Map<number, ActualGithubItem[]> => {
  const groupedItems = new Map<number, ActualGithubItem[]>();
  for (const item of actualItems) {
    const numberMatches = groupedItems.get(item.number) ?? [];
    numberMatches.push(item);
    groupedItems.set(item.number, numberMatches);
  }
  return groupedItems;
};

const findActualGithubItem = ({
  task,
  actualItemsByKey,
  actualItemsByNumber,
}: {
  task: TaskItem;
  actualItemsByKey: Map<string, ActualGithubItem>;
  actualItemsByNumber: Map<number, ActualGithubItem[]>;
}): ActualGithubItem | null => {
  const exactItem = actualItemsByKey.get(task.id);
  if (exactItem) {
    return exactItem;
  }
  if (NATURAL_GITHUB_KEY_PATTERN.test(task.id)) {
    return null;
  }

  const numberMatch = GITHUB_NUMBER_PATTERN.exec(task.id);
  if (!numberMatch) {
    return null;
  }
  const githubNumber = Number(numberMatch[1]);
  const numberMatches = actualItemsByNumber.get(githubNumber) ?? [];
  if (numberMatches.length !== 1) {
    return null;
  }
  return numberMatches[0];
};

const findMergedPullRequest = ({
  task,
  mergedPullRequests,
}: {
  task: TaskItem;
  mergedPullRequests: GithubPullRequestSummary[];
}): GithubPullRequestSummary | null => {
  const exactMatch = mergedPullRequests.find(
    (pullRequest) => `${pullRequest.repo}#${pullRequest.number}` === task.id,
  );
  if (exactMatch) {
    return exactMatch;
  }

  const numberMatch = GITHUB_NUMBER_PATTERN.exec(task.id);
  if (!numberMatch) {
    return null;
  }
  const githubNumber = Number(numberMatch[1]);
  const numberMatches = mergedPullRequests.filter(
    (pullRequest) => pullRequest.number === githubNumber,
  );
  if (numberMatches.length !== 1) {
    return null;
  }
  return numberMatches[0];
};

const truncateLabel = (text: string): string =>
  truncate(text, FACT_LABEL_MAX_LENGTH);

const truncateForLabel = (text: string): string =>
  truncate(text, MENTION_LABEL_MAX_LENGTH);

const truncate = (text: string, maxLength: number): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength)}…`;
};

const buildMergedFact = (
  task: TaskItem,
  mergedPullRequest: GithubPullRequestSummary,
): PlanRealityFact => ({
  id: `merged:${mergedPullRequest.repo}#${mergedPullRequest.number}`,
  kind: 'PLANNED_MERGED',
  label: truncateLabel(task.title),
  detail: `#${mergedPullRequest.number} 머지 완료`,
  url: mergedPullRequest.url,
});

const buildUnverifiableFact = (task: TaskItem): PlanRealityFact => ({
  id: `unverifiable:${task.id}`,
  kind: 'PLANNED_UNVERIFIABLE',
  label: truncateLabel(task.title),
  detail: '외부 상태로 자동 확인 불가',
  ...(task.url ? { url: task.url } : {}),
});

const buildNotFoundFact = (task: TaskItem): PlanRealityFact => ({
  id: `not-found:${task.id}`,
  kind: 'PLANNED_NOT_FOUND',
  label: truncateLabel(task.title),
  detail: '담당 목록·머지 목록 어디에도 없음',
  ...(task.url ? { url: task.url } : {}),
});

const buildStalledFact = (
  actualItem: ActualGithubItem,
  waitingItem: WaitingItem,
): PlanRealityFact => ({
  id: `stalled:${actualItem.key}`,
  kind: 'PLANNED_STALLED',
  label: truncateLabel(actualItem.title),
  detail: waitingItem.reason,
  url: actualItem.url,
});

const buildUnplannedAssignedFact = (
  actualItem: ActualGithubItem,
): PlanRealityFact => ({
  id: `unplanned:${actualItem.key}`,
  kind: 'UNPLANNED_ASSIGNED',
  label: truncateLabel(actualItem.title),
  detail: '계획에 없는 담당 항목',
  url: actualItem.url,
});
