import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { BeAgentException } from '../be-agent.exception';
import { BackendPlan } from '../be-agent.type';
import { BeAgentErrorCode } from '../be-agent-error-code.enum';
import { isBackendPlanShape } from './backend-plan.shape';

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

export const parseBackendPlan = (text: string): BackendPlan => {
  const cleaned = stripCodeFence(text.trim());
  const parsed = parseJson(cleaned);

  if (!isBackendPlanShape(parsed)) {
    throw new BeAgentException({
      code: BeAgentErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답이 BackendPlan 스키마와 맞지 않습니다.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  return parsed;
};

const stripCodeFence = (text: string): string => {
  const match = text.match(CODE_FENCE_PATTERN);
  return match ? match[1].trim() : text;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new BeAgentException({
      code: BeAgentErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답을 JSON 으로 파싱하지 못했습니다.',
      status: DomainStatus.BAD_GATEWAY,
      cause: error,
    });
  }
};
