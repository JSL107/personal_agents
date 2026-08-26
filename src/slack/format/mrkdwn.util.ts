// Slack mrkdwn `<url|title>` 링크 안에 들어가는 텍스트가 `<` / `>` / `|` 를 포함하면 파싱이 깨진다.
// LLM 출력 (task.title) 이나 외부 CLI 결과 (modelUsed) 가 우연히 이 문자를 포함해도 footer/link 가 안 깨지도록
// 보수적으로 제거. 의미 손실은 미미하고 회귀 회피 효과 큼 (codex/omc P1 지적).
export const sanitizeForSlackLink = (text: string): string =>
  text.replace(/[<>|]/g, '');

// Slack mrkdwn `<url|...>` 안의 url 은 반드시 http(s) 스킴이어야 한다.
// LLM 이 fragment(`/pull/707`) 만 반환하는 사고를 막기 위해 prefix 화이트리스트 (codex P0 지적).
export const isSafeHttpUrl = (url: string): boolean =>
  url.startsWith('http://') || url.startsWith('https://');

// Slack mrkdwn 제어문자 escape — LLM 자유텍스트(리뷰 요약/코멘트, worklog 등)에 `&`/`<`/`>` 가 섞이면
// Slack 이 `<...>` 를 링크 태그로, `&...;` 를 엔티티로 오인해 텍스트가 잘리거나 사라진다. 렌더 위조 방지.
// 주의: 인라인 코드(백틱) 안 텍스트에는 쓰지 말 것 — Slack 이 백틱 내부를 리터럴 렌더해 `&lt;` 가 그대로 노출됨.
export const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// LLM 이 자유텍스트(판단 근거, 회고 등) 안에 URL 을 통째로 적어 넣으면 주소 하나가 두세 줄을 차지해
// 문단이 통짜 벽처럼 보인다. GitHub PR/이슈 주소는 사람이 읽는 이름(`repo #52`)으로 접어 준다.
// 이미 `<url|label>` 로 감싼 링크는 건드리지 않는다.
const BARE_URL = /https?:\/\/[^\s<>|]+/g;
const SLACK_LINK_TOKEN = /(<[^<>]*>)/;
const URL_TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;
const GITHUB_ISSUE_URL =
  /^https?:\/\/github\.com\/[^/]+\/([^/]+)\/(?:pull|issues)\/(\d+)/;

const toLabeledLink = (url: string): string => {
  const trailing = URL_TRAILING_PUNCTUATION.exec(url)?.[0] ?? '';
  const bare = trailing.length > 0 ? url.slice(0, -trailing.length) : url;
  const issue = GITHUB_ISSUE_URL.exec(bare);
  if (!issue) {
    return url;
  }
  return `<${bare}|${issue[1]} #${issue[2]}>${trailing}`;
};

export const linkifyBareUrls = (text: string): string =>
  text
    .split(SLACK_LINK_TOKEN)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(BARE_URL, toLabeledLink),
    )
    .join('');

// 모델이 만든 산문(판단 근거, 회고 요약 등)은 문장 여러 개를 줄바꿈 없이 한 덩어리로 뱉는다.
// Slack 폭에서 그대로 흐르면 대여섯 줄짜리 글자 벽이 되어 어디서 끊어 읽을지 알 수 없다.
// 문장 끝(구두점 + 공백)에서 줄을 바꿔 한 문장 = 한 문단으로 만든다.
//
// 건드리지 않는 줄:
//  - 목록·인용·들여쓰기로 시작하는 줄 — 쪼개면 둘째 줄이 기호를 잃어 계층이 깨진다.
//  - 짧은 줄 — 안내·오류 문구는 이미 한눈에 들어온다.
// ponytail: 임계값은 "Slack 기본 폭에서 두 줄 이상"을 눈으로 재 정한 값. 화면 폭이 바뀌면 조정.
const PROSE_WRAP_THRESHOLD = 100;
// `*` 는 목록 기호가 아니라 Slack 의 굵게 표시다 — 여기 넣으면 `*판단 근거*` 로 시작하는 산문이
// 목록으로 오인돼 통째로 건너뛴다.
const LIST_OR_QUOTE_LINE = /^\s*([•\->↳|]|\d+[.)])/;
const SENTENCE_BOUNDARY = /([.!?])[ \t]+(?=\S)/g;

// 화면에 실제로 보이는 글자 수. `<주소|이름>` 은 이름만 보이므로 주소 길이로 재면
// 짧은 문장이 "길다" 고 잘못 판정된다 — 링크 하나가 60자를 먹는 일이 흔하다.
const toVisibleLength = (text: string): number =>
  text.replace(/<([^<>|]+)\|([^<>]*)>/g, '$2').replace(/<([^<>]+)>/g, '$1')
    .length;

// 문장을 쪼갠 결과가 Slack 한 줄을 채우지 못할 만큼 짧으면 이웃 문장에 도로 붙인다.
// "확인했다." 같은 한마디가 혼자 한 줄을 차지하면 오히려 산만해진다.
// ponytail: 30 은 Slack 기본 폭에서 한 줄의 절반 정도. 폭 감각이 바뀌면 이 값만 조정한다.
const MIN_VISIBLE_SENTENCE_LENGTH = 30;

const mergeShortSentences = (sentences: string[]): string => {
  const merged: string[] = [];
  for (const sentence of sentences) {
    const previous = merged[merged.length - 1];
    // 자기가 짧을 때뿐 아니라 앞 문장이 짧을 때도 합친다 — 그래야 짧은 문장이
    // 맨 앞에 와도 홀로 남지 않는다.
    const tooShortToStand =
      toVisibleLength(sentence) < MIN_VISIBLE_SENTENCE_LENGTH ||
      (previous !== undefined &&
        toVisibleLength(previous) < MIN_VISIBLE_SENTENCE_LENGTH);
    if (previous !== undefined && tooShortToStand) {
      merged[merged.length - 1] = `${previous} ${sentence}`;
      continue;
    }
    merged.push(sentence);
  }
  return merged.join('\n');
};

const breakLineIntoSentences = (line: string): string => {
  if (
    toVisibleLength(line) <= PROSE_WRAP_THRESHOLD ||
    LIST_OR_QUOTE_LINE.test(line)
  ) {
    return line;
  }
  // `<url|이름>` 안에도 마침표가 있다 — 링크 토큰은 건드리지 않고 통과시킨다.
  const marked = line
    .split(SLACK_LINK_TOKEN)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(SENTENCE_BOUNDARY, '$1\n'),
    )
    .join('');
  return mergeShortSentences(marked.split('\n'));
};

// ``` 코드블록 안은 손대지 않는다 — 사용자가 그대로 복사해 붙여 쓰는 원문이라
// 한 글자라도 바꾸면 안 되고, 줄을 쪼개면 코드가 깨진다.
// fence 가 닫히지 않은 입력이면 그 뒤 전체를 코드로 보고 통과시킨다(안전한 실패).
export const isCodeFenceLine = (line: string): boolean =>
  line.trimStart().startsWith('```');

export const breakProseIntoSentences = (text: string): string => {
  let insideCodeFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (isCodeFenceLine(line)) {
        insideCodeFence = !insideCodeFence;
        return line;
      }
      return insideCodeFence ? line : breakLineIntoSentences(line);
    })
    .join('\n');
};
