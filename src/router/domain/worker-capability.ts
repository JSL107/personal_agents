import { AgentType } from '../../model-router/domain/model-router.type';

// 이대리 워커가 무엇을 하는지의 단일 소스.
//
// classifierLine 은 분류기 프롬프트의 「분류 후보」 줄 그대로다(분류기 동작을 바꾸지 않도록 글자 단위로
// 고정 — intent-classifier-system.prompt.spec.ts 의 지문 테스트). canDo 는 사용자에게 "이대리가 할 수
// 있는 일" 로 들려줄 말과 자연어 예시다 — 대화 답변(ConversationalReplyUsecase)이 이것을 싣는다.
// 예전에는 설명이 분류기 프롬프트 안에만 있어 대화 답변이 이대리의 기능을 몰랐고, 개인 봇이
// "어느 고객사의 가상계좌" 를 되물었다(2026-08-13, docs/superpowers/audits/2026-10-07-slack-output-quality-audit.md).
export interface WorkerCapability {
  agentType: AgentType;
  classifierLine: string;
  canDo: string;
}

export const WORKER_CAPABILITIES: readonly WorkerCapability[] = [
  {
    agentType: AgentType.PM,
    classifierLine:
      '그날 할 업무의 계획 수립 ("오늘 뭐해?", "내일 plan 짜줘", "TODO 정리"). **특정 날짜의 마감·신청·예약을 등록하려는 요청은 PM 이 아니라 SCHEDULE 이다.**',
    canDo: '그날 할 일 계획을 세운다. 예: "오늘 뭐해?", "내일 plan 짜줘"',
  },
  {
    // 2026-10-08: 일정 조회를 SCHEDULE 로 받는다 — 일정 워커가 조회 문장을 등록보다 먼저 알아보고
    // 등록된 일정으로 답하게 된 뒤(schedule-lookup.ts)라야 안전하다.
    agentType: AgentType.SCHEDULE,
    classifierLine:
      '⚠️ 마감·신청·예약을 날짜와 함께 **등록** ("9월 30일 자동차세", "내일 여권 신청 일정 등록해줘", "10월 5일 건강검진 예약"). 날짜 + 해야 할 일 이름의 조합이면 SCHEDULE 이다. 등록한 일정을 묻는 조회("이번주 일정 뭐 있어?", "다음주 마감 알려줘", "오늘 할 일")도 SCHEDULE 이다.',
    canDo:
      '마감·신청·예약을 날짜와 함께 등록하고, 등록한 일정을 알려 준다. 예: "9월 30일 자동차세 등록해줘", "이번주 일정 뭐 있어?"',
  },
  {
    agentType: AgentType.WORK_REVIEWER,
    classifierLine: '회고/완료 작업 정리 ("오늘 한 일 정리", "worklog")',
    canDo: '오늘 한 일을 회고로 정리한다. 예: "오늘 한 일 정리해줘"',
  },
  {
    agentType: AgentType.CODE_REVIEWER,
    // 2026-10-07: 링크 없는 "게시까지 진행해줘." 가 UNKNOWN 으로 빠져 대화 답변이 "게시할 수 없어요" 라고
    // 틀리게 답했다(2026-08-27 원문, eval h-review-publish-0827a). 직전 리뷰를 올리라는 지시도 여기다.
    classifierLine:
      'PR 리뷰 (PR URL/reference 포함). 직전 대화가 PR 리뷰이고 사용자가 "게시해줘", "코멘트 달아줘", "게시까지 진행해줘" 처럼 그 리뷰를 GitHub 에 올리라고 하면 링크가 없어도 CODE_REVIEWER',
    canDo:
      'GitHub PR 을 리뷰하고 허용된 레포면 코멘트로 게시한다. 직전에 리뷰한 PR 은 링크 없이 "게시해줘" 라고 해도 된다. 예: "<PR 링크> 리뷰해줘"',
  },
  {
    agentType: AgentType.IMPACT_REPORTER,
    classifierLine: '변경 영향 분석 ("이 PR 의 영향 분석")',
    canDo: 'PR 의 변경 영향을 분석한다. 예: "<PR 링크> 영향 분석해줘"',
  },
  {
    agentType: AgentType.PO_SHADOW,
    classifierLine: '제품 요건 검토 ("PRD 검토", "PO 입장")',
    canDo: '제품 요건을 PO 입장에서 검토한다. 예: "이 PRD 검토해줘"',
  },
  {
    agentType: AgentType.PO_EVAL,
    classifierLine:
      '직전 Work Reviewer / PO Shadow / Impact Reporter 결과 통합 + 이력서용 careerLog ("이번 주 정리해줘", "이번 주 통합 회고", "/po-eval 같은 의미"). 특정 PR 하나가 아니라 기간(주간) 단위 통합일 때만.',
    canDo:
      '한 주의 회고·영향 분석을 묶어 주간 정리와 이력서용 성과 기록을 만든다. 예: "이번 주 정리해줘"',
  },
  {
    agentType: AgentType.CEO,
    classifierLine:
      '직전 PO_EVAL + PM 결과 종합 → 컨텍스트 드리프트 / 문서 품질 / 주간 메타 회고 ("이번 주 메타 평가", "drift 점검", "/ceo-review 같은 의미")',
    canDo:
      '주간 메타 회고(문서 품질·맥락 드리프트 점검)를 한다. 예: "이번 주 메타 평가해줘"',
  },
  {
    agentType: AgentType.VACATION,
    classifierLine:
      '⚠️ 휴가/연차 계산·조회·등록·취소 ("휴가 며칠 남았어", "7월 1일부터 3일 휴가 썼어", "연차 잔여", "휴가 취소해줘")',
    canDo:
      '휴가·연차 잔여 조회, 사용 내역, 등록, 취소. 예: "휴가 며칠 남았어?", "10월 20일 반차 등록해줘"',
  },
  {
    agentType: AgentType.BLOG,
    classifierLine:
      '⚠️ 주제를 조사해 정리 글로 남기는 worker. 블로그/회고 글 초안 작성뿐 아니라 특정 기술 주제를 공부·조사·정리·딥다이브하고 싶다는 요청도 BLOG ("이거 블로그로 써줘", "프롬프트 RAG 공부할래", "서버 컴포넌트 딥다이브", "티스토리 글 써줘")',
    canDo:
      '기술 주제를 조사해 정리 글(블로그 초안)로 남긴다. 예: "프롬프트 RAG 공부할래", "서버 컴포넌트 딥다이브"',
  },
  {
    // 2026-10-08: 발행 여부·초안 목록 질문도 받는다 — 블로그 워커가 조회 문장을 발행보다 먼저 알아보고
    // 기록으로 답하게 된 뒤(blog-lookup.ts)라야 안전하다.
    agentType: AgentType.BLOG_PUBLISH,
    classifierLine:
      '⚠️ 이미 Notion에 있는 블로그 초안을 익명화해 GitHub 발행 승인을 요청 ("노션 초안 발행해줘", "블로그 초안 게시해줘"). 새 글 작성은 BLOG, 기존 Notion 초안 발행은 BLOG_PUBLISH. 블로그 글이 발행됐는지·남은 초안이 무엇인지 묻는 질문("그 글 발행됐어?", "남은 초안 뭐 있어")도 BLOG_PUBLISH.',
    canDo:
      'Notion 에 있는 블로그 초안을 익명화해 발행 승인을 요청하고, 남은 초안과 최근 발행 기록을 알려 준다. 예: "노션 초안 발행해줘", "남은 초안 뭐 있어?"',
  },
  {
    agentType: AgentType.CAREER_MATE,
    classifierLine:
      '이직용 역량 프로필/이력서/포트폴리오 ("프로필 정리해줘", "내 역량 정리", "이력서 성과 뽑아줘", "포트폴리오 페이지 만들어줘"). **특정 PR 하나를 회고해서 이력서/포트폴리오에 녹이는 요청도 여기** ("이 PR 회고해서 이력서에 녹여줘" + PR URL).',
    canDo:
      '이직용 역량 프로필·이력서·포트폴리오를 정리하고, PR 하나를 회고해 이력서에 녹인다. 예: "이력서 뽑아줘", "<PR 링크> 회고해서 이력서에 녹여줘"',
  },
  {
    agentType: AgentType.JOB_APPLICATION,
    classifierLine:
      '⚠️ 지원 추적 (회사/직무 지원 기록·상태변경·조회) ("토스 백엔드 지원했어", "토스 서류 합격", "지원 현황", "어디 지원했더라")',
    canDo:
      '회사 지원 기록·상태 변경·지원 현황 조회. 예: "토스 백엔드 지원했어", "지원 현황 보여줘"',
  },
  {
    agentType: AgentType.PAPER_TRADE,
    classifierLine:
      '가상(모의) 주식투자 계좌 **조회** — 수익률·평가액·보유 종목·시드/현금 ("가상계좌 수익률 어때", "모의투자 얼마 벌었어", "가상 주식투자 했던거 현황", "로컬에 있는 가상계좌 조회해줘"). **조회 전용** — 매수/매도 등록이나 종목 추천 요청은 이 worker 가 처리하지 못하므로 UNKNOWN.',
    canDo:
      '사용자 본인의 모의투자(가상) 계좌 수익률·평가액·보유 종목·현금을 조회한다. 예: "모의투자 수익률 어때", "가상계좌 잔고 보여줘"',
  },
  {
    agentType: AgentType.DELAY_REPORT,
    classifierLine:
      '회사 진행 현황·지연 원인 조회 — 승인 대기 카드·진행 중 작업·실패 사유를 귀속해 보고 ("왜 늦어져", "요즘 왜 느려", "뭐가 막혀 있어", "지금 회사 뭐 해", "잘 되고 있어?")',
    canDo:
      '이대리의 진행 현황과 지연 원인(승인 대기·진행 중 작업·실패)을 보고한다. 예: "요즘 왜 느려", "뭐가 막혀 있어"',
  },
  {
    agentType: AgentType.VIDEO_WATCH,
    classifierLine: '유튜브 링크와 함께 영상 내용을 묻거나 요약·설명을 요청',
    canDo:
      '유튜브 링크의 영상 내용을 요약·설명한다. 예: "<유튜브 링크> 이거 요약해줘"',
  },
];
