import { extractJsonArrayText } from '../../../common/util/llm-json-extract.util';

export interface VerdictRow<TVerdict extends string> {
  id: number;
  verdict: TVerdict;
  reason: string;
}

export interface ParseVerdictBatchResult<TVerdict extends string> {
  rows: VerdictRow<TVerdict>[];
  // 응답에서 JSON 배열을 아예 못 뽑았는지. 전건 fallback 이라는 결과만으로는
  // "모델이 정말 판단 불가라고 답함" 과 "파싱이 깨짐" 이 구분되지 않는다 —
  // 후자는 새 답글이 없는 한 다음 회차에도 같은 입력으로 그대로 재현된다.
  extracted: boolean;
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
}: ParseVerdictBatchInput<TVerdict>): ParseVerdictBatchResult<TVerdict> => {
  const toFallback = (): VerdictRow<TVerdict>[] =>
    ids.map((id) => ({ id, verdict: fallback, reason: '' }));

  const arrayText = extractJsonArrayText(text);
  if (arrayText === null) {
    return { rows: toFallback(), extracted: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch {
    return { rows: toFallback(), extracted: false };
  }
  if (!Array.isArray(parsed)) {
    return { rows: toFallback(), extracted: false };
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
  return {
    rows: ids.map(
      (id) => byId.get(id) ?? { id, verdict: fallback, reason: '' },
    ),
    extracted: true,
  };
};
