import { DailyReview } from '../work-reviewer.type';

// 모델이 방금 낸 응답용 — decisions / risks 가 반드시 있어야 한다.
// 누락을 빈 배열로 관대하게 채우면 "모델이 그 축을 빠뜨렸다" 가 "안건이 없다" 로 둔갑해
// 대표가 봐야 할 결정사항·위험이 조용히 사라진다. output schema 가 두 필드를 required 로
// 요구하므로, 여기까지 빠져서 오면 그것은 호환 문제가 아니라 모델 오출력이다.
export const isDailyReviewShape = (value: unknown): value is DailyReview => {
  const record = value as Record<string, unknown>;
  return (
    isStoredDailyReviewShape(value) &&
    isStringArray(record.decisions) &&
    isStringArray(record.risks)
  );
};

// 원장(agent_run.output)에 적재된 과거 회고 재조회용 — decisions / risks 누락을 허용한다.
// 두 필드 도입(2026-09-04) 이전 output 에는 키가 없는데, 이를 형태 불일치로 떨구면
// 그 이전 회고가 전부 "이전 worklog 없음" 으로 조용히 사라진다(PM 이 어제 회고를 읽는 경로).
// 누락은 undefined 그대로 남겨 호출부가 "미검토" 로 다루게 한다 — 빈 배열로 채우지 않는다.
export const isStoredDailyReviewShape = (
  value: unknown,
): value is DailyReview => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.summary === 'string' &&
    isImpactShape(record.impact) &&
    isImprovementShape(record.improvementBeforeAfter) &&
    isOptionalStringArray(record.decisions) &&
    isOptionalStringArray(record.risks) &&
    isStringArray(record.nextActions) &&
    typeof record.oneLineAchievement === 'string'
  );
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

// null 은 통과시키지 않는다 — 모델이 null 을 내면 그것도 오출력이라 형태 검사에서 걸려야 한다.
const isOptionalStringArray = (value: unknown): boolean =>
  value === undefined || isStringArray(value);
