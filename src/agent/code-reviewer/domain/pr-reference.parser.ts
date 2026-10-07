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

// 텍스트 안의 PR 참조를 전부 찾는다(나온 순서, 같은 PR 은 한 번). 대화 기억에서 직전 리뷰 대상을
// 이어받을 때 쓴다 — parsePrReference 는 첫 참조 하나만 보므로 "여러 PR 이 섞였다" 를 알 수 없다.
export const findPrReferences = (raw: string): ParsedPrReference[] => {
  const normalized = raw.replace(SLACK_LINK_PATTERN, '$1');
  const found: { index: number; ref: ParsedPrReference }[] = [];
  for (const pattern of [URL_PATTERN, SHORTHAND_PATTERN]) {
    const global = new RegExp(pattern.source, 'g');
    for (const match of normalized.matchAll(global)) {
      found.push({
        index: match.index ?? 0,
        ref: { repo: match[1], number: Number.parseInt(match[2], 10) },
      });
    }
  }
  const seen = new Set<string>();
  return found
    .sort((left, right) => left.index - right.index)
    .map(({ ref }) => ref)
    .filter((ref) => {
      const key = toShorthand(ref);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
};

export const toShorthand = (ref: ParsedPrReference): string =>
  `${ref.repo}#${ref.number}`;

const buildInvalidException = (raw: string): CodeReviewerException =>
  new CodeReviewerException({
    code: CodeReviewerErrorCode.INVALID_PR_REFERENCE,
    message: `PR 참조 형식이 잘못되었습니다: "${raw}". 사용 예: \`/review-pr https://github.com/owner/repo/pull/123\` 또는 \`/review-pr owner/repo#123\`.`,
    status: DomainStatus.BAD_REQUEST,
  });
