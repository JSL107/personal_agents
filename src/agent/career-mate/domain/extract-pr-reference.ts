import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CareerMateException } from './career-mate.exception';
import { ParsedPrRef } from './career-mate.type';
import { CareerMateErrorCode } from './career-mate-error-code.enum';

// 자연어 문장 안의 모든 PR 참조를 등장 순서대로 추출한다 (URL + shorthand).
// 같은 repo#number 는 dedup, 최대 MAX_PRS 건. 이어진(연속) PR 다건 회고용.
const URL_PATTERN = /https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/g;
const SHORTHAND_PATTERN = /(?:^|\s)([\w.-]+\/[\w.-]+)#(\d+)(?=\s|$)/g;
const MAX_PRS = 8;

interface PrHit {
  repo: string;
  number: number;
  index: number;
}

export const extractPrReferences = (text: string): ParsedPrRef[] => {
  const hits: PrHit[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    hits.push({
      repo: match[1],
      number: Number.parseInt(match[2], 10),
      index: match.index ?? 0,
    });
  }
  for (const match of text.matchAll(SHORTHAND_PATTERN)) {
    hits.push({
      repo: match[1],
      number: Number.parseInt(match[2], 10),
      index: match.index ?? 0,
    });
  }
  hits.sort((left, right) => left.index - right.index);

  const refs: ParsedPrRef[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = `${hit.repo}#${hit.number}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    refs.push({ repo: hit.repo, number: hit.number });
  }

  if (refs.length === 0) {
    throw new CareerMateException({
      code: CareerMateErrorCode.INVALID_PR_REFERENCE,
      message:
        'PR 링크를 찾지 못했습니다. 예: "이 PR들 회고해줘 https://github.com/owner/repo/pull/123 https://github.com/owner/repo/pull/124" 처럼 PR URL 을 함께 보내주세요.',
      status: DomainStatus.BAD_REQUEST,
    });
  }
  return refs.slice(0, MAX_PRS);
};
