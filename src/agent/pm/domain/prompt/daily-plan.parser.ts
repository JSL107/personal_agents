import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import {
  buildJsonParseCauseMessage,
  extractJsonObjectText,
} from '../../../../common/util/llm-json-extract.util';
import { PmAgentException } from '../pm-agent.exception';
import { DailyPlan, StalledTask } from '../pm-agent.type';
import { PmAgentErrorCode } from '../pm-agent-error-code.enum';
import { isDailyPlanShape } from './daily-plan.shape';

// LLM 응답 텍스트를 DailyPlan 구조로 파싱한다.
// extractJsonObjectText 가 code fence (전체/부분) + fence 없는 mixed content 3가지 noise 패턴을
// 모두 흡수하므로 본 parser 는 추출 결과를 JSON.parse 하는 데만 집중.
export const parseDailyPlan = (text: string): DailyPlan => {
  const cleaned = extractJsonObjectText(text);

  const parsed = parseJson(cleaned, text);

  if (!isDailyPlanShape(parsed)) {
    throw new PmAgentException({
      code: PmAgentErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답이 DailyPlan 스키마와 맞지 않습니다.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  const record = parsed as DailyPlan & Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, 'stalledTasks')) {
    return parsed;
  }
  return {
    ...parsed,
    stalledTasks: normalizeStalledTasks(record.stalledTasks),
  };
};

const parseJson = (text: string, rawText: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new PmAgentException({
      code: PmAgentErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답을 JSON 으로 파싱하지 못했습니다.',
      status: DomainStatus.BAD_GATEWAY,
      cause: new Error(buildJsonParseCauseMessage(error, rawText)),
    });
  }
};

const normalizeStalledTasks = (value: unknown): StalledTask[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeStalledTask)
    .filter((task): task is StalledTask => task !== null);
};

const normalizeStalledTask = (value: unknown): StalledTask | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    record.id.length === 0 ||
    typeof record.title !== 'string' ||
    record.title.length === 0 ||
    typeof record.daysStalled !== 'number' ||
    !Number.isFinite(record.daysStalled)
  ) {
    return null;
  }

  const normalized: StalledTask = {
    id: record.id,
    title: record.title,
    daysStalled: Math.max(1, Math.floor(record.daysStalled)),
  };
  if (typeof record.url === 'string') {
    normalized.url = record.url;
  }
  return normalized;
};
