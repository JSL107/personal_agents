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
  PO_EXPAND = 'PO_EXPAND',
  BE_SCHEMA = 'BE_SCHEMA',
  BE_TEST = 'BE_TEST',
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
