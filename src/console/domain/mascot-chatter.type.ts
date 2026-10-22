import { AgentType } from '../../model-router/domain/model-router.type';

export interface MascotChatterSuggestion {
  agentType: AgentType;
  displayName: string;
  reason: string;
}

export interface MascotChatterResult {
  chatterId: string | null;
  line: string | null;
  suggestion: MascotChatterSuggestion | null;
  asks: boolean;
  hasEvents: boolean;
  // CONTEXT_FAILED 는 끝난 일·진행 중 조회 자체가 실패했다는 뜻이다. NOTHING_TO_SAY(조회는 됐고 볼 일이
  // 없음)와 구분해야 앱이 종료 카운터를 소진하지 않고 다음에 다시 묻는다.
  reason?:
    | 'MODEL_FAILED'
    | 'INVALID_JSON'
    | 'INVALID_LINE'
    | 'NOTHING_TO_SAY'
    | 'CONTEXT_FAILED';
}

export type MascotChatterTrigger = 'IDLE' | 'EVENTS' | 'RETURN' | 'PROGRESS';
