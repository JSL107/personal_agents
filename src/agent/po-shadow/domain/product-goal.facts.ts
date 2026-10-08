import {
  plainDateToUtcDate,
  todayInKst,
} from '../../../schedule/domain/parse-due-date';
import { PlanRealityFact } from './plan-reality.diff';
import { PoShadowContext } from './po-shadow.type';
import {
  GOAL_DEADLINE_RISK_DAYS,
  isLinkedToGoal,
  ProductGoalRecord,
  STALE_GOAL_DAYS,
} from './product-goal';

const MILLISECONDS_PER_DAY = 86_400_000;
const LABEL_MAX_LENGTH = 30;
// 목표 밖 작업은 한 사실로 묶고 제목은 앞의 몇 건만 보인다 — 전부 나열하면 근거 한 줄이 카드를 넘긴다.
const UNSERVED_TITLE_PREVIEW_COUNT = 3;

export interface BuildProductGoalFactsInput {
  goals: ProductGoalRecord[];
  context: PoShadowContext;
  // 직전 PO 회차들이 남긴 목표별 마지막 진행 시각. 없는 목표는 진행 기록이 없다는 뜻이다.
  lastProgressAtByGoalId: Map<number, Date>;
  now: Date;
}

export interface ProductGoalFactsResult {
  facts: PlanRealityFact[];
  // 오늘 붙은 진행이 있는 목표. PO 회차가 inputSnapshot 에 남기고 다음 회차가 묵음 판정에 읽는다.
  progressedGoalIds: number[];
  // "이 목표 아직 유효한가요?" 줄. 닫기는 사용자가 한다.
  checkIns: string[];
}

interface WorkItem {
  title: string;
  url?: string;
}

// 활성 목표가 0개면 아무것도 만들지 않는다 — 단계 3 이전 출력과 같아야 한다.
export const buildProductGoalFacts = ({
  goals: candidateGoals,
  context,
  lastProgressAtByGoalId,
  now,
}: BuildProductGoalFactsInput): ProductGoalFactsResult => {
  // 저장소가 활성만 돌려주지만 여기서도 거른다 — 닫힌 목표가 섞여 들어오면 이미 끝낸 목표가
  // 기한 위험과 "아직 유효한가요?" 를 계속 낸다.
  const goals = candidateGoals.filter((goal) => goal.closedAt === null);
  if (goals.length === 0) {
    return { facts: [], progressedGoalIds: [], checkIns: [] };
  }

  const todayUtc = plainDateToUtcDate(todayInKst(now));
  const progressedWork = collectProgressedWork(context);
  // 머지 조회를 못 한 회차는 진행이 없었는지 알 수 없다. 그때는 목표 밖 작업과 무진행 질문을
  // 내지 않는다 — 못 본 것을 "진행 없음" 으로 읽으면 멀쩡한 목표에 "아직 유효한가요?" 를 묻는다.
  const progressKnown = context.mergedLookupAvailable;
  const openItems = collectOpenItems(context);
  const facts: PlanRealityFact[] = [];

  const unserved = progressedWork.filter(
    (work) => !goals.some((goal) => isLinkedToGoal(goal, work.title)),
  );
  if (progressKnown && unserved.length > 0) {
    facts.push(buildUnservedFact(unserved));
  }

  for (const goal of goals) {
    const daysLeft = daysUntil(goal.dueDate, todayUtc);
    if (daysLeft === null || daysLeft > GOAL_DEADLINE_RISK_DAYS) {
      continue;
    }
    const linkedOpenCount = openItems.filter((item) =>
      isLinkedToGoal(goal, item.title),
    ).length;
    if (linkedOpenCount > 0) {
      facts.push(buildDeadlineRiskFact({ goal, daysLeft, linkedOpenCount }));
    }
  }

  const progressedGoalIds = goals
    .filter((goal) =>
      progressedWork.some((work) => isLinkedToGoal(goal, work.title)),
    )
    .map((goal) => goal.id);

  const checkIns = goals
    .map((goal) =>
      buildCheckIn({
        goal,
        daysLeft: daysUntil(goal.dueDate, todayUtc),
        progressedToday: progressedGoalIds.includes(goal.id),
        progressKnown,
        lastProgressAt: lastProgressAtByGoalId.get(goal.id) ?? null,
        now,
      }),
    )
    .filter((line): line is string => line !== null);

  return { facts, progressedGoalIds, checkIns };
};

