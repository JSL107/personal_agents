import {
  plainDateToUtcDate,
  todayInKst,
} from '../../../schedule/domain/parse-due-date';
import { GoalQuestionRecord } from './port/goal-question.repository.port';
import { isLinkedToGoal, ProductGoalRecord } from './product-goal';

export const MILLISECONDS_PER_DAY = 86_400_000;
// 숙제 줄에 "지난주 관련 작업" 으로 보여 줄 머지 창.
export const GOAL_CHECKIN_RECENT_DAYS = 7;
// 이 기간 동안 붙은 머지가 없으면 잊은 목표로 보고 [닫기] 를 단다(설계 §4-3 "2주 연속").
// 주간 점검이 상태를 따로 기록하지 않고 머지 이력으로 바로 판정하도록 창 하나로 둔다.
export const FORGOTTEN_GOAL_DAYS = 14;
// 답이 없는 질문이 이만큼 연달아 쌓이면 쉰다.
const UNANSWERED_QUESTIONS_BEFORE_REST = 2;
// 마지막 무응답 질문 뒤 이 기간 동안은 묻지 않는다 — 주 1회 점검이 네 번 건너뛴다(설계 §4-3 "4주").
// 35일이 아니라 34일인 이유: 질문 행의 createdAt 은 발송이 끝난 뒤 찍혀 5주 뒤 점검 시각보다 몇 초 늦다.
// 35일로 두면 그 몇 초 차이로 한 주를 더 쉰다.
const QUESTION_REST_DAYS = 34;

export interface GoalCheckinInput {
  goals: ProductGoalRecord[];
  // 지난 FORGOTTEN_GOAL_DAYS 동안 머지한 본인 PR. null 이면 조회를 못 했다 — "작업 없음" 과 다르다.
  mergedPullRequests: MergedWork[] | null;
  openQuestion: GoalQuestionRecord | null;
  // 최근 질문 몇 건(최신순). 쉬기 판정에 쓴다.
  recentQuestions: GoalQuestionRecord[];
  now: Date;
}

export interface MergedWork {
  number: number;
  title: string;
  mergedAt: string;
}

export interface TaskGoalStatus {
  goal: ProductGoalRecord;
  recentPullRequestNumbers: number[];
  // 오늘 기준 남은 일수. 음수면 지남, null 이면 기한 없음.
  daysLeft: number | null;
}

export type StaleReason =
  | { kind: 'OVERDUE'; daysOverdue: number }
  | { kind: 'FORGOTTEN' };

export interface StaleGoal {
  goal: ProductGoalRecord;
  reason: StaleReason;
}

export type GoalCheckinPlan =
  | { kind: 'SKIP' }
  // 활성 목표가 없다 — 목표를 묻는다.
  | { kind: 'ASK_FOR_GOALS' }
  | {
      kind: 'CHECKIN';
      tasks: TaskGoalStatus[];
      // "아직 유효한가요?" 를 묻고 [닫기] 카드를 다는 목표. 숙제·방향 모두 올 수 있다.
      staleGoals: StaleGoal[];
      directions: ProductGoalRecord[];
      // 숙제가 없을 때 끌어내기 질문을 붙일 방향 하나. null 이면 붙이지 않는다.
      drawOutDirection: ProductGoalRecord | null;
      mergedLookupAvailable: boolean;
    };

