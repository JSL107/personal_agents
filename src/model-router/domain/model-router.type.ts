export enum ModelProviderName {
  CHATGPT = 'CHATGPT',
  CLAUDE = 'CLAUDE',
  GEMINI = 'GEMINI',
}

export enum AgentType {
  PM = 'PM',
  BE = 'BE',
  CODE_REVIEWER = 'CODE_REVIEWER',
  WORK_REVIEWER = 'WORK_REVIEWER',
  IMPACT_REPORTER = 'IMPACT_REPORTER',
  PO_SHADOW = 'PO_SHADOW',
  BE_SCHEMA = 'BE_SCHEMA',
  BE_TEST = 'BE_TEST',
  BE_SRE = 'BE_SRE',
  BE_FIX = 'BE_FIX',
  // V3 비전 workflow phase plan §4.2 P2 Assign — PM 의 assignableTaskIds 를
  // BE worker (BE / BE_SCHEMA / BE_TEST) 로 분배 + priority/reasoning + unassigned 표시.
  CTO = 'CTO',
}

export interface CompletionRequest {
  prompt: string;
  systemPrompt?: string;
}

export interface CompletionResponse {
  text: string;
  modelUsed: string;
  provider: ModelProviderName;
}
