import { ConventionViolation, PrConventionReport } from '../be-fix.type';

const VALID_CATEGORIES = new Set([
  'magic-number',
  'naming',
  'missing-braces',
  'unused-import',
  'other',
]);

// LLM JSON → PrConventionReport (LLM-derived 필드: violations, summary).
// server-injected 필드 (prRef, prTitle, baseSha, headSha, diffByteLength, diffTruncated) 는
// caller(usecase) 가 덮어쓴다 — parser 는 빈 값으로 초기화만 한다.
//
// codex P2 — suggestedFix 내부에 ``` fence 가 중첩되면 fence-regex 추출이 첫 inner fence 에서
// 종료된다. 라인 단위로 outer fence 만 strip 하거나 최외곽 `{...}` 만 추출하는 방식이 더 안전.
export const parsePrConventionReport = (text: string): PrConventionReport => {
  const trimmed = text.trim();

  // 1) raw JSON 시도.
  let parsed = tryParseJson(trimmed);

  // 2) outer fence 라인 단위 strip 후 시도 — `\`\`\`json\n{...}\n\`\`\`` 형태.
  if (!parsed) {
    const lineStripped = stripOuterFenceLines(trimmed);
    if (lineStripped !== trimmed) {
      parsed = tryParseJson(lineStripped);
    }
  }

  // 3) 마지막 fallback — 첫 `{` ~ 마지막 `}` 사이만 추출. 자유 텍스트로 감싸진 JSON 도 잡는다.
  if (!parsed) {
    const objectSlice = extractObjectSlice(trimmed);
    if (objectSlice) {
      parsed = tryParseJson(objectSlice);
    }
  }

  if (!parsed) {
    return buildFallback(text);
  }

  const violations = parseViolations(parsed.violations);
  const summary =
    typeof parsed.summary === 'string' ? parsed.summary : '(요약 없음)';

  return {
    prRef: '',
    prTitle: '',
    baseSha: '',
    headSha: '',
    diffByteLength: 0,
    diffTruncated: false,
    violations,
    summary,
  };
};

const parseViolations = (raw: unknown): ConventionViolation[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  const result: ConventionViolation[] = [];
  for (const item of raw as unknown[]) {
    if (!isRecord(item)) {
      continue;
    }
    if (typeof item.filePath !== 'string' || item.filePath.trim() === '') {
      continue;
    }
    if (typeof item.message !== 'string' || item.message.trim() === '') {
      continue;
    }
    if (typeof item.suggestedFix !== 'string') {
      continue;
    }

    const category = VALID_CATEGORIES.has(item.category as string)
      ? (item.category as ConventionViolation['category'])
      : 'other';

    result.push({
      filePath: item.filePath,
      line: typeof item.line === 'number' ? item.line : undefined,
      category,
      message: item.message,
      suggestedFix: item.suggestedFix,
    });
  }
  return result;
};

const buildFallback = (rawText: string): PrConventionReport => ({
  prRef: '',
  prTitle: '',
  baseSha: '',
  headSha: '',
  diffByteLength: 0,
  diffTruncated: false,
  violations: [],
  summary: rawText.trim().slice(0, 200) || '(LLM 응답 파싱 실패)',
  parseError: true,
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const tryParseJson = (text: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

// 첫 줄이 ```json / ``` 이고 마지막 줄이 ``` 인 outer 펜스만 라인 단위로 제거.
// suggestedFix 안의 inner ``` fence 는 보존된다.
const stripOuterFenceLines = (text: string): string => {
  const lines = text.split('\n');
  if (lines.length < 3) {
    return text;
  }
  const first = lines[0].trim();
  const last = lines[lines.length - 1].trim();
  const opensWithFence = first === '```' || first === '```json';
  if (opensWithFence && last === '```') {
    return lines.slice(1, -1).join('\n');
  }
  return text;
};

// 자유 텍스트로 감싸진 JSON object 를 위한 마지막 fallback. 첫 `{` 와 마지막 `}` 사이만 추출.
const extractObjectSlice = (text: string): string | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    return null;
  }
  return text.slice(start, end + 1);
};
