import { AgentType } from '../../model-router/domain/model-router.type';

// worker 가 한 번 실행됐을 때 무엇을 남기는지의 등급.
// OpenAI Apps SDK 의 tool safety annotation (readOnlyHint / destructiveHint) 과 같은 목적 —
// 분류가 확실하지 않을 때 "그냥 실행"과 "되물어보기"를 가르는 기준이다.
//
// 등급은 방어 장치(PreviewGate) 유무가 아니라 **행동 자체의 성질**로 매긴다.
// 게이트는 등급 위에 얹는 방어이지 등급을 낮추는 근거가 아니다.
export enum AgentSafetyLevel {
  // 문서·분석 산출물만 낸다. agent_run 원장 기록 외에 남기는 것이 없어
  // 오분류로 실행돼도 사용자가 결과를 무시하면 끝난다.
  READ_ONLY = 'READ_ONLY',
  // 사용자 도메인 데이터를 기록하지만 되돌릴 경로가 있다 (취소·수정 usecase 존재).
  WRITE = 'WRITE',
  // 레포·외부 서비스에 되돌리기 어려운 변화를 남긴다.
  IRREVERSIBLE = 'IRREVERSIBLE',
}

// Record 로 전수 강제 — AgentType 에 worker 를 추가하면 여기서 컴파일 에러가 난다.
// 기본값을 두지 않는 이유: 등급이 빠진 worker 가 READ_ONLY 로 조용히 취급되면
// 가장 위험한 신규 worker 가 가장 느슨한 등급을 받는다.
export const AGENT_SAFETY_LEVEL: Record<AgentType, AgentSafetyLevel> = {
  // --- 문서·분석 산출물만 내는 worker ---
  [AgentType.PM]: AgentSafetyLevel.READ_ONLY,
  [AgentType.BE]: AgentSafetyLevel.READ_ONLY,
  [AgentType.CODE_REVIEWER]: AgentSafetyLevel.READ_ONLY,
  [AgentType.WORK_REVIEWER]: AgentSafetyLevel.READ_ONLY,
  [AgentType.IMPACT_REPORTER]: AgentSafetyLevel.READ_ONLY,
  [AgentType.PO_SHADOW]: AgentSafetyLevel.READ_ONLY,
  [AgentType.BE_SCHEMA]: AgentSafetyLevel.READ_ONLY,
  [AgentType.BE_TEST]: AgentSafetyLevel.READ_ONLY,
  [AgentType.BE_SRE]: AgentSafetyLevel.READ_ONLY,
  [AgentType.BE_FIX]: AgentSafetyLevel.READ_ONLY,
  [AgentType.CTO]: AgentSafetyLevel.READ_ONLY,
  [AgentType.PO_EVAL]: AgentSafetyLevel.READ_ONLY,
  [AgentType.CEO]: AgentSafetyLevel.READ_ONLY,
  // 자연어 경로(CareerMateDispatcher)는 프로필·이력서·포트폴리오 렌더링까지만 한다.
  // 사이트 발행(PublishPortfolioSiteUsecase)은 autopilot cron 전용이라 라우터로 도달하지 않는다.
  [AgentType.CAREER_MATE]: AgentSafetyLevel.READ_ONLY,
  // 조회 전용 — 매수/매도 등록 경로가 없다 (분류 프롬프트에도 명시돼 있다).
  [AgentType.PAPER_TRADE]: AgentSafetyLevel.READ_ONLY,

  // --- 라우터 미등록 (cron·webhook·내부 판정 전용) ---
  [AgentType.SUBCONSCIOUS_GATE]: AgentSafetyLevel.READ_ONLY,
  [AgentType.CONTRADICTION_JUDGE]: AgentSafetyLevel.READ_ONLY,
  [AgentType.REVIEW_REPLY_JUDGE]: AgentSafetyLevel.READ_ONLY,
  [AgentType.HUMANIZER]: AgentSafetyLevel.READ_ONLY,
  [AgentType.DOCS_AUDIT_OPTIMIZER]: AgentSafetyLevel.READ_ONLY,
  [AgentType.DOCS_AUDIT_EVALUATOR]: AgentSafetyLevel.READ_ONLY,
  [AgentType.PREFERENCE_LEARNING]: AgentSafetyLevel.READ_ONLY,
  [AgentType.EVENING_RETRO]: AgentSafetyLevel.READ_ONLY,
  [AgentType.OPS_SUPERVISOR]: AgentSafetyLevel.READ_ONLY,
  [AgentType.INVEST]: AgentSafetyLevel.READ_ONLY,
  [AgentType.PAPER_RECOMMEND]: AgentSafetyLevel.READ_ONLY,
  [AgentType.CTO_STUDY]: AgentSafetyLevel.READ_ONLY,

  // --- 사용자 데이터를 기록하는 worker (되돌릴 경로 있음) ---
  // registerLeave / cancelLeave — 잘못 등록해도 취소로 되돌린다.
  [AgentType.VACATION]: AgentSafetyLevel.WRITE,
  // addApplication / updateApplication — 상태 변경으로 되돌린다.
  [AgentType.JOB_APPLICATION]: AgentSafetyLevel.WRITE,
  // Notion '블로그 초안' DB 에 페이지를 만들고 상태를 갱신한다.
  [AgentType.BLOG]: AgentSafetyLevel.WRITE,

  // --- 외부에 되돌리기 어려운 변화를 남기는 worker ---
  // 익명화한 초안을 GitHub Pages 로 발행한다 (PreviewGate 승인이 앞에 있지만 등급은 행동 기준).
  [AgentType.BLOG_PUBLISH]: AgentSafetyLevel.IRREVERSIBLE,
  // issues.addLabels — 남의 레포 이슈에 라벨을 단다.
  [AgentType.ISSUE_LABELER]: AgentSafetyLevel.IRREVERSIBLE,
};

// ponytail: 등급은 지금 분류 프롬프트의 ⚠️ 표식(+ 동기화 테스트)으로만 소비된다.
// "확신이 낮으면 실행 대신 되묻기" 같은 하드 게이트를 얹으려면 실제 confidence 분포부터
// 실측해야 한다 — 현재 confidence 는 로그로만 나가고 원장에 남지 않아, 임계값을 정할 근거가
// 없다. 근거 없이 막으면 정상 조회(예: "남은 휴가 며칠?")까지 되묻게 된다.