// 직전 회차 inputSnapshot 의 goalProgress 에서 목표별 마지막 진행 시각을 모은다.
// 형태가 다른 값은 건너뛴다 — 진행 기록이 빠지면 묵음 질문이 일찍 뜰 뿐 오판이 쌓이지는 않는다.
export const collectLastProgressAt = (
  runs: { inputSnapshot: unknown; endedAt: Date }[],
): Map<number, Date> => {
  const lastProgressAt = new Map<number, Date>();
  for (const run of runs) {
    for (const goalId of readGoalProgress(run.inputSnapshot)) {
      const known = lastProgressAt.get(goalId);
      if (known === undefined || run.endedAt > known) {
        lastProgressAt.set(goalId, run.endedAt);
      }
    }
  }
  return lastProgressAt;
};

const readGoalProgress = (inputSnapshot: unknown): number[] => {
  if (typeof inputSnapshot !== 'object' || inputSnapshot === null) {
    return [];
  }
  const value = (inputSnapshot as Record<string, unknown>).goalProgress;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is number => Number.isSafeInteger(item));
};

// "오늘 진행된 작업" — 계획 이후 머지된 PR 만 센다. 계획에 실렸거나 담당 목록에 열려 있다는 것은
// 움직였다는 근거가 아니다 — 그것을 진행으로 치면 매일 계획에만 오르고 멈춘 일이 진행으로
// 기록돼 30일 무진행 질문이 영영 뜨지 않는다(#773 리뷰).
const collectProgressedWork = (context: PoShadowContext): WorkItem[] =>
  context.mergedPullRequests.map((pullRequest) => ({
    title: pullRequest.title,
    url: pullRequest.url,
  }));

const collectOpenItems = (context: PoShadowContext): WorkItem[] => {
  if (context.assignedTasks === null) {
    return [];
  }
  return [
    ...context.assignedTasks.issues,
    ...context.assignedTasks.pullRequests,
  ].map((item) => ({ title: item.title, url: item.url }));
};

const buildUnservedFact = (unserved: WorkItem[]): PlanRealityFact => {
  const preview = unserved
    .slice(0, UNSERVED_TITLE_PREVIEW_COUNT)
    .map((work) => truncate(work.title))
    .join(' · ');
  const rest = unserved.length - UNSERVED_TITLE_PREVIEW_COUNT;
  return {
    id: 'goal-unserved:today',
    kind: 'GOAL_UNSERVED',
    label: `목표 밖 작업 ${unserved.length}건`,
    detail: rest > 0 ? `${preview} 외 ${rest}건` : preview,
  };
};

const buildDeadlineRiskFact = ({
  goal,
  daysLeft,
  linkedOpenCount,
}: {
  goal: ProductGoalRecord;
  daysLeft: number;
  linkedOpenCount: number;
}): PlanRealityFact => ({
  id: `goal-deadline:${goal.id}`,
  kind: 'GOAL_DEADLINE_RISK',
  label: truncate(goal.title),
  detail: `${formatDaysLeft(daysLeft)} · 붙은 열린 항목 ${linkedOpenCount}건`,
});

const buildCheckIn = ({
  goal,
  daysLeft,
  progressedToday,
  progressKnown,
  lastProgressAt,
  now,
}: {
  goal: ProductGoalRecord;
  daysLeft: number | null;
  progressedToday: boolean;
  progressKnown: boolean;
  lastProgressAt: Date | null;
  now: Date;
}): string | null => {
  if (daysLeft !== null && daysLeft < 0) {
    return `"${goal.title}" — 기한 ${-daysLeft}일 지남. 이 목표 아직 유효한가요?`;
  }
  if (progressedToday || !progressKnown) {
    return null;
  }
  // 진행 기록이 없으면 만든 시각부터 센다 — 갓 만든 목표를 바로 묵었다고 하지 않는다.
  const since =
    lastProgressAt !== null && lastProgressAt > goal.createdAt
      ? lastProgressAt
      : goal.createdAt;
  // "30일 넘게" — 정확히 30일째는 아직 묻지 않는다.
  const idleMilliseconds = now.getTime() - since.getTime();
  if (idleMilliseconds <= STALE_GOAL_DAYS * MILLISECONDS_PER_DAY) {
    return null;
  }
  return `"${goal.title}" — ${STALE_GOAL_DAYS}일 넘게 붙은 진행 없음. 이 목표 아직 유효한가요?`;
};

const daysUntil = (dueDate: Date | null, todayUtc: Date): number | null => {
  if (dueDate === null) {
    return null;
  }
  return Math.round(
    (dueDate.getTime() - todayUtc.getTime()) / MILLISECONDS_PER_DAY,
  );
};

const formatDaysLeft = (daysLeft: number): string =>
  daysLeft < 0 ? `기한 ${-daysLeft}일 지남` : `기한 D-${daysLeft}`;

const truncate = (text: string): string => {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= LABEL_MAX_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, LABEL_MAX_LENGTH)}…`;
};
