import {
  GithubIssue,
  GithubPullRequest,
  GithubPullRequestSummary,
} from '../../../github/domain/github.type';
import { WaitingItem } from '../../../github/domain/pr-engagement.type';
import { DailyPlan, TaskItem } from '../../pm/domain/pm-agent.type';
import { PoShadowContext, ReportedFactState } from './po-shadow.type';

export type PlanRealityFactKind =
  | 'PLANNED_MERGED'
  | 'PLANNED_STALLED'
  | 'PLANNED_NOT_FOUND'
  | 'PLANNED_UNVERIFIABLE'
  | 'UNPLANNED_ASSIGNED'
  // 본인이 연 계획 밖 항목. 근거 줄에는 남기되 검토를 켜지 않고 지적 대상도 아니다.
  | 'UNPLANNED_SELF_AUTHORED'
  | 'UNPLANNED_MENTION'
  // 회수(직전 회차 지적의 종결 상태) — 아래 네 종류가 전수를 덮는다.
  | 'FINDING_MERGED'
  | 'FINDING_UNMOVED'
  | 'FINDING_ABANDONED'
  | 'FINDING_UNASSIGNED'
  // 제품 목표(단계 3) — 활성 목표가 있을 때만 나온다. 성공 기준 충족 여부는 사실이 아니라
  // judgments 층이다(자연어 기준을 코드가 잴 수 없다).
  | 'GOAL_UNSERVED'
  | 'GOAL_DEADLINE_RISK';

export interface PlanRealityFact {
  id: string;
  kind: PlanRealityFactKind;
  label: string;
  detail: string;
  url?: string;
  // 같은 사실이 악화된 단계. 회수 사실은 최초 지적 후 몇 번째 7일 구간인지, 목표 기한 위험은
  // 임박·당일·초과 단계다. 다음 회차가 이 값이 오른 것을 "새로 바뀐 사실" 로 본다(findNovelFactIds).
  // `detail` 은 렌더 전용이므로 단계를 문자열에서 되읽지 않는다(문구를 손보면 조용히 리셋되는 구조를 피한다).
  sequence?: number;
  // FINDING_UNMOVED 전용 — 최초 지적 시각(ISO). 다음 회차가 이어받아 나이를 고정한다(ReportedFactState).
  firstReportedAt?: string;
}

// 직전 회차가 지적한 키 하나. `firstReportedAt` 은 그 키를 **가장 처음** 지적한 회차의 endedAt 이다
// — sequence 가 그 시각에서 파생되므로 dedupe 는 최초 회차를 남긴다.
export interface PriorFinding {
  key: string;
  firstReportedAt: Date;
}

// 회수 대상 키의 GitHub 종결 상태. null 은 조회 실패(또는 이슈 번호라 PR 이 아님)를 뜻한다.
export interface RecoveryLifecycle {
  state: 'open' | 'closed';
  mergedAt: string | null;
  // 이슈에는 머지 개념이 없다. 종결을 "머지 없이 닫힘" 이라 부르면 거짓이 되므로 문구를 가른다.
  isPullRequest: boolean;
}

export interface FindingRecoveryResult {
  facts: PlanRealityFact[];
  movementTally: {
    merged: number;
    // FINDING_UNMOVED 개수 + 7일 미만이라 사실을 만들지 않은 키 수.
    unresolved: number;
    abandoned: number;
    unassigned: number;
  };
  // 키 추출 실패 + 조회 실패. 카드의 "(대조 불가 N건)" 과 주간 지표가 같은 값을 쓴다.
  uncomparableCount: number;
  totalPriorKeys: number;
  // 이번 회차에 실제로 reason 을 뺀 키. 사유가 원래 없던 키는 넣지 않는다 — 철회 규칙의 발화를
  // detail 문자열에서 되읽으면 "철회" 와 "사유 없음" 이 구분되지 않는다.
  reasonWithdrawnKeys: string[];
  // 담당 조회 자체가 실패해 전건을 회수하지 못했는지. 이 경우 수집기 라벨이 이미 있으므로
  // 회수 쪽에서 라벨을 겹쳐 달지 않는다.
  assignedLookupFailed: boolean;
}

interface ActualGithubItem {
  key: string;
  number: number;
  title: string;
  url: string;
  type: 'ISSUE' | 'PULL_REQUEST';
  authorLogin?: string;
}

