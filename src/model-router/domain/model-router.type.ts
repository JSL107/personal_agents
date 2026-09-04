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
  // Notion 블로그 초안을 익명화하고 GitHub Pages 발행 승인 카드로 만든다.
  BLOG_PUBLISH = 'BLOG_PUBLISH',
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
  // PR 리뷰 루프 Phase 2a — owner 답글의 수용/기각/불명확 배치 판정.
  // 슬래시/ResponseCode/retry-run 비대상 (내부 판정 전용).
  REVIEW_REPLY_JUDGE = 'REVIEW_REPLY_JUDGE',
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
  // 보유 종목 감시 — 장 마감 후 시세를 받아 전일 대비·평단 대비 이상을 판정. 판정은 순수 계산이라
  // LLM 을 쓰지 않는다(VACATION 선례, modelUsed='deterministic'). AgentType 을 두는 이유는 모델
  // 라우팅이 아니라 **원장 등록 자격** 이다 — 이 타입이 없던 동안 주식 cron 은 매일 실행되면서도
  // agent_run 에 한 줄도 남기지 않아, 보유 종목 0건으로 아무 일도 안 하는 상태가 관측되지 않았다.
  // 슬래시/ResponseCode/retry-run 비대상 (autopilot 전용 — EVENING_RETRO 선례).
  INVEST = 'INVEST',
  // 모의투자 일일 평가 — 시세 기반 결정론 계산. LLM 을 쓰지 않으며 AgentRun 원장 등록을 위해 둔다.
  // 슬래시/ResponseCode/retry-run 비대상 (autopilot 전용 — INVEST 선례).
  PAPER_TRADE = 'PAPER_TRADE',
  // 회사 진행 현황·지연 원인 조회 전용 — LLM·AgentRun 원장 미사용, ResponseCode/TriggerType/retry 비대상.
  DELAY_REPORT = 'DELAY_REPORT',
  // 모의투자 추천 — 전략별 후보와 보유 종목을 함께 판단하는 LLM 호출이다.
  // 슬래시/dispatcher 없음, autopilot 및 CLI 진입 전용.
  PAPER_RECOMMEND = 'PAPER_RECOMMEND',
  CTO_STUDY = 'CTO_STUDY',
}

// LLM 최종 응답의 형태를 강제하는 JSON Schema. 구조를 타입으로 다시 표현하지 않는 이유는
// provider (codex CLI) 가 이 값을 그대로 파일로 받아 해석하기 때문 — 중간에 우리 타입을 끼우면
// provider 가 실제로 지원하는 subset 과 어긋날 때 그 사실이 컴파일 타임에 가려진다.
export type OutputJsonSchema = Record<string, unknown>;

export interface CompletionRequest {
  prompt: string;
  systemPrompt?: string;
  // 지정 시 모델이 이 스키마를 벗어난 응답을 만들 수 없다 (샘플링 단계 제약).
  // 프롬프트로 형식을 "부탁" 하는 것과 달리 위반 자체가 불가능해지므로, 파서의 형태 방어가
  // 사후 수습이 아니라 이중 안전망이 된다. 지원하지 않는 provider 는 무시한다 —
  // 그 경우 기존과 동일하게 프롬프트 지시에만 의존한다 (§ClaudeCliProvider 주석).
  outputSchema?: OutputJsonSchema;
}

export interface CompletionResponse {
  text: string;
  modelUsed: string;
  provider: ModelProviderName;
}
