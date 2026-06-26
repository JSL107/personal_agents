import { AgentType } from '../../model-router/domain/model-router.type';
import { GateDecision } from '../domain/subconscious.type';

const toAgentType = (value: unknown): AgentType | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  return (Object.values(AgentType) as string[]).includes(value)
    ? (value as AgentType)
    : undefined;
};

// LLM 원응답(JSON 배열 기대)을 GateDecision[] 으로 매핑하는 순수 함수.
// JSON 파싱 실패 / 배열 아님 / validKeys 밖 key 는 전부 제거(fail-closed).
export const parseGateResponse = (
  raw: string,
  validKeys: Set<string>,
): GateDecision[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const decisions: GateDecision[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const changeKey = record.changeKey;
    if (typeof changeKey !== 'string' || !validKeys.has(changeKey)) {
      continue;
    }
    decisions.push({
      changeKey,
      promote: record.promote === true,
      reason: typeof record.reason === 'string' ? record.reason : '',
      suggestedAgentType: toAgentType(record.suggestedAgentType),
      proposalText:
        typeof record.proposalText === 'string'
          ? record.proposalText
          : undefined,
    });
  }
  return decisions;
};
