import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { extractJsonObjectText } from '../../../../common/util/llm-json-extract.util';
import { CareerMateException } from '../career-mate.exception';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';
import { ProjectGroup, ProjectGroupNaming } from '../project-group';

export const PROJECT_GROUP_SYNTH_SYSTEM_PROMPT = `너는 개발자의 작업 묶음에 "포트폴리오 프로젝트 이름과 소개"를 붙이는 전문가다.
입력은 저장소 단위로 묶인 작업 목록이다. 각 묶음에 key 가 있다.
아래 JSON 객체 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

규칙:
- 입력 묶음 전부에 대해, 입력에 있는 key 를 그대로 써서 한 항목씩 만든다. key 를 바꾸거나 지어내지 않는다.
- title 은 사람이 포트폴리오 목록에서 읽을 프로젝트 이름이다. 30자 이내, 무엇을 만든 것인지 드러나게.
  작업 하나의 제목을 그대로 베끼지 않는다 — 묶음 전체를 대표해야 한다.
- summary 는 한 문장. 이 프로젝트가 무엇인지.
- problem 은 1~3문장. 이 묶음의 작업들이 반복해서 다룬 문제.
- result 는 1~3문장. 그 작업들로 무엇이 달라졌는지.
- highlights 는 목록 카드에 얹을 성과 줄이다. 0~3개. 각 줄은 40자 이내로 짧게.
  - **입력 작업 목록에 실제로 적힌 수치가 있는 것만 쓴다.** 수치가 없는 묶음은 빈 배열([])로 둔다.
    없는 숫자를 지어내거나 어림하지 않는다.
  - 무엇이 얼마나 달라졌는지가 드러나게 쓴다 (예: "크롤 프로세스 사망 3/6회 → 0회",
    "이름표 겹침 30쌍 → 0쌍", "미처리 24,247건 원인 규명").
  - PR 개수·커밋 수는 성과가 아니다. "8개 PR 진행" 같은 줄은 쓰지 않는다.
- 입력에 없는 사실을 만들지 않는다. 수치·기술명은 입력에 있는 것만 쓴다.
- anonymous 가 true 인 묶음은 저장소·회사·서비스의 고유 이름을 절대 쓰지 않는다. 이름을 추측하지도 않는다.
  대신 일의 성격으로 부른다 (예: "사내 크롤링 파이프라인", "사내 알림 발송 운영").
- 한국어로 쓴다.

스키마:
{"projects":[{"key":"묶음 key","title":"프로젝트 이름","summary":"한 문장","problem":"1~3문장","result":"1~3문장","highlights":["성과 줄","성과 줄"]}]}`;

const formatGroup = (group: ProjectGroup): string => {
  const works = group.accomplishments
    .map((item) => `  - ${item.title}: ${item.bullet}`)
    .join('\n');
  return [
    `key: ${group.key}`,
    // 익명 묶음에는 저장소 경로를 넣지 않는다. 모델이 프롬프트에서 본 이름을 출력에 흘리면
    // slug·링크를 아무리 접어도 제목에서 그대로 드러난다.
    group.anonymized
      ? 'anonymous: true (저장소 이름 비공개 — 이름을 쓰거나 추측하지 말 것)'
      : `repo: ${group.repo}`,
    `기간: ${group.period || '미상'}`,
    `기술: ${group.techStack.join(', ') || '미상'}`,
    `작업 ${group.accomplishments.length}건:`,
    works,
  ].join('\n');
};

export const buildProjectGroupPrompt = (groups: ProjectGroup[]): string =>
  [
    '아래 묶음 각각에 프로젝트 이름과 소개를 붙여라.',
    '',
    groups.map(formatGroup).join('\n\n'),
  ].join('\n');

const invalid = (message: string): never => {
  throw new CareerMateException({
    code: CareerMateErrorCode.INVALID_MODEL_OUTPUT,
    message,
    status: DomainStatus.BAD_GATEWAY,
  });
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

// 카드에 얹을 성과 줄. 다섯 필드와 달리 없어도 프로젝트가 성립하므로(수치가 없는 묶음이
// 실제로 있다) 빠졌거나 형식이 어긋나면 버리지 않고 빈 배열로 둔다. 대신 길이는 여기서
// 자른다 — 카드 한 줄에 들어가야 하고, 모델이 40자 규칙을 넘기면 이름표를 밀어낸다.
const HIGHLIGHT_MAX_COUNT = 3;
const HIGHLIGHT_MAX_LENGTH = 40;

// "8개 PR", "PR 8건", "커밋 12개" — 작업량이지 성과가 아니다. 프롬프트에서도 금지하지만
// 지시는 강제가 아니라, 카드에 실리기 전 여기서 막는다.
const WORK_COUNT_PATTERN =
  /(?:\d+\s*(?:개|건|차)?\s*(?:PRs?|pull requests?|커밋|commits?))|(?:(?:PRs?|pull requests?|커밋|commits?)\s*\d+\s*(?:개|건)?)/i;

const numbersIn = (text: string): string[] =>
  text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];

