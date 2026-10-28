import { parseDueDate } from '../../../schedule/domain/parse-due-date';
import { PlainDate } from '../../../schedule/domain/schedule.type';

// 활성 TASK 목표 상한. 선언 검사·applier 재검사·안내 문구가 모두 이 값 하나를 읽는다 — 숫자를 따로
// 적으면 한쪽만 바뀌었을 때 "3개까지" 라고 안내하면서 4개째를 저장하게 된다.
export const MAX_ACTIVE_PRODUCT_GOALS = 3;
export const MAX_ACTIVE_DIRECTION_GOALS = 2;
export const GOAL_PREVIEW_TTL_MS = 60 * 60 * 1_000;
// 기한까지 이 일수 이하이고 붙은 열린 항목이 있으면 GOAL_DEADLINE_RISK 를 낸다. 임의값이다.
export const GOAL_DEADLINE_RISK_DAYS = 7;

export type ProductGoalKind = 'DIRECTION' | 'TASK';

export interface ProductGoalRecord {
  id: number;
  slackUserId: string;
  kind: ProductGoalKind;
  title: string;
  why: string | null;
  successCriterion: string | null;
  keywords: string[];
  // @db.Date 라 UTC 자정으로 온다.
  dueDate: Date | null;
  closedAt: Date | null;
  createdAt: Date;
}

// 저장 전 목표 초안. 확인 카드 payload 로 그대로 실리므로 JSON 으로 왕복 가능한 값만 둔다.
export interface ProductGoalDraft {
  kind: ProductGoalKind;
  title: string;
  why: string | null;
  successCriterion: string | null;
  keywords: string[];
  // YYYY-MM-DD. 없으면 null.
  dueDate: string | null;
}

export type ProductGoalCommand =
  | { kind: 'NONE' }
  | { kind: 'LIST' }
  | { kind: 'CLOSE'; titleQuery: string }
  // 기한 조각이 있는데 날짜로 읽지 못하면 dueDateUnreadable 이 true 다 — 조용히 "기한 없음" 으로
  // 저장하면 사용자가 정한 기한이 사라진다.
  | { kind: 'DECLARE'; draft: ProductGoalDraft; dueDateUnreadable: boolean };

export type GoalDeclarationProblem =
  | 'MISSING_TITLE'
  | 'MISSING_CRITERION'
  | 'MISSING_KEYWORDS'
  | 'UNREADABLE_DUE_DATE'
  // 같은 제목의 활성 목표가 이미 있다. 받아 주면 닫기가 정확 일치 둘을 모호하다고 거절해
  // 어떤 자연어로도 닫을 수 없는 목표가 슬롯을 영구히 차지한다(#773 리뷰).
  | 'DUPLICATE_TITLE'
  | 'ACTIVE_LIMIT_REACHED'
  | 'DIRECTION_LIMIT_REACHED';

const SLACK_MENTION = /<@[^>]+>/g;
const DECLARE_PATTERN = /(?:분기|제품)\s*목표\s*(?:는|은|:)\s*([\s\S]+)$/;
const LIST_PATTERN = /목표\s*(?:목록|리스트)?\s*(?:보여|알려|조회|뭐)/;
const CLOSE_PATTERN =
  /^([\s\S]*?)\s*목표\s*(?:를|을)?\s*(?:닫아|닫자|닫기|종료|끝내)/;

const SEGMENT_MARKERS = {
  criterion: /달성\s*기준\s*(?:은|는|:)?\s*/,
  dueDate: /기한\s*(?:은|는|:)?\s*/,
  keywords: /키워드\s*(?:는|은|:)?\s*/,
} as const;
type SegmentName = keyof typeof SEGMENT_MARKERS;

