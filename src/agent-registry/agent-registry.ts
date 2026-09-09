import { AgentType } from '../model-router/domain/model-router.type';

/**
 * 에이전트 문서 메타데이터의 단일 소스(SoT).
 *
 * 코드만으로는 agent → slash / usecase / 설명 을 기계적으로 도출할 수 없다
 * (slash 등록이 6+개 핸들러에 흩어져 있음). 이 레지스트리가 그 "문서 메타데이터"를
 * 한곳에 모은다. `scripts/sync-docs.ts` 가 이 파일 + `AGENT_TO_PROVIDER`(model) 를
 * 읽어 `docs/agent-catalog.md` 를 생성한다.
 *
 * model 은 여기 중복 저장하지 않는다 — `model-router.usecase.ts` 의 `AGENT_TO_PROVIDER`
 * 가 SoT 이고, 생성기가 거기서 파생한다.
 *
 * 드리프트 방지: `agent-registry.spec.ts` 가 이 레지스트리의 agentType 집합이
 * `AgentType` enum 과 정확히 일치하는지 강제한다(새 에이전트 추가 후 레지스트리/문서
 * 누락 차단). `AGENT_TO_PROVIDER` 는 `Record<AgentType, ...>` 타입이라 enum 완전성을
 * 컴파일타임에 보장하므로, enum 일치 검사가 곧 provider 일치 검사를 함의한다.
 */
export interface AgentRegistryEntry {
  /** model-router 의 AgentType enum 값. */
  readonly agentType: AgentType;
  /** 사람이 읽는 표시 이름. */
  readonly displayName: string;
  /** 회사 동료처럼 부르는 한글 닉네임. 콘솔 표시와 자연어 직접 호출의 단일 소스. */
  readonly nickname: string;
  /**
   * 이 에이전트로 진입하는 Slack 슬래시 커맨드(서브커맨드 포함, 예: `/be plan`).
   * webhook/자동 트리거 전용 에이전트는 빈 배열.
   */
  readonly slashCommands: readonly string[];
  /** 진입 usecase 파일의 repo-상대 경로(spec 이 실재를 검증). */
  readonly usecasePath: string;
  /** 한 줄 설명. */
  readonly description: string;
}