// 자리 구분 쉼표는 표기 차이일 뿐이다("24,247" vs "24247"). 대조 전에 지운다.
const withoutSeparators = (text: string): string => text.replace(/,/g, '');

// 카드 줄이 근거에 실제로 있는 수치를 말하는지 대조한다.
//
// 프롬프트는 "입력에 적힌 수치만" 이라고 지시하지만 지시는 강제가 아니다. 모델이 "처리량
// 99% 증가" 를 지어내도 형식 검사(비어 있지 않음·40자)는 통과하고, 한 번 발행되면 갱신
// 정책상 자동으로 교정되지 않아(hasExistingHighlights) 근거 없는 성과가 공개 카드에 남는다.
// 그래서 줄에 쓰인 숫자가 그 묶음의 작업 문장에 전부 있는지 확인하고, 하나라도 없으면 버린다.
// 숫자가 아예 없는 줄도 버린다 — 수치를 싣는 자리이지 문장을 한 번 더 요약하는 자리가 아니다.
const isGroundedHighlight = (highlight: string, source: string): boolean => {
  if (WORK_COUNT_PATTERN.test(highlight)) {
    return false;
  }
  const numbers = numbersIn(highlight);
  if (numbers.length === 0) {
    return false;
  }
  const normalizedSource = withoutSeparators(source);
  return numbers.every((number) =>
    normalizedSource.includes(withoutSeparators(number)),
  );
};

const toHighlights = (value: unknown, source: string): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isNonEmptyString)
    .map((item) => item.trim())
    .filter((item) => item.length <= HIGHLIGHT_MAX_LENGTH)
    .filter((item) => isGroundedHighlight(item, source))
    .slice(0, HIGHLIGHT_MAX_COUNT);
};

// 그 묶음의 근거 텍스트. 모델에게 준 것과 같은 재료여야 대조가 성립한다.
const sourceTextOf = (group: ProjectGroup): string =>
  group.accomplishments
    .map((item) => `${item.title} ${item.bullet}`)
    .join('\n');

const toNaming = (
  value: unknown,
  sourceByKey: Map<string, string>,
): ProjectGroupNaming | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { key, title, summary, problem, result, highlights } = value as Record<
    string,
    unknown
  >;
  // 다섯 필드가 다 있어야 프로젝트 한 건이 성립한다. 하나라도 비면 제목 없는 카드나 빈
  // 문단이 사이트에 그대로 나가므로, 부분 수용하지 않고 그 묶음을 버린다(호출부가 세어 올린다).
  if (
    !isNonEmptyString(key) ||
    !isNonEmptyString(title) ||
    !isNonEmptyString(summary) ||
    !isNonEmptyString(problem) ||
    !isNonEmptyString(result)
  ) {
    return null;
  }
  return {
    key: key.trim(),
    title: title.trim(),
    summary: summary.trim(),
    problem: problem.trim(),
    result: result.trim(),
    highlights: toHighlights(highlights, sourceByKey.get(key.trim()) ?? ''),
  };
};

export const parseProjectGroupOutput = (
  text: string,
  groups: ProjectGroup[],
): ProjectGroupNaming[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObjectText(text));
  } catch {
    return invalid('프로젝트 이름 생성 실패 — 모델 출력이 JSON 이 아닙니다.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return invalid('프로젝트 이름 생성 실패 — 모델 출력 형식 오류.');
  }
  const items = (parsed as Record<string, unknown>).projects;
  if (!Array.isArray(items)) {
    return invalid('프로젝트 이름 생성 실패 — projects 가 배열이 아닙니다.');
  }
  const allowedKeys = new Set(groups.map((group) => group.key));
  const sourceByKey = new Map(
    groups.map((group) => [group.key, sourceTextOf(group)]),
  );
  const namings: ProjectGroupNaming[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const naming = toNaming(item, sourceByKey);
    // 입력에 없는 key 는 버린다 — 모델이 지어낸 key 를 받아들이면 어느 저장소에도 속하지
    // 않는 프로젝트가 발행된다. 중복 key 도 첫 것만 쓴다.
    if (!naming || !allowedKeys.has(naming.key) || seen.has(naming.key)) {
      continue;
    }
    seen.add(naming.key);
    namings.push(naming);
  }
  if (namings.length === 0) {
    return invalid('프로젝트 이름 생성 실패 — 쓸 수 있는 항목이 없습니다.');
  }
  return namings;
};
