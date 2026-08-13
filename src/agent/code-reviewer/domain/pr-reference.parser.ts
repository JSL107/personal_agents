import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CodeReviewerException } from './code-reviewer.exception';
import { CodeReviewerErrorCode } from './code-reviewer-error-code.enum';

const URL_PATTERN =
  /https?:\/\/github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/pull\/(\d+)(?=$|[^A-Za-z0-9])/;
const SHORTHAND_PATTERN =
  /(?<![A-Za-z0-9._/-])([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#(\d+)(?![A-Za-z0-9_-])/;
const SLACK_LINK_PATTERN = /<([^>|]+)(?:\|[^>]*)?>/g;

export interface ParsedPrReference {
  repo: string; // "owner/repo"
  number: number;
}

// 사용자가 `/review-pr` 으로 넘긴 입력을 PR 참조로 파싱한다.
// 지원 형식:
// 1. https://github.com/owner/repo/pull/123 (full URL)
// 2. owner/repo#123 (shorthand)
export const parsePrReference = (raw: string): ParsedPrReference => {
  const normalized = raw.replace(SLACK_LINK_PATTERN, '$1').trim();

  if (normalized.length === 0) {
    throw buildInvalidException(raw);
  }

  const urlMatch = normalized.match(URL_PATTERN);
  const shortMatch = normalized.match(SHORTHAND_PATTERN);

  if (
    urlMatch &&
    (!shortMatch || (urlMatch.index ?? 0) <= (shortMatch.index ?? 0))
  ) {
    return { repo: urlMatch[1], number: Number.parseInt(urlMatch[2], 10) };
  }

  if (shortMatch) {
    return { repo: shortMatch[1], number: Number.parseInt(shortMatch[2], 10) };
  }

  throw buildInvalidException(raw);
};

const buildInvalidException = (raw: string): CodeReviewerException =>
  new CodeReviewerException({
    code: CodeReviewerErrorCode.INVALID_PR_REFERENCE,
    message: `PR 참조 형식이 잘못되었습니다: "${raw}". 사용 예: \`/review-pr https://github.com/owner/repo/pull/123\` 또는 \`/review-pr owner/repo#123\`.`,
    status: DomainStatus.BAD_REQUEST,
  });
