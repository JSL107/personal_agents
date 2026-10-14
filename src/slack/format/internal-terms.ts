import {
  AgentRunStatus,
  STALE_RUN_SWEPT_ERROR,
} from '../../agent-run/domain/agent-run.type';
import { AgentType } from '../../model-router/domain/model-router.type';

// Slack 보고서에 섞이면 안 되는 내부 식별자. 대표가 읽는 문장에 `CODE_REVIEWER 워커 — 실패 —
// swept: stale IN_PROGRESS` 가 그대로 나간 일이 있었다(#816). 보고서마다 따로 고치다 세 번 빠뜨려,
// 테스트가 모든 렌더 결과를 이 목록으로 거른다(`internal-terms.jest-setup.ts`).
//
// 사람 말로 옮기는 함수: 담당 이름은 `toTaskLabel`, 실패 사유는 `describeFailureReason`.
//
// enum 값은 손으로 옮겨 적지 않고 enum 에서 만든다 — 새 에이전트가 생기면 자동으로 금칙어가 된다.
// 밑줄 없는 한 단어 값(`PM`·`CEO`·`BLOG`·`INVEST` …)은 뺀다. 대표의 할 일 제목·모델이 옮긴 업무
// 내용에 보통 단어로 나와("PM Agent 구현 마무리") 포맷터 문구와 데이터를 가를 수 없다. 그 값이
// 날것으로 나가는 회귀는 이 검사가 못 잡는다 — 밑줄 있는 값(`CODE_REVIEWER`)이 같은 경로를 지키는
// 것으로 갈음한다. 상태값(`FAILED` 등)은 대문자 그대로 쓸 일이 없어 전부 넣는다.
const ENUM_TERMS = [
  ...Object.values(AgentType).filter((value) => value.includes('_')),
  ...Object.values(AgentRunStatus),
];

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 영숫자·밑줄로 이어진 더 긴 단어의 일부는 잡지 않는다(`PMS`, `BLOGGER`, `PM_x` 는 다른 단어다).
const wordPattern = (term: string): RegExp =>
  new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(term)}(?![A-Za-z0-9_])`);

const FORBIDDEN_PATTERNS: RegExp[] = [
  // 원문 전체를 먼저 둔다 — 안의 `IN_PROGRESS` 만 보고하면 고칠 곳(describeFailureReason)이 안 보인다.
  new RegExp(escapeRegExp(STALE_RUN_SWEPT_ERROR)),
  ...ENUM_TERMS.map(wordPattern),
  // 기억 점검(knowledge-lint) 보고에 나갔던 저장소·검색 용어.
  /episodic-memory/,
  /\bembedding\b/,
  /\bdistance \d/,
];

// 사용자가 실제로 찾아보거나 복사할 대상은 허용한다 — 지우면 보고서가 쓸모를 잃는다.
// 검사 전에 이 부분을 지운다.
const ALLOWED_SPANS: RegExp[] = [
  // 코드 블록·인라인 코드. 개발용으로 일부러 식별자를 보여 주는 자리다 — `/search-runs` 의
  // `[CODE_REVIEWER #42]` 는 그 런을 다시 찾는 열쇠라 #816 에서 남겼다.
  /```[\s\S]*?```/g,
  /`[^`\n]*`/g,
  // URL (Slack `<url|label>` 링크의 url 부분 포함). 경로에 영어 식별자가 들어가도 누르는 대상이다.
  /https?:\/\/[^\s|>]+/g,
];

export const findInternalTerms = (text: string): string[] => {
  const visible = ALLOWED_SPANS.reduce(
    (current, pattern) => current.replace(pattern, ' '),
    text,
  );
  const found: string[] = [];
  let rest = visible;
  for (const pattern of FORBIDDEN_PATTERNS) {
    const match = pattern.exec(rest);
    if (match) {
      found.push(match[0]);
      // 같은 자리를 짧은 패턴이 다시 보고하지 않게 지운다(swept 원문 안의 IN_PROGRESS).
      rest = rest.split(match[0]).join(' ');
    }
  }
  return found;
};
