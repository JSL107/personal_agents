import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { IntentClassification } from '../intent-classification.type';
import { RouterException } from '../router.exception';
import { RouterErrorCode } from '../router-error-code.enum';

// LLM 응답 텍스트를 IntentClassification 으로 변환. 결과가 schema 와 안 맞으면 RouterException.
// LLM 이 system prompt 의 "코드 fence 금지" 를 어겨도 graceful — \`\`\`json fence 가 있으면 제거 후 parse.
export const parseIntentClassification = (
  raw: string,
): IntentClassification => {
  const cleaned = stripCodeFence(raw.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new RouterException({
      code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
      message: `intent classifier JSON parse 실패: ${cleaned.slice(0, 120)}`,
      status: DomainStatus.INTERNAL,
      cause: error,
    });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RouterException({
      code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
      message: `intent classifier 출력이 객체가 아님: ${typeof parsed}`,
      status: DomainStatus.INTERNAL,
    });
  }

  const obj = parsed as Record<string, unknown>;
  const agentTypeRaw = obj.agentType;
  if (typeof agentTypeRaw !== 'string') {
    throw new RouterException({
      code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
      message: `intent classifier agentType 필드가 string 이 아님: ${typeof agentTypeRaw}`,
      status: DomainStatus.INTERNAL,
    });
  }
  if (agentTypeRaw !== 'UNKNOWN' && !isAgentType(agentTypeRaw)) {
    throw new RouterException({
      code: RouterErrorCode.INTENT_CLASSIFY_FAILED,
      message: `intent classifier 가 미지원 agentType 반환: ${agentTypeRaw}`,
      status: DomainStatus.INTERNAL,
    });
  }

  const confidenceRaw = obj.confidence;
  const confidence =
    typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0;
  const reasonRaw = obj.reason;
  const reason = typeof reasonRaw === 'string' ? reasonRaw : '';

  // userInstruction 은 선택 — 비어있지 않은 string 일 때만 채운다 (공백뿐 / 비-string / 누락은 undefined).
  const userInstructionRaw = obj.userInstruction;
  const userInstruction =
    typeof userInstructionRaw === 'string' &&
    userInstructionRaw.trim().length > 0
      ? userInstructionRaw.trim()
      : undefined;

  return {
    agentType:
      agentTypeRaw === 'UNKNOWN' ? 'UNKNOWN' : (agentTypeRaw as AgentType),
    confidence,
    reason,
    ...(userInstruction !== undefined ? { userInstruction } : {}),
  };
};

const stripCodeFence = (text: string): string => {
  const fenceStripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  return fenceStripped;
};

const isAgentType = (value: string): value is AgentType =>
  (Object.values(AgentType) as string[]).includes(value);
