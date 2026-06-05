// LLM 응답 텍스트에서 JSON object 본문만 robust 하게 추출.
//
// 5개 worker parser (PM / BE / ISSUE_LABELER / BE_DIFF / WORK_REVIEWER) 가 LLM 에
// "JSON 객체 하나만 출력" 을 요구하지만 실제로는 다양한 노이즈 패턴이 섞여 들어와
// `JSON.parse` 가 던지는 케이스가 잦다. 본 헬퍼는 그 중 흔한 3가지 패턴을 모두 흡수한다.
//
// 1) 전체가 code fence: \`\`\`json\n{...}\n\`\`\` — 원래 패턴.
// 2) code fence + 앞뒤 설명 텍스트: "여기 plan 입니다:\n\`\`\`json\n{...}\n\`\`\`\n위 내용은..."
// 3) fence 없이 앞뒤 설명만: "다음과 같습니다.\n{...}\n그리고..."
//
// 모두 fail 시 원본 텍스트를 그대로 반환 — 호출자가 `JSON.parse` 의 SyntaxError 를 받음.
export const extractJsonObjectText = (rawText: string): string => {
  const trimmed = rawText.trim();

  // 1) 전체가 code fence — 원래 패턴 (anchored)
  const wholeFenceMatch = trimmed.match(
    /^```(?:json)?\s*([\s\S]*?)\s*```$/,
  );
  if (wholeFenceMatch) {
    return wholeFenceMatch[1].trim();
  }

  // 2) 본문 안에 code fence (앞뒤 설명 텍스트 동반) — 첫 fence 본문만 추출
  const innerFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (innerFenceMatch) {
    return innerFenceMatch[1].trim();
  }

  // 3) fence 없는 mixed content — 첫 `{` 부터 마지막 `}` 까지 substring
  //    JSON object 가정. JSON array (`[...]`) 응답은 본 프로젝트에서 사용 안 함.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
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
