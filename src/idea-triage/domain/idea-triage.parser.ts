import { IdeaTriageException } from './idea-triage.exception';

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

export const parseIdeaTriageOutput = (text: string): unknown => {
  const trimmed = text.trim();
  const match = CODE_FENCE_PATTERN.exec(trimmed);
  const json = match ? match[1] : trimmed;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new IdeaTriageException('아이디어 판정 출력이 JSON 이 아닙니다.');
  }
};
