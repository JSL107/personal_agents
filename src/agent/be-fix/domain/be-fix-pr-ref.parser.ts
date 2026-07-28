import { PullRequestRef } from '../../../github/domain/port/github-client.port';

// 지원 형식:
//   123              → number-only
//   #123             → hash-prefixed
//   owner/repo#123   → shorthand
//   https://github.com/owner/repo/pull/123
const URL_PATTERN =
  /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)\/?$/;
const SHORTHAND_PATTERN = /^([^/\s]+\/[^/\s#]+)#(\d+)$/;
const NUMBER_PATTERN = /^#?(\d+)$/;

export const parseBeFixPrRef = (raw: string): PullRequestRef | null => {
  const urlMatch = raw.match(URL_PATTERN);
  if (urlMatch) {
    return { repo: urlMatch[1], number: Number.parseInt(urlMatch[2], 10) };
  }

  const shortMatch = raw.match(SHORTHAND_PATTERN);
  if (shortMatch) {
    return { repo: shortMatch[1], number: Number.parseInt(shortMatch[2], 10) };
  }

  const numMatch = raw.match(NUMBER_PATTERN);
  if (numMatch) {
    // number-only: repo 는 빈 문자열로 — GithubClientPort 구현이 GITHUB_REPO 환경변수로 채워야 함.
    // 현재 MVP scope 에서는 owner/repo#N 또는 URL 형식 사용을 권장.
    return { repo: '', number: Number.parseInt(numMatch[1], 10) };
  }

  return null;
};

export const isValidBeFixPrRef = (raw: string): boolean => {
  return parseBeFixPrRef(raw) !== null;
};
