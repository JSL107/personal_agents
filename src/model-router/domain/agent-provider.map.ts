import { AgentType, ModelProviderName } from './model-router.type';

/**
 * 에이전트 → 모델 매핑. 2026-07-02 정책: 이대리 전체를 ChatGPT(codex) 단일 provider 로 전환.
 * Claude 는 primary·fallback 어디서도 사용하지 않는다(ClaudeCliProvider 코드는 롤백 대비 보존).
 *
 * usecase(NestJS DI 클래스)가 아니라 domain 의 순수 상수로 두는 이유:
 * `scripts/sync-docs.ts` 가 docs/agent-catalog.md 를 생성할 때 이 표를 import 로 읽는다.
 * usecase 에 두면 문서 생성기가 런타임 서비스 트리를 통째로 로드해야 하고, 텍스트 파싱으로
 * 우회하면 표기가 바뀔 때 조용히 어긋난다(Record 의 exhaustive 검사도 못 받는다).
 */
export const AGENT_TO_PROVIDER: Record<AgentType, ModelProviderName> = {
  [AgentType.PM]: ModelProviderName.CHATGPT,
  [AgentType.BE]: ModelProviderName.CHATGPT,
  [AgentType.CODE_REVIEWER]: ModelProviderName.CHATGPT,
  [AgentType.WORK_REVIEWER]: ModelProviderName.CHATGPT,
  [AgentType.IMPACT_REPORTER]: ModelProviderName.CHATGPT,
  [AgentType.PO_SHADOW]: ModelProviderName.CHATGPT,
  [AgentType.BE_SCHEMA]: ModelProviderName.CHATGPT,
  [AgentType.BE_TEST]: ModelProviderName.CHATGPT,
  [AgentType.BE_SRE]: ModelProviderName.CHATGPT,
  [AgentType.BE_FIX]: ModelProviderName.CHATGPT,
  [AgentType.CTO]: ModelProviderName.CHATGPT,
  [AgentType.PO_EVAL]: ModelProviderName.CHATGPT,
  [AgentType.CEO]: ModelProviderName.CHATGPT,
  [AgentType.ISSUE_LABELER]: ModelProviderName.CHATGPT,
  [AgentType.VACATION]: ModelProviderName.CHATGPT,
  // BLOG — Hermes CLI(`hermes -z`)를 직접 spawn 하는 외부 에이전트라 route() 를 거치지 않는다.
  // 이 엔트리는 Record<AgentType,...> exhaustive 타입 충족용 sentinel 일 뿐 실제 호출되지 않음.
  [AgentType.BLOG]: ModelProviderName.CHATGPT,
  [AgentType.BLOG_PUBLISH]: ModelProviderName.CHATGPT,
  [AgentType.CAREER_MATE]: ModelProviderName.CHATGPT,
  [AgentType.JOB_APPLICATION]: ModelProviderName.CHATGPT,
  [AgentType.SUBCONSCIOUS_GATE]: ModelProviderName.CHATGPT,
  [AgentType.CONTRADICTION_JUDGE]: ModelProviderName.CHATGPT,
  [AgentType.REVIEW_REPLY_JUDGE]: ModelProviderName.CHATGPT,
  // HUMANIZER — 보고서/프로필 서술 필드 윤문. HumanizeService 가 noFallback:true 로 호출(원본 유지).
  [AgentType.HUMANIZER]: ModelProviderName.CHATGPT,
  [AgentType.DOCS_AUDIT_OPTIMIZER]: ModelProviderName.CHATGPT,
  [AgentType.DOCS_AUDIT_EVALUATOR]: ModelProviderName.CHATGPT,
  [AgentType.PREFERENCE_LEARNING]: ModelProviderName.CHATGPT,
  // 저녁 회고→발행 후보 — codex 로 회고/후보 선별/블로그 본문 생성. BLOG(Hermes sentinel)와 달리 실제 route() 를 탄다.
  [AgentType.EVENING_RETRO]: ModelProviderName.CHATGPT,
  [AgentType.OPS_SUPERVISOR]: ModelProviderName.CHATGPT,
  // INVEST — 보유 종목 감시는 순수 계산이라 route() 를 거치지 않는다(modelUsed='deterministic').
  // 이 엔트리는 Record<AgentType,...> exhaustive 타입 충족용 sentinel (BLOG 선례).
  [AgentType.INVEST]: ModelProviderName.CHATGPT,
  // PAPER_TRADE — 모의투자 평가는 순수 계산이라 route() 를 거치지 않는다(modelUsed='deterministic').
  // 이 엔트리는 Record<AgentType,...> exhaustive 타입 충족용 sentinel (INVEST 선례).
  [AgentType.PAPER_TRADE]: ModelProviderName.CHATGPT,
  [AgentType.PAPER_RECOMMEND]: ModelProviderName.CHATGPT,
  [AgentType.CTO_STUDY]: ModelProviderName.CHATGPT,
};
