// 에이전트별 판단 품질 프로필. failed/failRate 는 sweep 된 좀비를 제외한 실 실패.
export interface AgentQualityProfile {
  agentType: string;
  total: number;
  failed: number;
  failRate: number;
  retries: number;
  retryRate: number;
  sweptCount: number;
}

// preview kind 별 종결 프로필. reject = cancelled + expired.
export interface PreviewQualityProfile {
  kind: string;
  applied: number;
  cancelled: number;
  expired: number;
  total: number;
  rejectRate: number;
}

export interface QualityProfiles {
  agents: AgentQualityProfile[];
  previews: PreviewQualityProfile[];
}
