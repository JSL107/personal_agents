const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const readText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.trim() || undefined;
};

const PM_PLAN_QUOTE_ITEM_LIMIT = 3;

// 아침 계획의 인용 — 최우선 1건과 오전 항목 제목. 판정 댓글은 저녁에 보이므로
// 무슨 계획이었는지 인용이 없으면 "쓸모 있었나" 를 답할 수 없다(2026-10-28 사용자 피드백).
export const formatPmPlanQuote = (output: unknown): string | undefined => {
  const plan = asRecord(output);
  if (!plan) {
    return undefined;
  }
  const morning = Array.isArray(plan.morning) ? plan.morning : [];
  const titles = [
    readText(asRecord(plan.topPriority)?.title),
    ...morning.map((item) => readText(asRecord(item)?.title)),
  ].filter((title): title is string => title !== undefined);
  const unique = [...new Set(titles)].slice(0, PM_PLAN_QUOTE_ITEM_LIMIT);
  if (unique.length === 0) {
    return undefined;
  }
  return unique.join(' / ');
};
