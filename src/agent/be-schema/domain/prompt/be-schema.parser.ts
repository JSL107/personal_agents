import { SchemaProposal } from '../be-schema.type';

// LLM 응답 → SchemaProposal. raw JSON / fence 둘 다 수용 (po-expand parser 와 동일 패턴).
// 필드 누락 / 잘못된 타입은 graceful default — Slack 응답이 "파싱 실패" 로 끊기지 않게 한다.
export const parseSchemaProposal = (
  request: string,
  text: string,
): SchemaProposal => {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text.trim();

  const parsed = tryParseJson(candidate);
  if (!parsed) {
    return {
      request,
      proposedModel: text.trim(),
      affectedRelations: [],
      requiredIndexes: [],
      conventionChecks: ['(파싱 실패 — LLM 원문을 proposedModel 로 보존)'],
      risks: [],
      migrationStrategy: '(파싱 실패)',
      reasoning: '(파싱 실패)',
    };
  }

  return {
    request,
    proposedModel:
      typeof parsed.proposedModel === 'string' ? parsed.proposedModel : '',
    affectedRelations: asStringArray(parsed.affectedRelations),
    requiredIndexes: asStringArray(parsed.requiredIndexes),
    conventionChecks: asStringArray(parsed.conventionChecks),
    risks: asStringArray(parsed.risks),
    migrationStrategy:
      typeof parsed.migrationStrategy === 'string'
        ? parsed.migrationStrategy
        : '',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  };
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? (value as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

const tryParseJson = (text: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};