const MISMATCH_KINDS = new Set<PlanRealityFactKind>([
  'PLANNED_STALLED',
  'PLANNED_NOT_FOUND',
  'UNPLANNED_ASSIGNED',
  'UNPLANNED_MENTION',
  // GOAL_UNSERVED 는 넣지 않는다 — 잡무·버그 수정 때문에 거의 매일 나와 매일 검토가 켜진다.
  'GOAL_DEADLINE_RISK',
]);

// 회수 대조가 가능한 fact id 접두어. mention 은 재발화하지 않고 failed 는 id 에 시각이 들어가
// 비결정적이며 unverifiable 은 GitHub 항목이 아니다(실측: 전부 rollover:N).
const COMPARABLE_FACT_PREFIXES = new Set([
  'merged',
  'stalled',
  'not-found',
  'unplanned',
]);

// FINDING_UNMOVED 를 만들기 시작하는 경과 구간(7일). 실측(2026-09-10) 상 지적 키 13개 중
// 4개가 7일 이상 지속됐고 2개가 14일 이상이었다 — 상위 3분의 1을 가르는 지점이다.
export const RECOVERY_SEQUENCE_DAYS = 7;
// 미이동이 이 구간 수 이상이면 검토를 켠다(14일).
export const UNMOVED_REVIEW_SEQUENCE = 2;
// 미이동이 이 구간 수 이상이면 detail 에서 reason 을 뺀다(21일) — 무시당한 권고를 계속 되살리지
// 않는다. 실측(2026-09-10) 상 발화 0건이라 2026-12 에 재평가해 여전히 0이면 삭제 후보다.
export const UNMOVED_REASON_WITHDRAW_SEQUENCE = 3;

// 회수 경로가 원장에 남기는 열화 라벨. 주간 지표(`weekly-summary`)가 대조 불가 회차 비율을
// 여기서 읽으므로 usecase 로컬 상수로 두지 않는다.
export const DEGRADED_PRIOR_REPORT = '직전 PO 보고';
export const DEGRADED_UNCOMPARABLE = '직전 지적 대조 불가';

const MILLISECONDS_PER_DAY = 86_400_000;
const UNMOVED_FACT_ID_PREFIX = 'finding-unmoved';

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

    // 부재를 근거로 삼으려면 담당·머지 두 목록을 모두 실제로 봤어야 한다. 둘 중 하나라도
    // 못 본 회차에 미발견을 만들면, 계획대로 끝낸 일이 이상 신호로 뒤집힌다.
    // 못 본 사실 자체는 context.degradedSources 로 카드에 따로 드러난다.
    if (!context.assignedTasks || !context.mergedLookupAvailable) {
      continue;
    }
    facts.push(buildNotFoundFact(task));
  }

  for (const actualItem of actualItems) {
    if (plannedActualKeys.has(actualItem.key)) {
      continue;
    }
    // 본인이 연 항목은 계획 뒤에 본인이 시작한 일이다. 실측(10-13~22) 상 새 계획 밖 항목
    // 16건이 전부 본인 PR 이었다 — 자기 행동을 자기에게 "계획과 다르다" 고 알리지 않는다.
    // GitHub login 은 대소문자를 가리지 않는다.
    const selfAuthored =
      context.ownGithubLogin !== null &&
      actualItem.authorLogin?.toLowerCase() ===
        context.ownGithubLogin.toLowerCase();
    facts.push(
      selfAuthored
        ? buildSelfAuthoredFact(actualItem)
        : buildUnplannedAssignedFact(actualItem),
    );
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

  return facts;
};

// 검토(모델 호출)를 켤지. **새로 바뀐** 사실만 본다 — 같은 상태를 매일 다시 띄우면(실측 10-13~22:
// 머지 없이 닫힌 PR 이 닷새 연속 헤드라인) 어긋남 판정이 "어긋난 상태가 있다" 로 바뀌어 매일 켜진다.
// 이 함수의 프로덕션 호출부는 usecase 한 곳뿐이다.
export const hasPlanRealityMismatch = (
  facts: PlanRealityFact[],
  novelFactIds: Set<string>,
): boolean => {
  return facts.some(
    (fact) => novelFactIds.has(fact.id) && isMismatchFact(fact),
  );
};

