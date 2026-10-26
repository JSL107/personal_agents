import { CollectedItem, CollectionStatus } from './humanize-research.type';

export const DAY_MS = 24 * 60 * 60 * 1000;

// 내부 기록(윤문 원장·블로그 수정)은 블로그 수정률 보고와 같은 4주를 본다.
export const INTERNAL_LOOKBACK_DAYS = 28;
// 외부 재료(arXiv·원작자 첫 회차)는 사용자 확정값 30일(2026-10-26).
export const EXTERNAL_LOOKBACK_DAYS = 30;

// 설계 §4 컨텍스트 예산.
export const HUMANIZE_RESEARCH_INPUT_LIMIT = 60_000;
// 3단계 A/B 비용 상한(설계 §6). 프롬프트 안내문도 이 값을 읽는다.
export const HUMANIZE_RESEARCH_MAX_PROPOSALS = 3;

// arXiv 는 30일 창이 주 1회 회차보다 길어 직전 회차 하나만 보면 같은 논문이 다시 들어온다.
export const ARXIV_DEDUP_ROUNDS = 5;
export const ARXIV_ARTICLE_LIMIT = 10;

export const statusOfItems = (
  items: readonly CollectedItem[],
): CollectionStatus => {
  if (items.length > 0) {
    return CollectionStatus.OK;
  }
  return CollectionStatus.EMPTY;
};
