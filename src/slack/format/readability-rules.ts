import { ALLOWED_SPANS } from './internal-terms';

export const findReadabilityViolations = (text: string): string[] => {
  let visible = ALLOWED_SPANS.reduce(
    (current, pattern) => current.replace(pattern, ' '),
    text,
  );
  const found: string[] = [];
  const patterns = [
    /—/g,
    /run #\d+/g,
    /(?<![\w(])#\d+(?![가-힣A-Za-z\d])/g,
    /\b(?:Daily Eval|Wins|Blockers|Work Reviewer|Headline|careerLog|schemaVersion)\b/g,
    /\b(?:Before|After):/g,
    /codex-cli|claude-cli/g,
  ];
  for (const pattern of patterns) {
    for (const match of visible.matchAll(pattern)) {
      found.push(match[0]);
    }
    visible = visible.replace(pattern, ' ');
  }
  return found;
};