// kind 만 보는 정적 Set 으로는 "2구간 이상일 때만" 을 표현할 수 없어 FINDING_UNMOVED 만 술어로 뺀다.
const isMismatchFact = (fact: PlanRealityFact): boolean =>
  MISMATCH_KINDS.has(fact.kind) ||
  // 포기는 대표가 알아야 할 사건이다. 새로 바뀐 사실만 보므로 처음 확인한 회차에 한 번 켜진다.
  fact.kind === 'FINDING_ABANDONED' ||
  (fact.kind === 'FINDING_UNMOVED' &&
    (fact.sequence ?? 0) >= UNMOVED_REVIEW_SEQUENCE);

// 직전 회차 사실표에 없던 사실, 또는 있었지만 구간(sequence)이 올라간 사실. 직전 상태를 모르면
// (첫 회차·기록 전 회차) 전부 새 것으로 본다 — 모르는 채로 조용히 넘기는 쪽이 더 위험하다.
export const findNovelFactIds = (
  facts: PlanRealityFact[],
  previousStates: ReportedFactState[] | null,
): Set<string> => {
  if (previousStates === null) {
    return new Set(facts.map((fact) => fact.id));
  }
  const previousById = new Map(
    previousStates.map((state) => [state.id, state]),
  );
  return new Set(
    facts
      .filter((fact) => {
        const previous = previousById.get(fact.id);
        return (
          previous === undefined ||
          (fact.sequence ?? 0) > (previous.sequence ?? 0)
        );
      })
      .map((fact) => fact.id),
  );
};

interface ToReportedFactStatesOptions {
  // 대표에게 실제로 전달되지 않은 이번 회차의 새 사실. 직전 상태를 그대로 두어 다음 회차에 다시 새 것으로
  // 보이게 한다 — 알리지 못한 지적이 "이미 알림" 으로 묻히지 않게(근거 검증에서 지적이 전부 버려진 회차 등).
  undeliveredFactIds?: Set<string>;
  previousStates?: ReportedFactState[] | null;
  // 조회가 실패한 회차에만 넘긴다. 그 회차는 실패한 소스의 사실을 만들지 못하는데, 빈자리를 그대로
  // 저장하면 다음 회차에 같은 사실이 전부 새 것으로 보여 한꺼번에 다시 켜지고 미이동 나이도 끊긴다.
  carryPreviousStates?: boolean;
}

export const toReportedFactStates = (
  facts: PlanRealityFact[],
  {
    undeliveredFactIds = new Set(),
    previousStates = null,
    carryPreviousStates = false,
  }: ToReportedFactStatesOptions = {},
): ReportedFactState[] => {
  const previousById = new Map(
    (previousStates ?? []).map((state) => [state.id, state]),
  );
  const current = facts.flatMap((fact): ReportedFactState[] => {
    if (undeliveredFactIds.has(fact.id)) {
      const previous = previousById.get(fact.id);
      return previous ? [previous] : [];
    }
    return [toReportedFactState(fact)];
  });
  if (!carryPreviousStates) {
    return current;
  }
  const currentIds = new Set(facts.map((fact) => fact.id));
  return [
    ...current,
    ...(previousStates ?? []).filter((state) => !currentIds.has(state.id)),
  ];
};

const toReportedFactState = (fact: PlanRealityFact): ReportedFactState => ({
  id: fact.id,
  ...(fact.sequence !== undefined ? { sequence: fact.sequence } : {}),
  ...(fact.firstReportedAt !== undefined
    ? { firstReportedAt: fact.firstReportedAt }
    : {}),
});

// 직전 PO 회차의 리포트(output)에서 읽는다. 필드가 없으면(기록 전 회차) null — "비교 기준 없음" 이다.
export const readReportedFactStates = (
  report: unknown,
): ReportedFactState[] | null => {
  if (typeof report !== 'object' || report === null) {
    return null;
  }
  const value = (report as Record<string, unknown>).reportedFacts;
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter(isReportedFactState);
};

const isReportedFactState = (value: unknown): value is ReportedFactState => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    (record.sequence === undefined || typeof record.sequence === 'number') &&
    (record.firstReportedAt === undefined ||
      typeof record.firstReportedAt === 'string')
  );
};