export const AGENT_REGISTRY: readonly AgentRegistryEntry[] = [
  {
    agentType: AgentType.PM,
    displayName: 'PM',
    nickname: '김기획',
    slashCommands: ['/today'],
    usecasePath: 'src/agent/pm/application/generate-daily-plan.usecase.ts',
    description: '오늘 할 일 daily plan 생성',
  },
  {
    agentType: AgentType.CODE_REVIEWER,
    displayName: 'Code Reviewer',
    nickname: '박꼼꼼',
    slashCommands: ['/review-pr'],
    usecasePath:
      'src/agent/code-reviewer/application/review-pull-request.usecase.ts',
    description: 'PR 코드 리뷰',
  },
  {
    agentType: AgentType.WORK_REVIEWER,
    displayName: 'Work Reviewer',
    nickname: '정리나',
    slashCommands: ['/worklog'],
    usecasePath:
      'src/agent/work-reviewer/application/generate-worklog.usecase.ts',
    description: '업무 로그 / 주간보고 초안 생성',
  },
  {
    agentType: AgentType.IMPACT_REPORTER,
    displayName: 'Impact Reporter',
    nickname: '이보람',
    slashCommands: ['/impact-report'],
    usecasePath:
      'src/agent/impact-reporter/application/generate-impact-report.usecase.ts',
    description: 'PR 임팩트 리포트 생성',
  },
  {
    agentType: AgentType.PO_SHADOW,
    displayName: 'PO Shadow',
    nickname: '박보좌',
    slashCommands: ['/po-shadow'],
    usecasePath:
      'src/agent/po-shadow/application/generate-po-shadow.usecase.ts',
    description: 'PO 관점 그림자 검토',
  },
  {
    agentType: AgentType.PO_EVAL,
    displayName: 'PO Eval',
    nickname: '최성과',
    slashCommands: ['/po-eval'],
    usecasePath:
      'src/agent/po-eval/application/generate-po-evaluation.usecase.ts',
    description: '단계 평가 합성 + careerLog',
  },
  {
    agentType: AgentType.CEO,
    displayName: 'CEO',
    nickname: '이총평',
    slashCommands: ['/ceo-review'],
    usecasePath: 'src/agent/ceo/application/generate-ceo-meta.usecase.ts',
    description: '메타 회고 (PO_EVAL + PM 합성)',
  },
  {
    agentType: AgentType.ISSUE_LABELER,
    displayName: 'Issue Labeler',
    nickname: '나누리',
    slashCommands: [],
    usecasePath:
      'src/agent/issue-labeler/application/infer-issue-labels.usecase.ts',
    description: 'issue 자동 라벨링 (webhook 자동 트리거)',
  },
  {
    agentType: AgentType.VACATION,
    displayName: 'Vacation',
    nickname: '오휴가',
    slashCommands: ['/휴가'],
    usecasePath: 'src/agent/vacation/application/calculate-balance.usecase.ts',
    description: '휴가 잔여 계산 (자연어 파라미터 추출에만 LLM 사용)',
  },
  {
    agentType: AgentType.BLOG,
    displayName: 'Blog',
    nickname: '문작가',
    slashCommands: [],
    usecasePath: 'src/agent/blog/application/generate-blog-draft.usecase.ts',
    description: '블로그 초안 릴레이 (자연어 멘션 → Hermes tistory-blog 스킬)',
  },
  {
    agentType: AgentType.BLOG_PUBLISH,
    displayName: 'Blog Publish',
    nickname: '배포해',
    slashCommands: ['/blog-publish'],
    usecasePath: 'src/agent/blog/application/publish-notion-draft.usecase.ts',
    description: 'Notion 블로그 초안 익명화 + GitHub 발행 승인',
  },
  {
    agentType: AgentType.BLOG_REVISION,
    displayName: 'Blog Revision Report',
    nickname: '한교정',
    slashCommands: [],
    usecasePath:
      'src/agent/blog/application/extract-revision-conventions.usecase.ts',
    description:
      '블로그 수정률 주간 보고와 반복 수정 규칙 추출 (슬래시 없음, autopilot 전용)',
  },
  {
    agentType: AgentType.CAREER_MATE,
    displayName: 'Career Mate',
    nickname: '강성장',
    slashCommands: [],
    usecasePath:
      'src/agent/career-mate/application/build-career-profile.usecase.ts',
    description:
      '이직용 역량 프로필 허브 + 이력서/포트폴리오 (merged PR 합성, 자연어 멘션)',
  },
  {
    agentType: AgentType.JOB_APPLICATION,
    displayName: 'Job Application',
    nickname: '서지원',
    slashCommands: [],
    usecasePath:
      'src/agent/job-application/application/add-application.usecase.ts',
    description:
      '지원 추적 CRM (회사/직무 지원 기록·상태·조회, 자연어 멘션 + 넛지 cron)',
  },
  {
    agentType: AgentType.SUBCONSCIOUS_GATE,
    displayName: 'Subconscious Gate',
    nickname: '제안나',
    slashCommands: [],
    usecasePath: 'src/subconscious/infrastructure/llm-subconscious-gate.ts',
    description:
      '내부 proactive 게이트 — 상태 변화를 promote/drop 분류 (슬래시 없음, 내부 전용)',
  },
  {
    agentType: AgentType.CONTRADICTION_JUDGE,
    displayName: 'Contradiction Judge',
    nickname: '차모순',
    slashCommands: [],
    usecasePath:
      'src/agent/contradiction-judge/application/judge-contradiction.usecase.ts',
    description:
      'knowledge-lint L4 — 유사 에피소드 쌍의 의미 충돌 판정 (슬래시 없음, 내부 전용)',
  },
  {
    agentType: AgentType.REVIEW_REPLY_JUDGE,
    displayName: 'Review Reply Judge',
    nickname: '정판단',
    slashCommands: [],
    usecasePath:
      'src/agent/review-reply-judge/application/judge-review-reply.usecase.ts',
    description: 'PR 리뷰 답변 수용 여부 판정',
  },
  {
    agentType: AgentType.HUMANIZER,
    displayName: 'Humanizer',
    nickname: '윤다정',
    slashCommands: [],
    usecasePath: 'src/humanize/application/humanize.service.ts',
    description:
      '자동 보고서 서술 필드 윤문 (AI 티 제거, 슬래시 없음, 내부 전용)',
  },
  {
    agentType: AgentType.DOCS_AUDIT_OPTIMIZER,
    displayName: 'Docs Audit Optimizer',
    nickname: '문고침',
    slashCommands: [],
    usecasePath: 'src/docs-audit/infrastructure/codex-docs-judge.adapter.ts',
    description:
      'docs-sync-audit Layer 2 — 코드 변경 기준 문서 수정안 생성 (슬래시 없음, 내부 전용)',
  },
  {
    agentType: AgentType.DOCS_AUDIT_EVALUATOR,
    displayName: 'Docs Audit Evaluator',
    nickname: '문바름',
    slashCommands: [],
    usecasePath: 'src/docs-audit/infrastructure/codex-docs-judge.adapter.ts',
    description:
      'docs-sync-audit Layer 2 — 문서 수정안이 코드 사실과 일치하는지 채점 (슬래시 없음, 내부 전용)',
  },
  {
    agentType: AgentType.PREFERENCE_LEARNING,
    displayName: 'Preference Learning',
    nickname: '최취향',
    slashCommands: [],
    usecasePath:
      'src/preference-profile/application/preference-inference.adapter.ts',
    description:
      '주간 선호 학습 — 신호 배치 → 선호 프로필 diff 추론 (슬래시 없음, 내부 전용)',
  },
  {
    agentType: AgentType.EVENING_RETRO,
    displayName: 'Evening Retro Publish',
    nickname: '하루미',
    slashCommands: [],
    usecasePath:
      'src/autopilot/infrastructure/tasks/evening-retro-publish.autopilot-task.ts',
    description:
      '저녁 회고→발행 후보 — 오늘 한 일 회고 + 블로그/경력 발행 후보 (슬래시 없음, autopilot 전용)',
  },
  {
    agentType: AgentType.OPS_SUPERVISOR,
    displayName: 'Ops Supervisor',
    nickname: '안정민',
    slashCommands: [],
    usecasePath:
      'src/agent/ops-supervisor/application/generate-ops-advice.usecase.ts',
    description:
      '월간 운영 품질 이상 신호 분석과 개선 제안 생성 (슬래시 없음, autopilot 전용)',
  },
  {
    agentType: AgentType.INVEST,
    displayName: 'Invest Monitor',
    nickname: '주지킴',
    slashCommands: [],
    usecasePath:
      'src/autopilot/infrastructure/tasks/stock-monitor.autopilot-task.ts',
    description:
      '보유 종목 감시 — 장 마감 후 전일 대비·평단 대비 이상 판정 (슬래시 없음, autopilot 전용, LLM 미사용)',
  },
  {
    agentType: AgentType.PAPER_TRADE,
    displayName: 'Paper Trade',
    nickname: '백장부',
    slashCommands: [],
    usecasePath:
      'src/autopilot/infrastructure/tasks/paper-trading.autopilot-task.ts',
    description:
      '모의투자 계좌 — 일일 평가(autopilot) + 자연어 현황 조회(수익률·보유·현금, 읽기 전용) (슬래시 없음, LLM 미사용)',
  },
  {
    agentType: AgentType.DELAY_REPORT,
    displayName: 'Delay Report',
    nickname: '신지연',
    slashCommands: [],
    usecasePath:
      'src/agent/delay-report/application/build-delay-report.usecase.ts',
    description:
      '회사 진행 현황·지연 원인 조회 (승인 대기·진행 중 작업·미해소 실패, 결정론)',
  },
  {
    agentType: AgentType.PAPER_RECOMMEND,
    displayName: 'Paper Recommend',
    nickname: '추천호',
    slashCommands: [],
    usecasePath:
      'src/agent/paper-recommend/application/generate-paper-recommendation.usecase.ts',
    description:
      '모의투자 전략별 추천 — 후보와 보유 종목을 함께 LLM 판단 (슬래시 없음, autopilot/CLI 전용)',
  },
  {
    agentType: AgentType.CTO_STUDY,
    displayName: 'CTO Study',
    nickname: '배운이',
    slashCommands: [],
    usecasePath: 'src/agent/cto/application/evaluate-study-topic.usecase.ts',
    description:
      'Hermes 딥다이브 주제를 개인 레포와 연결해 학습 필요성 판정 (cron 내부 전용)',
  },
];

/**
 * 자연어에 회사사람형 닉네임이 명시되면 해당 담당자를 바로 찾는다.
 *
 * 닉네임은 사용자가 직접 대상을 고른 신호라 LLM 분류보다 우선한다. 원문은 바꾸지 않는다 —
 * dispatcher 가 PR 참조나 세부 지시를 그대로 읽어야 하기 때문이다.
 */
export function resolveAgentTypeByNickname(
  text: string,
): AgentType | undefined {
  return AGENT_REGISTRY.find((entry) => text.includes(entry.nickname))
    ?.agentType;
}
