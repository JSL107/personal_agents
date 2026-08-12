export const formatPriceCollectionFailures = (
  failed: number,
  failures: string[],
): string | null => {
  if (failures.length === 0) {
    return null;
  }

  const lines = [
    '시세 수집 실패 상세',
    ...failures.map((failure) => `- ${failure}`),
  ];
  if (failed > failures.length) {
    // 전체 실패 수와 표본 한계를 함께 밝혀 audit의 조용한 절단을 사용자에게 숨기지 않는다.
    lines.push(`실패 ${failed}건 중 앞 ${failures.length}건만 표시`);
  }
  return lines.join('\n');
};
