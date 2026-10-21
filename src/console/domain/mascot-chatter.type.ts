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
  reason?: 'MODEL_FAILED' | 'INVALID_JSON' | 'INVALID_LINE' | 'NOTHING_TO_SAY';
}

export type MascotChatterTrigger = 'IDLE' | 'EVENTS' | 'RETURN' | 'PROGRESS';
