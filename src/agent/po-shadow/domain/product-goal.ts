import { parseDueDate } from '../../../schedule/domain/parse-due-date';
import { PlainDate } from '../../../schedule/domain/schedule.type';

// 활성 목표 상한. 선언 검사·applier 재검사·안내 문구가 모두 이 값 하나를 읽는다 — 숫자를 따로
// 적으면 한쪽만 바뀌었을 때 "3개까지" 라고 안내하면서 4개째를 저장하게 된다.
export const MAX_ACTIVE_PRODUCT_GOALS = 3;
// 붙은 진행 없이 이 일수가 지나면 "아직 유효한가요?" 를 묻는다.
export const STALE_GOAL_DAYS = 30;
// 기한까지 이 일수 이하이고 붙은 열린 항목이 있으면 GOAL_DEADLINE_RISK 를 낸다. 임의값이다.
export const GOAL_DEADLINE_RISK_DAYS = 7;

export interface ProductGoalRecord {
  id: number;
  slackUserId: string;
  title: string;
  successCriterion: string;
  keywords: string[];
  // @db.Date 라 UTC 자정으로 온다.
  dueDate: Date | null;
  closedAt: Date | null;
  createdAt: Date;
}

// 저장 전 목표 초안. 확인 카드 payload 로 그대로 실리므로 JSON 으로 왕복 가능한 값만 둔다.
export interface ProductGoalDraft {
  title: string;
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
  | 'UNMEASURABLE_CRITERION'
  | 'MISSING_KEYWORDS'
  | 'UNREADABLE_DUE_DATE'
  | 'ACTIVE_LIMIT_REACHED';

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

// ponytail: 판정 가능성을 "숫자 또는 완료형 낱말" 로만 본다. "응답 품질을 사용자 불만 없게" 처럼
// 숫자·표지 없이도 판정 가능한 문장은 되물음을 받는다 — 되묻기 한 번이 비용이고, 반대로 "개선하기" 가
// 저장되는 쪽은 목표가 영원히 안 끝난다. 오탐이 잦으면 표지 목록을 늘린다.
const COMPLETION_MARKER =
  /(출시|배포|머지|완료|종료|전환|제거|폐지|삭제|이관|통과|오픈|런칭|릴리[즈스]|마감|승인|계약|도입|적용|이하|이상|미만|초과|없음)/;
const DIGIT = /\d/;

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
  activeGoalCount,
  dueDateUnreadable = false,
}: {
  draft: ProductGoalDraft;
  activeGoalCount: number;
  dueDateUnreadable?: boolean;
}): GoalDeclarationProblem | null => {
  if (draft.title.trim().length === 0) {
    return 'MISSING_TITLE';
  }
  if (draft.successCriterion === null || draft.successCriterion.trim() === '') {
    return 'MISSING_CRITERION';
  }
  if (!isMeasurableCriterion(draft.successCriterion)) {
    return 'UNMEASURABLE_CRITERION';
  }
  if (draft.keywords.length === 0) {
    return 'MISSING_KEYWORDS';
  }
  if (dueDateUnreadable) {
    return 'UNREADABLE_DUE_DATE';
  }
  if (activeGoalCount >= MAX_ACTIVE_PRODUCT_GOALS) {
    return 'ACTIVE_LIMIT_REACHED';
  }
  return null;
};

export const isMeasurableCriterion = (criterion: string): boolean => {
  const trimmed = criterion.trim();
  return (
    trimmed.length > 0 &&
    (DIGIT.test(trimmed) || COMPLETION_MARKER.test(trimmed))
  );
};

// 작업 제목이 목표에 붙었는지. 대소문자는 무시한다(키워드에 영문 식별자가 섞인다).
export const isLinkedToGoal = (
  goal: Pick<ProductGoalRecord, 'keywords'>,
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
      title: segments.title,
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

const extractTitleKeywords = (title: string): string[] =>
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

const isDraft = (value: unknown): value is ProductGoalDraft => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.title === 'string' &&
    (record.successCriterion === null ||
      typeof record.successCriterion === 'string') &&
    Array.isArray(record.keywords) &&
    record.keywords.every((keyword) => typeof keyword === 'string') &&
    (record.dueDate === null ||
      (typeof record.dueDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(record.dueDate)))
  );
};
