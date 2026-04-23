import { HttpStatus } from '@nestjs/common';

import { CodeReviewerErrorCode } from './code-reviewer-error-code.enum';
import { CodeReviewerException } from './code-reviewer.exception';

const URL_PATTERN = /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)\/?$/;
const SHORTHAND_PATTERN = /^([^/\s]+\/[^/\s#]+)#(\d+)$/;

export interface ParsedPrReference {
  repo: string; // "owner/repo"
  number: number;
}

// 사용자가 `/review-pr` 으로 넘긴 입력을 PR 참조로 파싱한다.
// 지원 형식:
// 1. https://github.com/owner/repo/pull/123 (full URL)
// 2. owner/repo#123 (shorthand)
export const parsePrReference = (raw: string): ParsedPrReference => {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw buildInvalidException(raw);
  }

  const urlMatch = trimmed.match(URL_PATTERN);
  if (urlMatch) {
    return { repo: urlMatch[1], number: Number.parseInt(urlMatch[2], 10) };
  }

  const shortMatch = trimmed.match(SHORTHAND_PATTERN);
  if (shortMatch) {
    return { repo: shortMatch[1], number: Number.parseInt(shortMatch[2], 10) };
  }

  throw buildInvalidException(raw);
};

const buildInvalidException = (raw: string): CodeReviewerException =>
  new CodeReviewerException({
    code: CodeReviewerErrorCode.INVALID_PR_REFERENCE,
    message: `PR 참조 형식이 잘못되었습니다: "${raw}". 사용 예: \`/review-pr https://github.com/owner/repo/pull/123\` 또는 \`/review-pr owner/repo#123\`.`,
    status: HttpStatus.BAD_REQUEST,
  });