// 미이동 지적의 최초 시각을 직전 회차에서 이어받는다. 30일 원장 창만으로 재구성하면 최초 인용이 창
// 밖으로 밀릴 때 나이가 줄어든다(실측: puppeteer#52 가 21일↔28일을 오감, #153 은 28일→7일).
// 창에서 사라진 키도 직전 회차가 미이동으로 들고 있었으면 계속 추적한다.
export const carryForwardPriorFindings = (
  priorFindings: PriorFinding[],
  previousStates: ReportedFactState[] | null,
): PriorFinding[] => {
  const firstSeen = new Map(
    priorFindings.map((prior) => [prior.key, prior.firstReportedAt]),
  );
  for (const state of previousStates ?? []) {
    if (
      !state.id.startsWith(`${UNMOVED_FACT_ID_PREFIX}:`) ||
      state.firstReportedAt === undefined
    ) {
      continue;
    }
    const carried = new Date(state.firstReportedAt);
    if (Number.isNaN(carried.getTime())) {
      continue;
    }
    const key = state.id.slice(UNMOVED_FACT_ID_PREFIX.length + 1);
    const known = firstSeen.get(key);
    if (known === undefined || carried < known) {
      firstSeen.set(key, carried);
    }
  }
  return [...firstSeen.entries()].map(([key, firstReportedAt]) => ({
    key,
    firstReportedAt,
  }));
};

// 회수 대상 키를 직전 회차들의 지적에서 뽑는다. 같은 키는 **가장 처음** 지적한 회차만 남긴다.
// 접두어 판별만으로 충분하다 — 실측상 not-found 도 정규형 owner/repo#N 이고,
// unverifiable 은 전부 rollover:N 이라 GitHub 항목이 아니다.
export const extractPriorFindingKeys = (
  runs: { factIds: string[]; endedAt: Date }[],
): PriorFinding[] => {
  const firstSeen = new Map<string, Date>();
  for (const run of runs) {
    for (const factId of run.factIds) {
      const key = toComparableKey(factId);
      if (key === null) {
        continue;
      }
      const known = firstSeen.get(key);
      if (known === undefined || run.endedAt < known) {
        firstSeen.set(key, run.endedAt);
      }
    }
  }
  return [...firstSeen.entries()].map(([key, firstReportedAt]) => ({
    key,
    firstReportedAt,
  }));
};

// 대조 가능한 키만 통과시킨다. 통과 못 한 지적은 판정하지 않고 "대조 불가" 로 센다.
export const toComparableKey = (factId: string): string | null => {
  const separatorIndex = factId.indexOf(':');
  if (separatorIndex === -1) {
    return null;
  }
  const prefix = factId.slice(0, separatorIndex);
  if (!COMPARABLE_FACT_PREFIXES.has(prefix)) {
    return null;
  }
  const rest = factId.slice(separatorIndex + 1);
  return NATURAL_GITHUB_KEY_PATTERN.test(rest) ? rest : null;
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
  ...(issue.authorLogin ? { authorLogin: issue.authorLogin } : {}),
});

const buildActualPullRequest = (
  pullRequest: GithubPullRequest,
): ActualGithubItem => ({
  key: `${pullRequest.repo}#${pullRequest.number}`,
  number: pullRequest.number,
  title: pullRequest.title,
  url: pullRequest.url,
  type: 'PULL_REQUEST',
  ...(pullRequest.authorLogin ? { authorLogin: pullRequest.authorLogin } : {}),
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
  // 담당 조회는 열린 항목만 돌려주고 머지 조회는 PR 만 본다. 그래서 닫힌 이슈는 여기로
  // 떨어질 수 있다 — 단정하지 말고 두 가능성을 그대로 적는다.
  detail: '담당·머지 목록에 없음 (닫혔거나 아직 안 만듦)',
  ...(task.url ? { url: task.url } : {}),
});

// 철회한 키는 계획 대조 쪽 PLANNED_STALLED 에서도 reason 을 뺀다. 그 fact 의 detail 이 같은
// waitingItem.reason 이라, FINDING_UNMOVED 에서만 빼면 같은 권고 재료가 프롬프트에 남는다.
// 철회 판정은 buildFindingRecoveryFacts 한 곳이 하고 여기서는 그 결과만 따른다.
export const withdrawStalledReasons = (
  facts: PlanRealityFact[],
  reasonWithdrawnKeys: string[],
): PlanRealityFact[] => {
  const withdrawnIds = new Set(
    reasonWithdrawnKeys.map((key) => `stalled:${key}`),
  );
  return facts.map((fact) =>
    withdrawnIds.has(fact.id) ? { ...fact, detail: '대기 중' } : fact,
  );
};

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

