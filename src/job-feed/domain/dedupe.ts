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

// 회사 키만 점(.)을 보존한다. stripSymbols 는 제목·기타 문자열에 계속 쓰는데,
// 회사명은 점으로 브랜드를 구분하는 회사(N.Thing)와 점 없이 쓰는 다른 회사(NThing)를
// 점을 지우면 같은 키로 묶어버린다.
//
// 다만 LEGAL_ENTITY_PATTERNS 의 `\bInc\.?\b` 류는 단어 경계(\b)가 마침표 뒤 공백·
// 문자열 끝에서 성립하지 않아(마침표 자체가 non-word 라 non-word→non-word 는 경계가
// 아니다) 정규식이 역추적하며 "Inc" 만 지우고 마침표를 그대로 남긴다("Toss Inc." →
// "Toss ."). 그 잔재 마침표까지 보존하면 "Toss Inc." 와 "toss" 가 다른 키가 되어
// 기존 정탐이 깨진다. 그래서 공백·문자열 경계에 붙은(=고립된) 마침표만 먼저 걷어내고,
// 글자 사이에 낀 마침표("N.Thing")만 보존한다.
const stripOrphanDots = (value: string): string => {
  return value.replace(/(^|\s)\.+|\.+(\s|$)/gu, '$1$2');
};

const stripSymbolsKeepDot = (value: string): string => {
  return stripOrphanDots(value)
    .toLowerCase()
    .replace(/[\s()[\]{},·\-_/|]/gu, '');
};

export const toCompanyKey = (company: string): string => {
  let normalized = company;
  for (const pattern of LEGAL_ENTITY_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }
  return stripSymbolsKeepDot(normalized);
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
