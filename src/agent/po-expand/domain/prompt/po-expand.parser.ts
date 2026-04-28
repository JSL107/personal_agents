import { PoOutline } from '../po-expand.type';

// PO Expand 응답 파서.
// system prompt 가 raw JSON 출력을 요구하지만, 모델이 가끔 ```json ``` 펜스로 감쌀 수 있어
// 두 형태 모두 허용한다 (codex review 지적 — fence 강제 시 raw JSON 응답이 outline=[원문 한 줄]
// 로 손상되는 회귀 방지).
export const parsePoOutline = (subject: string, text: string): PoOutline => {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text.trim();

  const parsed = tryParseJson(candidate);
  if (parsed) {
    return {
      subject,
      outline: Array.isArray(parsed.outline)
        ? (parsed.outline as string[])
        : [],
      clarifyingQuestions: Array.isArray(parsed.clarifyingQuestions)
        ? (parsed.clarifyingQuestions as string[])
        : [],
    };
  }
  // 파싱 실패 — 모델이 JSON 을 아예 안 줬거나 깨진 경우. 원문을 outline 한 줄로 보존.
  return { subject, outline: [text.trim()], clarifyingQuestions: [] };
};

const tryParseJson = (
  text: string,
):
  | { outline?: unknown; clarifyingQuestions?: unknown }
  | null => {
  try {
    return JSON.parse(text) as {
      outline?: unknown;
      clarifyingQuestions?: unknown;
    };
  } catch {
    return null;
  }
};