const KEYWORD_SEPARATOR = /[,，、·/]+/;
const TITLE_WORD_SEPARATOR = /[\s,，、·/()[\]「」"'“”]+/;
// 제목에서 키워드를 뽑을 때 버리는 낱말. 어느 목표 제목에나 들어가 아무 작업에나 붙는다.
const GENERIC_TITLE_WORDS = new Set([
  '기능',
  '작업',
  '개선',
  '출시',
  '완료',
  '목표',
  '위한',
  '관련',
]);
const MIN_KEYWORD_LENGTH = 2;

export const parseProductGoalCommand = (
  text: string,
  today: PlainDate,
): ProductGoalCommand => {
  const plain = text.replace(SLACK_MENTION, ' ').replace(/\s+/g, ' ').trim();
  const declared = plain.match(DECLARE_PATTERN);
  if (declared) {
    return parseDeclaration(declared[1], today);
  }
  const closed = plain.match(CLOSE_PATTERN);
  if (closed) {
    return { kind: 'CLOSE', titleQuery: stripQuotes(closed[1]) };
  }
  if (LIST_PATTERN.test(plain)) {
    return { kind: 'LIST' };
  }
  return { kind: 'NONE' };
};

// 선언 검사와 applier 재검사가 같이 부른다. 문제가 없으면 null.
export const findGoalDeclarationProblem = ({
  draft,
  activeGoals,
  dueDateUnreadable = false,
}: {
  draft: ProductGoalDraft;
  activeGoals: { title: string; kind: ProductGoalKind }[];
  dueDateUnreadable?: boolean;
}): GoalDeclarationProblem | null => {
  if (draft.title.trim().length === 0) {
    return 'MISSING_TITLE';
  }
  const title = normalizeTitle(draft.title);
  if (activeGoals.some((goal) => normalizeTitle(goal.title) === title)) {
    return 'DUPLICATE_TITLE';
  }
  if (draft.kind === 'DIRECTION') {
    const directionCount = activeGoals.filter(
      (goal) => goal.kind === 'DIRECTION',
    ).length;
    return directionCount >= MAX_ACTIVE_DIRECTION_GOALS
      ? 'DIRECTION_LIMIT_REACHED'
      : null;
  }
  // 기준이 "있는지" 만 본다. 그 문장으로 끝을 알 수 있는지는 뜻을 읽어야 하는 판단이라 코드가 하지
  // 않는다 — 확인 카드에 기준이 그대로 실리고 사람이 보고 승인한다. 낱말 목록으로 거르던 시절에는
  // "새 직장에서 근무를 시작한다" 처럼 끝이 분명한 기준도 떨어졌다(2026-10-27 실측).
  if (draft.successCriterion === null || draft.successCriterion.trim() === '') {
    return 'MISSING_CRITERION';
  }
  if (draft.keywords.length === 0) {
    return 'MISSING_KEYWORDS';
  }
  if (dueDateUnreadable) {
    return 'UNREADABLE_DUE_DATE';
  }
  const taskCount = activeGoals.filter((goal) => goal.kind === 'TASK').length;
  if (taskCount >= MAX_ACTIVE_PRODUCT_GOALS) {
    return 'ACTIVE_LIMIT_REACHED';
  }
  return null;
};

// 작업 제목이 목표에 붙었는지. 대소문자는 무시한다(키워드에 영문 식별자가 섞인다).
export const isLinkedToGoal = (
  goal: { keywords: string[] },
  title: string,
): boolean => {
  const lowered = title.toLowerCase();
  return goal.keywords.some((keyword) =>
    lowered.includes(keyword.toLowerCase()),
  );
};

// 닫을 목표를 제목으로 찾는다. 정확히 같은 제목이 있으면 그것 하나만 돌려준다 —
// "파기" 와 "파기 2차" 가 함께 있을 때 "파기" 를 닫으려는 사람을 되묻게 하지 않는다.
export const matchGoalsByTitle = (
  goals: ProductGoalRecord[],
  titleQuery: string,
): ProductGoalRecord[] => {
  const query = normalizeTitle(titleQuery);
  if (query.length === 0) {
    return [];
  }
  const exact = goals.filter((goal) => normalizeTitle(goal.title) === query);
  if (exact.length > 0) {
    return exact;
  }
  return goals.filter((goal) => normalizeTitle(goal.title).includes(query));
};

export const toPlainDateString = (date: PlainDate): string =>
  `${date.year}-${pad(date.month)}-${pad(date.day)}`;

const parseDeclaration = (
  body: string,
  today: PlainDate,
): ProductGoalCommand => {
  const segments = splitSegments(body);
  const dueDate =
    segments.dueDate === undefined
      ? null
      : parseDueDate(segments.dueDate, today);
  const keywords =
    segments.keywords === undefined
      ? extractTitleKeywords(segments.title)
      : splitKeywords(segments.keywords);
  return {
    kind: 'DECLARE',
    draft: {
      kind: 'TASK',
      title: segments.title,
      why: null,
      successCriterion: segments.criterion ?? null,
      keywords,
      dueDate: dueDate === null ? null : toPlainDateString(dueDate),
    },
    dueDateUnreadable: segments.dueDate !== undefined && dueDate === null,
  };
};

type DeclarationSegments = { title: string } & Partial<
  Record<SegmentName, string>
>;

// 표지가 나온 위치로 본문을 자른다. 각 조각은 자기 표지 뒤부터 다음 표지 앞까지다.
const splitSegments = (body: string): DeclarationSegments => {
  const found = (Object.keys(SEGMENT_MARKERS) as SegmentName[])
    .map((name) => {
      const matched = SEGMENT_MARKERS[name].exec(body);
      return matched
        ? { name, start: matched.index, end: matched.index + matched[0].length }
        : null;
    })
    .filter((marker): marker is FoundMarker => marker !== null)
    .sort((left, right) => left.start - right.start);

  const titleEnd = found.length > 0 ? found[0].start : body.length;
  const segments: DeclarationSegments = {
    title: cleanSegment(body.slice(0, titleEnd)),
  };
  found.forEach((marker, index) => {
    const next = found[index + 1];
    const value = cleanSegment(
      body.slice(marker.end, next === undefined ? body.length : next.start),
    );
    if (value.length > 0) {
      segments[marker.name] = value;
    }
  });
  return segments;
};

interface FoundMarker {
  name: SegmentName;
  start: number;
  end: number;
}

const cleanSegment = (value: string): string =>
  value.replace(/^[\s,，.、:]+|[\s,，.、]+$/g, '');

const splitKeywords = (value: string): string[] =>
  dedupe(
    value
      .split(KEYWORD_SEPARATOR)
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 0),
  );