// id 접두어가 회수 대조 대상(COMPARABLE_FACT_PREFIXES)이 아니므로 인용돼도 다음 회차 지적으로 추적되지 않는다.
const buildSelfAuthoredFact = (
  actualItem: ActualGithubItem,
): PlanRealityFact => ({
  id: `self-authored:${actualItem.key}`,
  kind: 'UNPLANNED_SELF_AUTHORED',
  label: truncateLabel(actualItem.title),
  detail: '계획 뒤 직접 연 항목',
  url: actualItem.url,
});

interface BuildFindingRecoveryFactsInput {
  priorFindings: PriorFinding[];
  context: PoShadowContext;
  // key -> 종결 상태. 값이 null 이면 그 키만 조회에 실패한 것이다(다른 키에 전파하지 않는다).
  // 담당 목록에 살아 있는 키는 조회 자체를 하지 않으므로 여기에 없다.
  lifecycles: Map<string, RecoveryLifecycle | null>;
  now: Date;
}

// 직전 회차 지적이 어떻게 끝났는지 판정한다. 담당 목록 + 키별 종결 상태만 보고 kind 는 보지 않는다
// — 그날의 PM 계획에서 생성된 사실에 얹으면 계획이 흔들릴 때 관측이 흔들린다(v3~v5 의 실패).
export const buildFindingRecoveryFacts = ({
  priorFindings,
  context,
  lifecycles,
  now,
}: BuildFindingRecoveryFactsInput): FindingRecoveryResult => {
  const actualItems = collectActualGithubItems(context);
  const assignedKeys = new Set(actualItems.map((item) => item.key));
  // url -> reason. WaitingItem 에 repo/number 가 없어 url 이 유일한 연결 고리다.
  const reasonByKey = new Map(
    actualItems
      .map((item): [string, string] | null => {
        const waiting = context.waitingItems.find(
          (candidate) => candidate.url === item.url,
        );
        return waiting ? [item.key, waiting.reason] : null;
      })
      .filter((entry): entry is [string, string] => entry !== null),
  );
  const facts: PlanRealityFact[] = [];
  const reasonWithdrawnKeys: string[] = [];
  const tally = { merged: 0, unresolved: 0, abandoned: 0, unassigned: 0 };
  let uncomparableCount = 0;

  // 담당 조회가 실패한 회차에는 부재를 근거로 삼을 수 없다 — 전건을 회수하지 않는다.
  // 이 경우 수집기가 이미 `GitHub 담당 목록` 라벨을 붙였으므로 회수 쪽 라벨을 겹쳐 달지 않는다
  // (그래서 uncomparableCount 를 올리지 않고 assignedLookupFailed 로 따로 알린다).
  if (context.assignedTasks === null) {
    return {
      facts: [],
      movementTally: tally,
      uncomparableCount: 0,
      totalPriorKeys: priorFindings.length,
      reasonWithdrawnKeys: [],
      assignedLookupFailed: true,
    };
  }

  for (const prior of priorFindings) {
    if (assignedKeys.has(prior.key)) {
      const sequence = calculateRecoverySequence({
        firstReportedAt: prior.firstReportedAt,
        now,
      });
      tally.unresolved += 1;
      // 7일 미만은 아직 정상 진행이라 사실을 만들지 않는다. 다만 카드의 "미해결" 에는 센다
      // — 그래서 표시된 미해결 수와 FINDING_UNMOVED 개수는 다를 수 있다.
      if (sequence >= 1) {
        // 철회 구간에 들면 reason 을 싣지 않는다 — 모델이 쓸 재료가 사라져 권고 문장도 사라진다.
        const reason = reasonByKey.get(prior.key) ?? null;
        const withdrawn =
          reason !== null && sequence >= UNMOVED_REASON_WITHDRAW_SEQUENCE;
        if (withdrawn) {
          reasonWithdrawnKeys.push(prior.key);
        }
        facts.push(
          buildUnmovedFact({
            prior,
            sequence,
            reason: withdrawn ? null : reason,
          }),
        );
      }
      continue;
    }

    const lifecycle = lifecycles.get(prior.key);
    if (lifecycle === undefined || lifecycle === null) {
      uncomparableCount += 1;
      continue;
    }

    if (lifecycle.mergedAt !== null) {
      tally.merged += 1;
      facts.push(buildRecoveryFact(prior, 'FINDING_MERGED', '머지됨'));
      continue;
    }
    if (lifecycle.state === 'closed') {
      // 이슈의 종결도 포기로 센다 — 코드 변경으로 이어지지 않고 닫혔다는 신호가 같다.
      tally.abandoned += 1;
      facts.push(
        buildRecoveryFact(
          prior,
          'FINDING_ABANDONED',
          lifecycle.isPullRequest ? '머지 없이 닫힘' : '이슈가 닫힘',
        ),
      );
      continue;
    }
    // 열려 있는데 담당 목록에 없다 = 담당에서 빠졌다. 일이 된 것이 아니므로 이동률 분모에서 뺀다.
    tally.unassigned += 1;
    facts.push(
      buildRecoveryFact(
        prior,
        'FINDING_UNASSIGNED',
        '담당에서 빠짐 (사유 미확인)',
      ),
    );
  }

  return {
    facts,
    movementTally: tally,
    uncomparableCount,
    totalPriorKeys: priorFindings.length,
    reasonWithdrawnKeys,
    assignedLookupFailed: false,
  };
};

