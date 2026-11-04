import { ALLOWED_SPANS } from './internal-terms';

export const findReadabilityViolations = (text: string): string[] => {
  const visible = ALLOWED_SPANS.reduce(
    (current, pattern) => current.replace(pattern, ' '),
    text,
  );
  const matches = [...visible.matchAll(VIOLATION_PATTERN)];
  return matches.map((match) => match[0]);
};

// 한 정규식의 선택지로 묶는다. 같은 자리에서는 앞 선택지가 먼저 맞고 그 글자를 소비하므로,
// `run #11198` 이 `run #\d+` 로 잡힌 뒤 안의 `#11198` 이 단독 번호로 또 보고되지 않는다.
const VIOLATION_PATTERN = new RegExp(
  [
    /—/,
    /run #\d+/,
    /(?<![\w(])#\d+(?![가-힣A-Za-z\d])/,
    /\b(?:Daily Eval|Wins|Blockers|Work Reviewer|Headline|careerLog|schemaVersion)\b/,
    /\b(?:Before|After):/,
    /codex-cli|claude-cli/,
  ]
    .map((pattern) => pattern.source)
    .join('|'),
  'g',
);