export const extractTitleKeywords = (title: string): string[] =>
  dedupe(
    title
      .split(TITLE_WORD_SEPARATOR)
      .map((word) => word.trim())
      .filter(
        (word) =>
          word.length >= MIN_KEYWORD_LENGTH && !GENERIC_TITLE_WORDS.has(word),
      ),
  );

const dedupe = (values: string[]): string[] => [...new Set(values)];

const stripQuotes = (value: string): string =>
  value.replace(/["'“”「」]/g, '').trim();

const normalizeTitle = (value: string): string =>
  stripQuotes(value).replace(/\s+/g, ' ').toLowerCase();

const pad = (value: number): string => String(value).padStart(2, '0');

export type ProductGoalPreviewPayload =
  | { action: 'CREATE'; draft: ProductGoalDraft }
  | { action: 'CLOSE'; goalId: number; title: string };

// 카드 payload 는 DB 를 한 바퀴 돌아온 JSON 이라 applier 가 형태부터 다시 확인한다.
export const isProductGoalPreviewPayload = (
  value: unknown,
): value is ProductGoalPreviewPayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.action === 'CLOSE') {
    return (
      Number.isSafeInteger(record.goalId) && typeof record.title === 'string'
    );
  }
  return record.action === 'CREATE' && isDraft(record.draft);
};

export const readProductGoalDraft = (
  value: unknown,
): ProductGoalDraft | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind === undefined ? 'TASK' : record.kind;
  const why = record.why === undefined ? null : record.why;
  if (kind !== 'TASK' && kind !== 'DIRECTION') {
    return null;
  }
  if (why !== null && typeof why !== 'string') {
    return null;
  }
  if (typeof record.title !== 'string') {
    return null;
  }
  if (
    record.successCriterion !== null &&
    typeof record.successCriterion !== 'string'
  ) {
    return null;
  }
  if (
    !Array.isArray(record.keywords) ||
    !record.keywords.every((keyword) => typeof keyword === 'string')
  ) {
    return null;
  }
  if (
    record.dueDate !== null &&
    (typeof record.dueDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.dueDate))
  ) {
    return null;
  }
  return {
    kind,
    title: record.title,
    why,
    successCriterion: record.successCriterion,
    keywords: record.keywords,
    dueDate: record.dueDate,
  };
};

const isDraft = (value: unknown): value is ProductGoalDraft =>
  readProductGoalDraft(value) !== null;
