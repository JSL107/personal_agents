import { AgentType, ModelProviderName } from '../model-router.type';

// 모델 호출 한 번의 사실. 프롬프트·응답 본문은 싣지 않는다 — 호출됐다·실패했다·왜·얼마나
// 걸렸다까지만. 본문을 담기 시작하면 이 기록이 대화 로그가 된다.
export interface ModelCallFacts {
  agentType: AgentType;
  status: 'SUCCEEDED' | 'FAILED';
  provider: ModelProviderName;
  fallbackUsed: boolean;
  primaryError: string | null;
  fallbackError: string | null;
  durationMs: number;
}

// 호출 사실에 run id 를 더한 것. run id 는 기록하는 쪽(router)이 활성 스코프에서 채운다.
export interface ModelCallLogInput extends ModelCallFacts {
  // AgentRunService.execute 스코프 안이면 그 run id. 없으면 원장 밖 호출이다.
  agentRunId: number | null;
}

export interface ModelCallLogPort {
  // best-effort — 구현체가 실패를 삼킨다. 기록이 모델 호출 결과를 바꾸면 안 된다.
  record(input: ModelCallLogInput): Promise<void>;
}

export const MODEL_CALL_LOG_PORT = Symbol('MODEL_CALL_LOG_PORT');
