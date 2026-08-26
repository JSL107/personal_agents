export type PreservedTokenKind = 'number' | 'pr' | 'url' | 'code';

export type PreservationViolation = {
  kind: PreservedTokenKind;
  token: string;
  direction: 'injected' | 'lost';
};

type PreservedTokens = Record<PreservedTokenKind, Set<string>>;

const TOKEN_KINDS: PreservedTokenKind[] = ['code', 'url', 'pr', 'number'];
const URL_TRAILING_PUNCTUATION = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  "'",
  '"',
]);
const URL_CLOSER_TO_OPENER: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
};

export const findPreservationViolations = (
  original: string,
  rewritten: string,
): PreservationViolation[] => {
  const originalTokens = extractPreservedTokens(original);
  const rewrittenTokens = extractPreservedTokens(rewritten);
  const violations: PreservationViolation[] = [];

  for (const kind of TOKEN_KINDS) {
    for (const token of rewrittenTokens[kind]) {
      if (!originalTokens[kind].has(token)) {
        violations.push({ kind, token, direction: 'injected' });
      }
    }
    for (const token of originalTokens[kind]) {
      if (!rewrittenTokens[kind].has(token)) {
        violations.push({ kind, token, direction: 'lost' });
      }
    }
  }

  return violations;
};

export const shouldRollbackField = (
  violations: PreservationViolation[],
): boolean => {
  return violations.some(
    (violation) =>
      violation.direction === 'injected' || violation.kind !== 'number',
  );
};

const extractPreservedTokens = (text: string): PreservedTokens => {
  const tokens: PreservedTokens = {
    code: new Set<string>(),
    url: new Set<string>(),
    pr: new Set<string>(),
    number: new Set<string>(),
  };

  let remaining = extractAndMask(text, /`[^`]+`/g, tokens.code);
  remaining = extractUrlsAndMask(remaining, tokens.url);
  remaining = extractAndMask(remaining, /#[0-9]+/g, tokens.pr);
  extractAndMask(
    remaining,
    /(?<![0-9])[-+]?[$₩€£]?(?:[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|\.[0-9]+)%?/g,
    tokens.number,
  );

  return tokens;
};

const URL_PATTERN = /https?:\/\/[^\s]+/g;

const extractUrlsAndMask = (text: string, tokens: Set<string>): string => {
  return text.replace(URL_PATTERN, (matched) => {
    // 문장 구두점과 균형 밖 닫는 괄호만 URL에서 빼고 후속 추출용 원문에는 남긴다.
    const url = trimTrailingUrlPunctuation(matched);
    const punctuation = matched.slice(url.length);
    tokens.add(url);
    return `${' '.repeat(url.length)}${punctuation}`;
  });
};

// 균형 밖 닫는 괄호가 나오는 자리에서 URL 을 끊는다.
//
// 왜 필요한가 — `[Osmani](https://…/loop-engineering/)는` 처럼 마크다운 링크 뒤에 조사가 붙으면
// `[^\s]+` 는 공백 전까지 삼켜 **닫는 괄호와 조사까지 주소로 본다**. 그러면 윤문이 조사를
// `가`→`는` 으로 바꾸는 것만으로 다른 URL 토큰이 되어 injected/lost 위반이 뜨고, 그 문단이
// 통째로 원문으로 롤백된다 — 실측에서 같은 문단이 3회 재실행 내내 윤문되지 못했다.
//
// 아래 `trimTrailingUrlPunctuation` 만으로는 안 된다. 그 루프는 **마지막 문자부터** 떼는데
// 조사가 한글이라 첫 검사에서 멈춘다 — 닫는 괄호를 떼는 자리까지 가지도 못한다.
//
// 한글을 URL 문자에서 제외하는 방법은 **틀렸다**(리뷰 지적). `https://example.com/문서` 가
// `…/문건` 으로 바뀌어도 양쪽 모두 `https://example.com/` 으로 잘려 같은 토큰이 되고, 변조된
// 링크가 검사를 그대로 통과한다. 앞뒤가 같이 짧아지면 대조가 성립하는 것이 아니라 **차이가
// 지워진다.** 경계는 조사가 아니라 괄호로 잡아야 한다.
const cutAtUnbalancedCloser = (url: string): string => {
  const openCount = new Map<string, number>();
  for (let index = 0; index < url.length; index += 1) {
    const character = url[index];
    if (Object.values(URL_CLOSER_TO_OPENER).includes(character)) {
      openCount.set(character, (openCount.get(character) ?? 0) + 1);
      continue;
    }
    const opener = URL_CLOSER_TO_OPENER[character];
    if (!opener) {
      continue;
    }
    const opened = openCount.get(opener) ?? 0;
    if (opened === 0) {
      // 열린 적 없는 닫는 괄호 = URL 을 감싼 문법의 끝이다. 그 뒤는 주소가 아니다.
      return url.slice(0, index);
    }
    openCount.set(opener, opened - 1);
  }
  return url;
};

const trimTrailingUrlPunctuation = (matched: string): string => {
  let url = cutAtUnbalancedCloser(matched);

  while (url.length > 0) {
    const lastCharacter = url[url.length - 1];
    if (URL_TRAILING_PUNCTUATION.has(lastCharacter)) {
      url = url.slice(0, -1);
      continue;
    }
    if (hasUnmatchedClosingBracket(url, lastCharacter)) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }

  return url;
};

const hasUnmatchedClosingBracket = (
  text: string,
  closingBracket: string,
): boolean => {
  const openingBracket = URL_CLOSER_TO_OPENER[closingBracket];
  if (!openingBracket) {
    return false;
  }

  let balance = 0;
  for (const character of text) {
    if (character === openingBracket) {
      balance += 1;
    }
    if (character === closingBracket) {
      balance -= 1;
    }
  }
  return balance < 0;
};

const extractAndMask = (
  text: string,
  pattern: RegExp,
  tokens: Set<string>,
): string => {
  return text.replace(pattern, (token) => {
    tokens.add(token);
    return ' '.repeat(token.length);
  });
};
