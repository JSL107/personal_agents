import { createHash } from 'node:crypto';

import { NormalizedJobPosting } from './job-feed.type';

const LEGAL_ENTITY_PATTERNS: readonly RegExp[] = [
  /\(주\)/gu,
  /주식회사/gu,
  /\(유\)/gu,
  /유한회사/gu,
  /\bInc\.?\b/giu,
  /\bLtd\.?\b/giu,
  /\bCorp\.?\b/giu,
  /\bCo\.?\b/giu,
];

const stripSymbols = (value: string): string => {
  return value.toLowerCase().replace(/[\s()[\]{}.,·\-_/|]/gu, '');
};

export const toCompanyKey = (company: string): string => {
  let normalized = company;
  for (const pattern of LEGAL_ENTITY_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }
  return stripSymbols(normalized);
};

// 같은 공고가 여러 소스에 오를 때 하나로 묶는 키. 알림은 이 키 단위로 한 번만 나간다.
export const toNormalizedKey = (company: string, title: string): string => {
  return `${toCompanyKey(company)}|${stripSymbols(title)}`;
};

// 요건이 바뀐 공고를 다시 알리기 위한 지문. 요건과 무관한 필드는 넣지 않는다 —
// 넣으면 URL 이 바뀔 때마다 이미 본 공고가 다시 뜬다.
export const toContentHash = (posting: NormalizedJobPosting): string => {
  const material = JSON.stringify([
    posting.companyKey,
    stripSymbols(posting.title),
    [...posting.skillTags].sort(),
    posting.minYears,
    posting.maxYears,
    posting.experienceLevel,
    [...posting.locations].sort(),
  ]);
  return createHash('sha256').update(material).digest('hex');
};
