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
    slashCommands: ['/today'],
    usecasePath: 'src/agent/pm/application/generate-daily-plan.usecase.ts',
    description: '오늘 할 일 daily plan 생성',
  },
  {
    agentType: AgentType.BE,
    displayName: 'Backend',
    slashCommands: ['/be plan'],
    usecasePath: 'src/agent/be/application/generate-backend-plan.usecase.ts',
    description: '백엔드 구현 계획 생성',
  },
  {
    agentType: AgentType.CODE_REVIEWER,
    displayName: 'Code Reviewer',
    slashCommands: ['/review-pr'],
    usecasePath:
      'src/agent/code-reviewer/application/review-pull-request.usecase.ts',
    description: 'PR 코드 리뷰',
  },
  {
    agentType: AgentType.WORK_REVIEWER,
    displayName: 'Work Reviewer',
    slashCommands: ['/worklog'],
    usecasePath:
      'src/agent/work-reviewer/application/generate-worklog.usecase.ts',
    description: '업무 로그 / 주간보고 초안 생성',
  },
  {
    agentType: AgentType.IMPACT_REPORTER,
    displayName: 'Impact Reporter',
    slashCommands: ['/impact-report'],
    usecasePath:
      'src/agent/impact-reporter/application/generate-impact-report.usecase.ts',
    description: 'PR 임팩트 리포트 생성',
  },
  {
    agentType: AgentType.PO_SHADOW,
    displayName: 'PO Shadow',
    slashCommands: ['/po-shadow'],
    usecasePath:
      'src/agent/po-shadow/application/generate-po-shadow.usecase.ts',
    description: 'PO 관점 그림자 검토',
  },
  {
    agentType: AgentType.BE_SCHEMA,
    displayName: 'BE Schema',
    slashCommands: ['/be schema'],
    usecasePath:
      'src/agent/be-schema/application/generate-schema-proposal.usecase.ts',
    description: 'Prisma 스키마 변경 제안',
  },
  {
    agentType: AgentType.BE_TEST,
    displayName: 'BE Test',
    slashCommands: ['/be test'],
    usecasePath: 'src/agent/be-test/application/generate-test.usecase.ts',
    description: 'Tree-sitter AST 기반 Jest spec 생성',
  },
  {
    agentType: AgentType.BE_SRE,
    displayName: 'BE SRE',
    slashCommands: [],
    usecasePath: 'src/agent/be-sre/application/analyze-stack-trace.usecase.ts',
    description: '스택트레이스 분석 (webhook 자동 트리거)',
  },
  {
    agentType: AgentType.BE_FIX,
    displayName: 'BE Fix',
    slashCommands: [],
    usecasePath:
      'src/agent/be-fix/application/analyze-pr-convention.usecase.ts',
    description: 'PR 컨벤션 분석 (webhook 자동 트리거)',
  },
  {
    agentType: AgentType.CTO,
    displayName: 'CTO',
    slashCommands: ['/assign'],
    usecasePath: 'src/agent/cto/application/generate-assignment.usecase.ts',
    description: 'PM 작업을 BE worker 로 분배',
  },
  {
    agentType: AgentType.PO_EVAL,
    displayName: 'PO Eval',
    slashCommands: ['/po-eval'],
    usecasePath:
      'src/agent/po-eval/application/generate-po-evaluation.usecase.ts',
    description: '단계 평가 합성 + careerLog',
  },
  {
    agentType: AgentType.CEO,
    displayName: 'CEO',
    slashCommands: ['/ceo-review'],
    usecasePath: 'src/agent/ceo/application/generate-ceo-meta.usecase.ts',
    description: '메타 회고 (PO_EVAL + PM/CTO 합성)',
  },
  {
    agentType: AgentType.ISSUE_LABELER,
    displayName: 'Issue Labeler',
    slashCommands: [],
    usecasePath:
      'src/agent/issue-labeler/application/infer-issue-labels.usecase.ts',
    description: 'issue 자동 라벨링 (webhook 자동 트리거)',
  },
  {
    agentType: AgentType.VACATION,
    displayName: 'Vacation',
    slashCommands: ['/휴가'],
    usecasePath: 'src/agent/vacation/application/calculate-balance.usecase.ts',
    description: '휴가 잔여 계산 (자연어 파라미터 추출에만 LLM 사용)',
  },
  {
    agentType: AgentType.BLOG,
    displayName: 'Blog',
    slashCommands: [],
    usecasePath: 'src/agent/blog/application/generate-blog-draft.usecase.ts',
    description: '블로그 초안 릴레이 (자연어 멘션 → Hermes tistory-blog 스킬)',
  },
  {
    agentType: AgentType.CAREER_MATE,
    displayName: 'Career Mate',
    slashCommands: [],
    usecasePath:
      'src/agent/career-mate/application/build-career-profile.usecase.ts',
    description:
      '이직용 역량 프로필 허브 + 이력서/포트폴리오 (merged PR 합성, 자연어 멘션)',
  },
  {
    agentType: AgentType.JOB_APPLICATION,
    displayName: 'Job Application',
    slashCommands: [],
    usecasePath:
      'src/agent/job-application/application/add-application.usecase.ts',
    description:
      '지원 추적 CRM (회사/직무 지원 기록·상태·조회, 자연어 멘션 + 넛지 cron)',
  },
  {
    agentType: AgentType.SUBCONSCIOUS_GATE,
    displayName: 'Subconscious Gate',
    slashCommands: [],
    usecasePath: 'src/subconscious/infrastructure/llm-subconscious-gate.ts',
    description:
      '내부 proactive 게이트 — 상태 변화를 promote/drop 분류 (슬래시 없음, 내부 전용)',
  },
  {
    agentType: AgentType.CONTRADICTION_JUDGE,
    displayName: 'Contradiction Judge',
    slashCommands: [],
    usecasePath:
      'src/agent/contradiction-judge/application/judge-contradiction.usecase.ts',
    description:
      'knowledge-lint L4 — 유사 에피소드 쌍의 의미 충돌 판정 (슬래시 없음, 내부 전용)',
  },
];
