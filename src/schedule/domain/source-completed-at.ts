// 원천(GitHub·Notion)이 준 완료 시각을 전이에 넘길 값으로 바꾼다. 원천 시계가 우리보다
// 조금 빠르면 미래 시각이 되어 전이가 거부되고 그 업무는 영영 닫히지 않으므로 now 로 낮춘다.
export const toSourceCompletedAt = (
  source: string | null | undefined,
  now: Date,
): Date => {
  const parsed = source ? new Date(source) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed > now) {
    return now;
  }
  return parsed;
};
