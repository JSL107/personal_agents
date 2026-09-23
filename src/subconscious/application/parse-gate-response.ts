import { extractJsonArrayText } from '../../common/util/llm-json-extract.util';
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
// validKeys 밖 key 는 제거(fail-closed).
//
// 본문 추출은 `extractJsonArrayText` 에 맡긴다 — 예전에는 `JSON.parse(raw.trim())` 로
// 바로 읽어, 모델이 응답을 코드펜스로 감싸거나 앞뒤에 설명을 붙이면 통째로 터졌다.
// 2026-09-17~19 codex 쿼터 소진으로 claude 폴백을 탄 86 회차가 **전건** 그렇게 유실됐다
// (같은 기간 codex 회차는 0건). 그 사흘간 제안이 하나도 나가지 않았다.
//
// 배열을 못 뽑으면 `null` 을 돌려 **빈 배열과 구분한다.** 빈 배열은 "응답은 읽혔고 유효한
// 판정이 없었다", null 은 "응답 자체를 못 읽었다" 다. 둘을 같은 값으로 두면 고장난 회차가
// 평온한 회차와 글자가 같아진다 — 위 86 회차가 계약 점수 만점으로 기록된 이유이고,
// 호출부(`llm-subconscious-gate.ts`)가 catch 분기에 로그를 둔 것과 같은 취지다.
export const parseGateResponse = (
  raw: string,
  validKeys: Set<string>,
): GateDecision[] | null => {
  const arrayText = extractJsonArrayText(raw);
  if (arrayText === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayText);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
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
