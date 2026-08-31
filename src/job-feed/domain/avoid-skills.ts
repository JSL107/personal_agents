import { normalizeSkillTags, SkillNormalizeResult } from './skill-dictionary';

// JOB_FEED_AVOID_SKILLS 같은 쉼표 구분 env 문자열을 알림·갭분석·상세수집 세 표면이
// 공통으로 쓰는 형태로 정규화한다. 저장된 skillTags 는 사전을 통과한 정규명이라,
// 사용자가 쓴 표기(대소문자·별칭)를 그대로 비교하면 "php" 같은 입력이 "PHP" 와
// 안 맞아 필터가 조용히 무효화된다 — 같은 사전(normalizeSkillTags)을 통과시킨다.
//
// unmatched 는 호출부가 판단해서 로그를 남긴다. 사전에 없는 값("Cobol")도 이제는
// 원본 표기 그대로 저장·비교되므로 필터가 통째로 무효가 되지는 않지만, 표기가 정확히
// 같은 공고만 걸린다("cobol" 로 적은 공고는 키가 같아 걸리고 "COBOL Language" 는 안
// 걸린다) — 그 반쪽 동작을 조용히 넘기면 이 레포가 반복해 겪은 "조용한 0건" 계열
// 사고가 된다. 이 함수는 도메인 계층이라 로깅하지 않는다 — 로거 컨텍스트(task 이름
// vs CLI)는 호출부마다 다르다.
export const parseAvoidSkillTags = (
  raw: string | undefined,
): SkillNormalizeResult => {
  const tags = (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return normalizeSkillTags(tags);
};
