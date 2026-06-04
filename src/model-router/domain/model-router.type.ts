export enum ModelProviderName {
  CHATGPT = 'CHATGPT',
  CLAUDE = 'CLAUDE',
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
  // V3 비전 workflow phase plan §4.4 P4 Evaluate — Work Reviewer / PO Shadow /
  // Impact Reporter 3 sub-agent 직전 snapshot 을 합성 → 정성/정량 + 이력서용 careerLog.
  PO_EVAL = 'PO_EVAL',
  // V3 비전 workflow phase plan §4.5 P5 Meta — PO_EVAL (필수) + PM/CTO (선택) 의 직전 snapshot
  // 을 합성 → contextDriftReport + docsQualityReport + finalSummary. minimal 단계는 LLM 추론만
  // (컨텍스트 오염 알고리즘은 별도 R&D plan).
  CEO = 'CEO',
  // issues.opened webhook 자동 라벨링 — repo 의 기존 label vocab 안에서 적합한 label 부분집합
  // 을 LLM 분류 추론으로 골라 issues.addLabels. 새 label 생성 X (vocab 내부 선택).
  ISSUE_LABELER = 'ISSUE_LABELER',
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