// 최초 지적 시각에서 파생한다. 원장에 카운터를 두지 않으므로 모델의 인용 선택에 의존하지 않는다.
const calculateRecoverySequence = ({
  firstReportedAt,
  now,
}: {
  firstReportedAt: Date;
  now: Date;
}): number => {
  const elapsedDays =
    (now.getTime() - firstReportedAt.getTime()) / MILLISECONDS_PER_DAY;
  return Math.floor(elapsedDays / RECOVERY_SEQUENCE_DAYS);
};

const buildRecoveryFact = (
  prior: PriorFinding,
  kind: RecoveryFactKind,
  detail: string,
): PlanRealityFact => ({
  id: `${RECOVERY_FACT_ID_PREFIX[kind]}:${prior.key}`,
  kind,
  label: toRecoveryLabel(prior.key),
  detail: `지난 지적 — ${detail}`,
  url: toGithubUrl(prior.key),
});

// 회수 label 은 `truncateLabel` 을 쓰지 않는다 — 키가 30자를 넘으면 **번호가 잘려**
// 어느 항목인지 알 수 없게 된다(실측: `schoolbell-e/sbe-api-v5-puppeteer#135` 는 37자).
// owner 를 떼고 `repo#N` 만 남긴다. 전체 경로는 url 로 따라간다.
const toRecoveryLabel = (key: string): string => {
  const slashIndex = key.indexOf('/');
  return slashIndex === -1 ? key : key.slice(slashIndex + 1);
};

// 이슈일 수도 PR 일 수도 있으나 GitHub 은 `/pull/N` 과 `/issues/N` 을 서로 리다이렉트한다.
const toGithubUrl = (key: string): string => {
  const [repo, number] = key.split('#');
  return `https://github.com/${repo}/pull/${number}`;
};

const buildUnmovedFact = ({
  prior,
  sequence,
  reason,
}: {
  prior: PriorFinding;
  sequence: number;
  reason: string | null;
}): PlanRealityFact => {
  const elapsed = `${sequence * RECOVERY_SEQUENCE_DAYS}일째 미이동`;
  return {
    id: `${UNMOVED_FACT_ID_PREFIX}:${prior.key}`,
    kind: 'FINDING_UNMOVED',
    label: toRecoveryLabel(prior.key),
    // reason 은 오늘의 waitingItems 에서 찾는다 — 사실표의 PLANNED_STALLED 존재에 기대지 않는다
    // (그것은 계획 루프 산물이라 계획 변동에 흔들린다).
    detail: reason === null ? elapsed : `${elapsed} — ${reason}`,
    url: toGithubUrl(prior.key),
    sequence,
    firstReportedAt: prior.firstReportedAt.toISOString(),
  };
};

type RecoveryFactKind =
  | 'FINDING_MERGED'
  | 'FINDING_ABANDONED'
  | 'FINDING_UNASSIGNED';

const RECOVERY_FACT_ID_PREFIX: Record<RecoveryFactKind, string> = {
  FINDING_MERGED: 'finding-merged',
  FINDING_ABANDONED: 'finding-abandoned',
  FINDING_UNASSIGNED: 'finding-unassigned',
};
