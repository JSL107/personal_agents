import { DailyReview } from '../work-reviewer.type';

// DailyReview shape 검증 유틸 — parser 와 PM previous-worklog-formatter 두 군데에서 동일 검증 필요.
// 통합하여 규칙 분기 방지.
export const isDailyReviewShape = (value: unknown): value is DailyReview => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.summary === 'string' &&
    isImpactShape(record.impact) &&
    isImprovementShape(record.improvementBeforeAfter) &&
    isStringArray(record.decisions) &&
    isStringArray(record.risks) &&
    isStringArray(record.nextActions) &&
    typeof record.oneLineAchievement === 'string'
  );
};

// decisions / risks 도입(2026-09-04) 이전에 적재된 output 에는 두 키가 없다. 형태 판정 전에
// 빈 배열로 채워, 그날 이전의 회고가 전부 "형태 불일치 = 회고 없음" 으로 조용히 떨어지는 것을
// 막는다 (PM 이 어제 회고를 컨텍스트로 읽는 경로가 여기 걸려 있다).
// 채우는 것은 키가 없거나 null 인 경우뿐이다. 문자열·객체 등 다른 형태로 들어오면 그대로 둬
// 형태 검사에서 걸리게 한다 — 그건 호환 문제가 아니라 모델 오출력이다.
export const fillMissingBriefingFields = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return {
    ...record,
    decisions: record.decisions ?? [],
    risks: record.risks ?? [],
  };
};

const isImpactShape = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isStringArray(record.quantitative) && typeof record.qualitative === 'string'
  );
};

const isImprovementShape = (value: unknown): boolean => {
  if (value === null) {
    return true;
  }
  if (typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.before === 'string' && typeof record.after === 'string';
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