// 월요일 목표 점검의 판정. 모델을 부르지 않는다 — 모델 장애로 점검이 통째로 빠지지 않게.
export const planGoalCheckin = ({
  goals,
  mergedPullRequests,
  openQuestion,
  recentQuestions,
  now,
}: GoalCheckinInput): GoalCheckinPlan => {
  // 열린 질문이 있으면 새 질문을 겹쳐 내지 않는다 — 대기 표지는 사용자당 하나만 유효하다.
  const canAsk = openQuestion === null && !isResting({ recentQuestions, now });
  if (goals.length === 0) {
    return canAsk ? { kind: 'ASK_FOR_GOALS' } : { kind: 'SKIP' };
  }

  const todayUtc = plainDateToUtcDate(todayInKst(now));
  const recentSince =
    now.getTime() - GOAL_CHECKIN_RECENT_DAYS * MILLISECONDS_PER_DAY;
  const staleGoals: StaleGoal[] = [];
  const tasks: TaskGoalStatus[] = [];
  const directions: ProductGoalRecord[] = [];

  for (const goal of goals) {
    const daysLeft = daysUntil(goal.dueDate, todayUtc);
    if (daysLeft !== null && daysLeft < 0) {
      staleGoals.push({
        goal,
        reason: { kind: 'OVERDUE', daysOverdue: -daysLeft },
      });
      continue;
    }
    if (goal.kind === 'DIRECTION') {
      directions.push(goal);
      continue;
    }
    const linked = (mergedPullRequests ?? []).filter((work) =>
      isLinkedToGoal(goal, work.title),
    );
    const forgotten = findForgotten({ goal, linked, mergedPullRequests, now });
    if (forgotten !== null) {
      staleGoals.push({ goal, reason: forgotten });
      continue;
    }
    tasks.push({
      goal,
      daysLeft,
      recentPullRequestNumbers: linked
        .filter((work) => Date.parse(work.mergedAt) >= recentSince)
        .map((work) => work.number),
    });
  }

  const activeTaskCount = goals.filter((goal) => goal.kind === 'TASK').length;
  return {
    kind: 'CHECKIN',
    tasks,
    staleGoals,
    directions,
    drawOutDirection:
      activeTaskCount === 0 && canAsk ? latestOf(directions) : null,
    mergedLookupAvailable: mergedPullRequests !== null,
  };
};

// 머지 조회를 못 했으면 판정하지 않는다 — 못 본 것을 "작업 없음" 으로 읽으면 멀쩡한 목표에 [닫기] 가 붙는다.
// 만든 지 창보다 짧은 목표도 아직 묻지 않는다.
const findForgotten = ({
  goal,
  linked,
  mergedPullRequests,
  now,
}: {
  goal: ProductGoalRecord;
  linked: MergedWork[];
  mergedPullRequests: MergedWork[] | null;
  now: Date;
}): StaleReason | null => {
  if (mergedPullRequests === null || linked.length > 0) {
    return null;
  }
  const idleDays = Math.floor(
    (now.getTime() - goal.createdAt.getTime()) / MILLISECONDS_PER_DAY,
  );
  if (idleDays < FORGOTTEN_GOAL_DAYS) {
    return null;
  }
  return { kind: 'FORGOTTEN' };
};

// 최근 질문이 연달아 무응답이면 마지막 질문 뒤 일정 기간 쉰다. 거절("없어")도 응답으로 친다.
const isResting = ({
  recentQuestions,
  now,
}: {
  recentQuestions: GoalQuestionRecord[];
  now: Date;
}): boolean => {
  const latest = recentQuestions.slice(0, UNANSWERED_QUESTIONS_BEFORE_REST);
  if (
    latest.length < UNANSWERED_QUESTIONS_BEFORE_REST ||
    !latest.every(isUnanswered)
  ) {
    return false;
  }
  return (
    now.getTime() - latest[0].createdAt.getTime() <
    QUESTION_REST_DAYS * MILLISECONDS_PER_DAY
  );
};

const isUnanswered = (question: GoalQuestionRecord): boolean =>
  question.previewId === null &&
  question.criterionAskedAt === null &&
  question.closeReason === null;

const latestOf = (goals: ProductGoalRecord[]): ProductGoalRecord | null =>
  goals.reduce<ProductGoalRecord | null>(
    (latest, goal) =>
      latest === null || goal.createdAt > latest.createdAt ? goal : latest,
    null,
  );

const daysUntil = (dueDate: Date | null, todayUtc: Date): number | null => {
  if (dueDate === null) {
    return null;
  }
  return Math.round(
    (dueDate.getTime() - todayUtc.getTime()) / MILLISECONDS_PER_DAY,
  );
};
