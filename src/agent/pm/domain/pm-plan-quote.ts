import { coerceToDailyPlan } from './prompt/previous-plan-formatter';

const PM_PLAN_QUOTE_ITEM_LIMIT = 3;

// 아침 계획의 인용 — 최우선 1건과 오전 항목 제목. 판정 댓글은 저녁에 보이므로
// 무슨 계획이었는지 인용이 없으면 "쓸모 있었나" 를 답할 수 없다(2026-10-28 사용자 피드백).
// 원장 output 은 다른 PM 조회처럼 coerceToDailyPlan 으로 읽는다. 모양이 안 맞으면 인용 없이 버튼만 나간다.
export const formatPmPlanQuote = (output: unknown): string | undefined => {
  const plan = coerceToDailyPlan(output);
  if (!plan) {
    return undefined;
  }
  const titles = [plan.topPriority, ...plan.morning]
    .map((task) => task.title.trim())
    .filter((title) => title.length > 0);
  const unique = [...new Set(titles)].slice(0, PM_PLAN_QUOTE_ITEM_LIMIT);
  if (unique.length === 0) {
    return undefined;
  }
  return unique.join(' / ');
};
