export interface VerdictRow<TVerdict extends string> {
  id: number;
  verdict: TVerdict;
  reason: string;
}

export interface ParseVerdictBatchInput<TVerdict extends string> {
  text: string;
  ids: number[];
  validVerdicts: ReadonlySet<string>;
  // 파싱 실패·누락 항목에 쓸 값. 판정이 안 된 카드를 결론으로 밀지 않기 위한 안전값이라
  // 호출부가 반드시 "미결" 쪽 값을 넘겨야 한다.
  fallback: TVerdict;
}

// 모델 응답에서 JSON 배열을 뽑아 id 별 판정으로 정규화한다. 입력 id 전건에 대해
// 결과를 돌려주므로(누락은 fallback) 호출부는 길이를 신뢰할 수 있다.
export const parseVerdictBatch = <TVerdict extends string>({
  text,
  ids,
  validVerdicts,
  fallback,
}: ParseVerdictBatchInput<TVerdict>): VerdictRow<TVerdict>[] => {
  const toFallback = (): VerdictRow<TVerdict>[] =>
    ids.map((id) => ({ id, verdict: fallback, reason: '' }));

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    return toFallback();
  }

  try {
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) {
      return toFallback();
    }
    const byId = new Map<number, VerdictRow<TVerdict>>();
    for (const value of parsed) {
      if (typeof value !== 'object' || value === null) {
        continue;
      }
      const record = value as Record<string, unknown>;
      if (
        typeof record.id !== 'number' ||
        typeof record.verdict !== 'string' ||
        !validVerdicts.has(record.verdict)
      ) {
        continue;
      }
      byId.set(record.id, {
        id: record.id,
        verdict: record.verdict as TVerdict,
        reason: typeof record.reason === 'string' ? record.reason : '',
      });
    }
    return ids.map(
      (id) => byId.get(id) ?? { id, verdict: fallback, reason: '' },
    );
  } catch {
    return toFallback();
  }
};
