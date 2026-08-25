export type PreservedTokenKind = 'number' | 'pr' | 'url' | 'code';

export type PreservationViolation = {
  kind: PreservedTokenKind;
  token: string;
  direction: 'injected' | 'lost';
};

type PreservedTokens = Record<PreservedTokenKind, Set<string>>;

const TOKEN_KINDS: PreservedTokenKind[] = ['code', 'url', 'pr', 'number'];

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
    /[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?/g,
    tokens.number,
  );

  return tokens;
};

const extractUrlsAndMask = (text: string, tokens: Set<string>): string => {
  return text.replace(/https?:\/\/[^\s]+/g, (matched) => {
    // 문장 재구성으로 달라질 수 있는 URL 끝 구두점은 토큰에서 빼고 후속 추출용 원문에는 남긴다.
    const url = matched.replace(/[.,;:!?\])}'"]+$/, '');
    const punctuation = matched.slice(url.length);
    tokens.add(url);
    return `${' '.repeat(url.length)}${punctuation}`;
  });
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
