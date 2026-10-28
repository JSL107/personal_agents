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
} from './product-goal';

const MILLISECONDS_PER_DAY = 86_400_000;
const LABEL_MAX_LENGTH = 30;
// 목표 밖 작업은 한 사실로 묶고 제목은 앞의 몇 건만 보인다 — 전부 나열하면 근거 한 줄이 카드를 넘긴다.
const UNSERVED_TITLE_PREVIEW_COUNT = 3;

export interface BuildProductGoalFactsInput {
  goals: ProductGoalRecord[];
  context: PoShadowContext;
  now: Date;
}

export interface ProductGoalFactsResult {
  facts: PlanRealityFact[];
}

interface WorkItem {
  title: string;
  url?: string;
}

// 활성 목표가 0개면 아무것도 만들지 않는다 — 단계 3 이전 출력과 같아야 한다.
export const buildProductGoalFacts = ({
  goals: candidateGoals,
  context,
  now,
}: BuildProductGoalFactsInput): ProductGoalFactsResult => {
  // 저장소가 활성만 돌려주지만 여기서도 거른다 — 닫힌 목표가 섞여 들어오면 이미 끝낸 목표가
  // 기한 위험을 계속 낸다. "아직 유효한가요?" 는 월요일 목표 점검(goal-checkin)이 묻는다.
  // 키워드 없는 목표(방향 목표)도 거른다 — 작업을 이을 수단이 없어 "연결 안 됨" 과 "판정 불가" 를
  // 가를 수 없다. 섞이면 그날 머지한 PR 이 전부 목표 밖이 된다.
  const goals = candidateGoals.filter(
    (goal) => goal.closedAt === null && goal.keywords.length > 0,
  );
  if (goals.length === 0) {
    return { facts: [] };
  }

  const todayUtc = plainDateToUtcDate(todayInKst(now));
  const progressedWork = collectProgressedWork(context);
  // 머지 조회를 못 한 회차는 진행이 없었는지 알 수 없다. 그때는 목표 밖 작업을 내지 않는다.
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

  return { facts };
};

// "오늘 진행된 작업" — 계획 이후 머지된 PR 만 센다. 계획에 실렸거나 담당 목록에 열려 있다는 것은
// 움직였다는 근거가 아니다(#773 리뷰).
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
  sequence: toDeadlineStage(daysLeft),
});

// 임박(1)·당일(2)·초과(3). 같은 목표가 매일 다시 켜지지 않되, 단계가 오른 날은 새 사실로 다시 알린다.
const toDeadlineStage = (daysLeft: number): number => {
  if (daysLeft > 0) {
    return 1;
  }
  if (daysLeft === 0) {
    return 2;
  }
  return 3;
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
