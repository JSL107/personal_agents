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
  // 휴가 계산기 — 결정론적 계산 워커. 계산 자체엔 LLM 미사용.
  // AGENT_TO_PROVIDER 매핑은 자연어 멘션의 날짜/일수 파라미터 추출(VacationDispatcher) 용도로만 소비된다.
  VACATION = 'VACATION',
  // 블로그 초안 릴레이 — Hermes tistory-blog 스킬을 `hermes -z` 로 호출하는 외부 에이전트 디스패치.
  // model-router 미경유 (AGENT_TO_PROVIDER 의 BLOG 는 Record exhaustive 충족용 sentinel).
  BLOG = 'BLOG',
  // 이직 메이트 — merged PR 합성 → 역량 프로필 허브 + 이력서/포트폴리오 (자연어 멘션 전용).
  // 프로필 합성 시 model-router 경유 (구조화 JSON 강점 → Claude).
  CAREER_MATE = 'CAREER_MATE',
  // 지원 추적 CRM — 회사/직무 지원 기록·상태변경·조회 (자연어 멘션 전용 + 넛지 cron).
  // CRUD 는 결정론, 자연어 파라미터 추출 시에만 model-router 경유 (경량 → ChatGPT).
  JOB_APPLICATION = 'JOB_APPLICATION',
  // 내부 proactive 게이트 — redacted 상태 변화를 promote/drop 분류. 경량 → ChatGPT.
  // 슬래시 핸들러/ResponseCode/retry-run 체크리스트 비대상 (사용자 비노출 내부 타입).
  SUBCONSCIOUS_GATE = 'SUBCONSCIOUS_GATE',
  // L4 knowledge-lint — 유사 에피소드 쌍의 의미 충돌 판정. 경량 분류 + claude -p 회피 → ChatGPT.
  // 슬래시/ResponseCode/retry-run 비대상 (내부 판정 전용).
  CONTRADICTION_JUDGE = 'CONTRADICTION_JUDGE',
  // 자동 보고서 윤문(humanize) — 서술 필드를 AI 티 없이 다듬는 내부 후처리. 경량 → ChatGPT(codex).
  // 슬래시/ResponseCode/retry-run 비대상 (내부 전용 — SUBCONSCIOUS_GATE 선례).
  HUMANIZER = 'HUMANIZER',
  // docs-sync-audit Layer 2 — 문서 의미 드리프트 자기수정 루프. 둘 다 경량 판정 → ChatGPT.
  // optimizer: 코드 변경 기준 문서 수정안 생성 / evaluator: 그 수정안이 코드와 일치하는지 채점.
  // 슬래시/ResponseCode/retry-run 비대상 (내부 루프 전용 — CONTRADICTION_JUDGE 선례).
  // AGENT_REGISTRY 에는 등록한다 (agent-registry.spec 이 enum 집합 일치를 강제 — CONTRADICTION_JUDGE 동일).
  DOCS_AUDIT_OPTIMIZER = 'DOCS_AUDIT_OPTIMIZER',
  DOCS_AUDIT_EVALUATOR = 'DOCS_AUDIT_EVALUATOR',
  // 내부 proactive — 주간 선호 학습. 신호 배치 → 프로필 diff 추론. 경량 판정 → ChatGPT.
  // 슬래시 핸들러/ResponseCode/retry-run 체크리스트 비대상(사용자 비노출 내부 타입).
  PREFERENCE_LEARNING = 'PREFERENCE_LEARNING',
  // 저녁 회고→발행 후보 — 매일 19:00 KST evening 그룹. codex 로 회고/후보 선별/블로그 본문 생성.
  // BLOG(Hermes sentinel)와 달리 실제 route() 를 탄다.
  // 슬래시/ResponseCode/retry-run 비대상 (autopilot task, 사용자 비노출 내부 타입).
  EVENING_RETRO = 'EVENING_RETRO',
  // 월간 운영 품질 이상 신호의 개선 제안 생성. 슬래시 없음, autopilot 전용.
  OPS_SUPERVISOR = 'OPS_SUPERVISOR',
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
