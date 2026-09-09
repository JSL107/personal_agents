// LLM 응답 텍스트에서 JSON object 본문만 robust 하게 추출.
//
// 4개 worker parser (PM / BE / ISSUE_LABELER / WORK_REVIEWER) 가 LLM 에
// "JSON 객체 하나만 출력" 을 요구하지만 실제로는 다양한 노이즈 패턴이 섞여 들어와
// `JSON.parse` 가 던지는 케이스가 잦다. 본 헬퍼는 그 중 흔한 3가지 패턴을 모두 흡수한다.
//
// 1) 전체가 code fence: \`\`\`json\n{...}\n\`\`\` — 원래 패턴.
// 2) code fence + 앞뒤 설명 텍스트: "여기 plan 입니다:\n\`\`\`json\n{...}\n\`\`\`\n위 내용은..."
// 3) fence 없이 앞뒤 설명만: "다음과 같습니다.\n{...}\n그리고..."
//
// 세 패턴을 후보로 모아 **실제로 JSON object 로 파싱되는 첫 후보**를 고른다. 패턴 순서만 보고
// 첫 매치를 그대로 돌려주면, JSON string 값 안에 있는 마크다운 코드펜스(개발 블로그 본문·diff 등)를
// 응답 fence 로 오인해 코드 블록 내용을 JSON 이라 내놓는다 — 패턴 2 의 정규식은 문자열 경계를
// 모르기 때문이다. (BLOG_PUBLISH run#864 실패의 실제 원인.)
// 모두 fail 시 첫 후보(없으면 원본)를 반환 — 호출자가 `JSON.parse` 의 SyntaxError 를 받음.
export const extractJsonObjectText = (rawText: string): string => {
  const trimmed = rawText.trim();
  const candidates: string[] = [];

  // 1) 전체가 code fence — 원래 패턴 (anchored)
  const wholeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (wholeFenceMatch) {
    candidates.push(wholeFenceMatch[1].trim());
  }

  // 2) 본문 안에 code fence (앞뒤 설명 텍스트 동반) — 첫 fence 본문
  const innerFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (innerFenceMatch) {
    candidates.push(innerFenceMatch[1].trim());
  }

  // 3) fence 없는 mixed content — 첫 `{` 부터 마지막 `}` 까지 substring
  //    JSON object 가정. JSON array (`[...]`) 응답은 본 프로젝트에서 사용 안 함.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return candidates.find(isJsonObjectText) ?? candidates[0] ?? trimmed;
};

// 후보가 JSON object 로 파싱되는지 — 패턴 선택의 유일하게 믿을 수 있는 기준.
const isJsonObjectText = (candidate: string): boolean => {
  try {
    const parsed: unknown = JSON.parse(candidate);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
};

// parser 의 catch 분기에서 server log 에 raw 응답 첫 N 자를 남겨 fail 패턴 추적.
// 사용자 메시지에는 노출하지 않고 exception cause 에만 포함 — RouterMessageHandler 의
// `toUserFacingErrorMessage` 는 cause 를 무시하고 message 만 노출하므로 user 노출 X.
const RAW_TAIL_LIMIT = 300;

export const buildJsonParseCauseMessage = (
  error: unknown,
  rawText: string,
): string => {
  const baseMessage = error instanceof Error ? error.message : String(error);
  const tail = rawText.trim().slice(0, RAW_TAIL_LIMIT);
  return `${baseMessage} — raw=${tail}`;
};

// LLM 응답에서 JSON **배열** 본문만 추출. 위 object 용과 원칙은 같다 — 후보를 여러 개
// 모아 실제로 파싱되는 첫 후보를 고른다.
//
// 별도 함수인 이유: `extractJsonObjectText` 는 `{`/`}` 로 후보를 만들고 파싱 성공 기준도
// object 라, 배열 응답에 그대로 쓰면 후보가 하나도 안 잡힌다. 기존 4개 worker parser 의
// 동작을 건드리지 않으려고 확장 대신 나란히 둔다.
//
// 첫 `[` ~ 마지막 `]` 하나만 쓰면 모델이 `[판정 결과]` 같은 라벨을 앞에 붙이거나 뒤에
// `[참고]` 를 덧붙이는 순간 매치 구간이 JSON 이 아니게 되고, 호출부는 그것을 "모델이
// 판단 불가라고 답했다" 와 구분하지 못한다.
export const extractJsonArrayText = (rawText: string): string | null => {
  const trimmed = rawText.trim();
  const candidates: string[] = [];

  const wholeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (wholeFenceMatch) {
    candidates.push(wholeFenceMatch[1].trim());
  }

  const innerFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (innerFenceMatch) {
    candidates.push(innerFenceMatch[1].trim());
  }

  // 넓은 구간(첫 `[` ~ 마지막 `]`)을 먼저 시도한다 — 이것이 기존 동작이고, 응답이
  // 깨끗할 때 항상 맞는다.
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  // 넓은 구간이 라벨·꼬리 때문에 깨질 때만 배열-of-객체를 직접 겨냥한다.
  // 순서가 중요하다: 이쪽을 먼저 쓰면 값 안의 중첩 배열(`"evidence": [{...}]`)이
  // 단독으로 파싱에 성공해 바깥 배열 대신 선택될 수 있다.
  const firstObjectBracket = trimmed.indexOf('[{');
  const lastObjectBracket = trimmed.lastIndexOf('}]');
  if (firstObjectBracket !== -1 && lastObjectBracket > firstObjectBracket) {
    candidates.push(trimmed.slice(firstObjectBracket, lastObjectBracket + 2));
  }

  return candidates.find(isJsonArrayText) ?? null;
};

const isJsonArrayText = (candidate: string): boolean => {
  try {
    return Array.isArray(JSON.parse(candidate));
  } catch {
    return false;
  }
};
