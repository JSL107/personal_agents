export type PreservedTokenKind =
  | 'number'
  | 'pr'
  | 'url'
  | 'code'
  | 'date'
  | 'quote'
  | 'legal';

export type PreservationViolation = {
  kind: PreservedTokenKind;
  token: string;
  direction: 'injected' | 'lost';
};

export type PreservationProfile = 'report' | 'personal-blog';

type TokenCounts = Map<string, number>;
type PreservedTokens = Record<PreservedTokenKind, TokenCounts>;

const BLOG_TOKEN_KINDS = new Set<PreservedTokenKind>([
  'date',
  'quote',
  'legal',
]);

const TOKEN_KINDS: PreservedTokenKind[] = [
  'code',
  'url',
  'pr',
  'date',
  'quote',
  'legal',
  'number',
];
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
  profile: PreservationProfile = 'report',
): PreservationViolation[] => {
  const originalTokens = extractPreservedTokens(original, profile);
  const rewrittenTokens = extractPreservedTokens(rewritten, profile);
  const violations: PreservationViolation[] = [];

  for (const kind of TOKEN_KINDS) {
    for (const [token, count] of rewrittenTokens[kind]) {
      const previousCount = originalTokens[kind].get(token) ?? 0;
      const injectedCount = BLOG_TOKEN_KINDS.has(kind)
        ? count - previousCount
        : Number(previousCount === 0);
      for (let index = 0; index < injectedCount; index += 1) {
        violations.push({ kind, token, direction: 'injected' });
      }
    }
    for (const [token, count] of originalTokens[kind]) {
      const rewrittenCount = rewrittenTokens[kind].get(token) ?? 0;
      const lostCount = BLOG_TOKEN_KINDS.has(kind)
        ? count - rewrittenCount
        : Number(rewrittenCount === 0);
      for (let index = 0; index < lostCount; index += 1) {
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

const extractPreservedTokens = (
  text: string,
  profile: PreservationProfile,
): PreservedTokens => {
  const tokens: PreservedTokens = {
    code: new Map<string, number>(),
    url: new Map<string, number>(),
    pr: new Map<string, number>(),
    number: new Map<string, number>(),
    date: new Map<string, number>(),
    quote: new Map<string, number>(),
    legal: new Map<string, number>(),
  };

  let remaining = extractAndMask(text, /`[^`]+`/g, tokens.code);
  remaining = extractUrlsAndMask(remaining, tokens.url);
  remaining = extractAndMask(remaining, /#[0-9]+/g, tokens.pr);
  if (profile === 'personal-blog') {
    remaining = extractDirectQuotesAndMask(remaining, tokens.quote);
    remaining = extractAndMask(remaining, DATE_PATTERN, tokens.date);
    remaining = extractAndMask(
      remaining,
      LEGAL_REFERENCE_PATTERN,
      tokens.legal,
    );
  }
  extractAndMask(
    remaining,
    /(?<![0-9])[-+]?[$₩€£]?(?:[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|\.[0-9]+)%?/g,
    tokens.number,
  );

  return tokens;
};

const DATE_PATTERN =
  /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b|(?<!\d)\d{4}년\s*\d{1,2}월\s*\d{1,2}일(?!\d)|(?<!\d)\d{1,2}월\s*\d{1,2}일(?!\d)/g;

const LEGAL_REFERENCE_PATTERN =
  /제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호)?/g;

const DIRECT_QUOTE_PATTERN = /"[^"]+"|“[^”]+”|「[^」]+」|『[^』]+』/g;

const QUOTE_INTRO_PATTERN =
  /(?:(?:말했|밝혔|전했|설명했|지적했|주장했|언급했)(?:습니다|다)?|(?:말했다|밝혔다|전했다|설명했다|지적했다|주장했다|언급했다)|(?:발언|답변|설명|입장|말)(?:은|는|이|가)?\s*다음과\s*같습니다)\s*[:：.!?]?\s*$/;
const ROLE_SPEAKER_PATTERN =
  /(?:^|\s)(?:[가-힣]{1,20}\s+)?(?:대표|교수|장관|기자|관계자|대변인|위원장|연구원|담당자|씨)(?:은|는|이|가)[^"“”「」『』\n.!?]{0,40}$/;
const NAMED_SPEAKER_PATTERN =
  /(?:^|\s)(?:(?:김|이|박|최|정|강|조|윤|장|임|한|오|서|신|권|황|안|송|전|홍|유|문|양|손|배|백|허|남|심|노|하|곽|성)[가-힣]{2}|[가-힣]{1,15}(?:부|청|처|위원회|협회|공사|재단|연구소|대학교|대학|병원|언론사|기업|회사|정부|지자체))(?<!에)(?:은|는|이|가)[^"“”「」『』\n.!?]{0,40}$/;
const SENTENCE_QUOTE_PATTERN =
  /(?:[.!?]|합니다|했습니다|하겠습니다|하겠다|한다|했다|됩니다|됐다|이다|였다|가요|요)$/;
const DIRECT_ATTRIBUTION_PATTERN =
  /^\s*(?:이라고|라고|라며|고)[^"“”「」『』\n.!?]{0,40}(?:말했|밝혔|전했|주장했|언급했|답했|\s했)/;
const EXPLANATION_ATTRIBUTION_PATTERN =
  /^\s*(?:이라고|라고|라며|고)[^"“”「」『』\n.!?]{0,40}(?:설명했|지적했)/;

const extractDirectQuotesAndMask = (
  text: string,
  tokens: TokenCounts,
): string => {
  return text.replace(DIRECT_QUOTE_PATTERN, (quote, offset, source) => {
    const before = source.slice(Math.max(0, offset - 80), offset);
    const attribution = source.slice(
      offset + quote.length,
      offset + quote.length + 80,
    );
    if (
      !QUOTE_INTRO_PATTERN.test(before) &&
      !DIRECT_ATTRIBUTION_PATTERN.test(attribution) &&
      !(
        (ROLE_SPEAKER_PATTERN.test(before) ||
          (NAMED_SPEAKER_PATTERN.test(before) &&
            SENTENCE_QUOTE_PATTERN.test(quote.slice(1, -1).trim()))) &&
        EXPLANATION_ATTRIBUTION_PATTERN.test(attribution)
      )
    ) {
      return quote;
    }
    addToken(tokens, quote);
    return ' '.repeat(quote.length);
  });
};

const URL_PATTERN = /https?:\/\/[^\s]+/g;

const extractUrlsAndMask = (text: string, tokens: TokenCounts): string => {
  return text.replace(URL_PATTERN, (matched) => {
    // 문장 구두점과 균형 밖 닫는 괄호만 URL에서 빼고 후속 추출용 원문에는 남긴다.
    const url = trimTrailingUrlPunctuation(matched);
    const punctuation = matched.slice(url.length);
    addToken(tokens, url);
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
  tokens: TokenCounts,
): string => {
  return text.replace(pattern, (token) => {
    addToken(tokens, token);
    return ' '.repeat(token.length);
  });
};

const addToken = (tokens: TokenCounts, token: string): void => {
  tokens.set(token, (tokens.get(token) ?? 0) + 1);
};
