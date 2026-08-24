import { AgentType } from '../model-router/domain/model-router.type';

/**
 * 에이전트 직무 계약의 단일 소스(SoT).
 *
 * `agent-registry.ts` 가 "문서 메타데이터"(slash / usecase 경로 / 설명) 를 담는다면,
 * 이 파일은 **런타임 검증에 쓰이는 직무 계약**을 담는다 — 소속 부서, 하는 일,
 * 산출물이 반드시 가져야 할 필드, 근거 요구 여부, 다음 부서.
 *
 * 두 가지 용도로 소비된다.
 *   1. `contract-inspector.ts` — 산출물이 계약을 지켰는지 결정론 검사 (LLM 미사용)
 *   2. `model-router` — 계약 요약을 프롬프트 머리말로 주입해 모델이 스스로 지키게 함
 *
 * 완전성 보장: `Record<AgentType, ...>` 타입이라 새 에이전트를 enum 에 추가하면
 * 계약 누락이 컴파일 타임에 걸린다 (`AGENT_TO_PROVIDER` 와 동일한 방식).
 *
 * 설계 근거: `docs/superpowers/specs/2026-07-31-idaeri-company-rules-design.md`
 */

/**
 * 오피스 부서 구획.
 *
 * 값은 콘솔(Swift) `Department` enum 의 rawValue 와 **일부러 동일하게** 맞췄다.
 * 지금은 Swift 가 자체 하드코딩 매핑(`Department.swift` 의 `department(for:)`)을 쓰지만,
 * 4단계에서 이 API 값을 소비하도록 전환할 때 `Department(rawValue:)` 파싱이 그대로 되게 한다.
 *
 * 편성은 콘솔 픽셀 오피스(#201)의 평면도가 이미 6구역으로 굳어 있어 그 6부서를 따른다.
 * 실측(2026-07-31)에서는 개발 축 실행 이력이 0이라 5부서 재편을 검토했으나,
 * (1) 화면 평면도와 어긋나고 (2) #199 로 CTO·PO Shadow 가 autopilot 에 편입돼
 * "안 쓰인다" 는 전제가 흔들려 보류했다. 계약의 알맹이(하는 일·산출물 규격·근거 요구)는
 * 부서 구분과 독립이라 편성을 바꿔도 그대로 유효하다.
 */
export enum Department {
  /** 기획 — 할 일 정의·기획 검토. */
  PLANNING = 'planning',
  /** 개발 — 구현 계획·스키마·테스트·장애 분석. */
  ENGINEERING = 'engineering',
  /** 리뷰 — 코드/업무 리뷰와 임팩트 평가. */
  REVIEW = 'review',
  /** 경영 — 배분·총평. */
  EXECUTIVE = 'executive',
  /** 성장 — 블로그·이력서·커리어·휴가. */
  GROWTH = 'growth',
  /** 내부 — 회사 자체 유지보수. */
  INTERNAL_OPS = 'internalOps',
}

/** 부서의 한글 표시명. 프롬프트 머리말·콘솔 라벨에 쓰인다(Swift `label` 과 동일). */
export const DEPARTMENT_LABEL: Record<Department, string> = {
  [Department.PLANNING]: '기획',
  [Department.ENGINEERING]: '개발',
  [Department.REVIEW]: '리뷰',
  [Department.EXECUTIVE]: '경영',
  [Department.GROWTH]: '성장',
  [Department.INTERNAL_OPS]: '내부',
};

export interface AgentContract {
  /** 소속 부서. */
  readonly department: Department;
  /** "오늘 할 일" 한 줄. 프롬프트 머리말에 그대로 들어간다. */
  readonly job: string;
  /**
   * 산출물 JSON 최상위에 반드시 있어야 할 키.
   *
   * 빈 배열이면 필드 검사를 건너뛴다 — 한 AgentType 이 여러 usecase 를 공유해
   * 산출물 형태가 갈리는 경우(VACATION / CAREER_MATE) 나 배열을 그대로 내보내는
   * 경우(ISSUE_LABELER) 는 공통 필수 키가 성립하지 않는다.
   *
   * 값은 2026-07-31 `agent_run` 실측에서 **성공 실행 전건에 등장한 키**만 골랐다.
   * 추측으로 채우면 프롬프트 머리말이 실제 출력 스키마와 어긋나 모델을 혼란시킨다.
   */
  readonly deliverableFields: readonly string[];
  /**
   * 근거(URL · PR 참조 · `파일:라인` · file/url 구조화 필드) 를 1개 이상 요구하는가.
   *
   * 실측으로 **이미 근거를 담고 있는 에이전트에만** 켠다 (PM 67/67, BLOG 4/4,
   * CODE_REVIEWER 5/6). 근거율이 낮은 곳까지 켜면 위반이 무더기로 쌓여
   * 정작 봐야 할 신호가 묻힌다.
   */
  readonly requireEvidence: boolean;
  /**
   * "주장" 을 담는 목록 필드. 여기 적힌 목록이 **전부 비면** 근거 요구를 면제한다.
   *
   * 지적 없이 승인한 리뷰(`findings: []`)처럼 근거를 붙일 대상 자체가 없는 산출물을
   * 위반으로 잡지 않기 위한 장치다.
   *
   * `deliverableFields` 중 배열인 것을 자동으로 쓰지 않고 따로 적는 이유: PM 은
   * `morning`·`afternoon` 이 빈 배열이어도 `topPriority` 라는 주장이 남는다. 배열만
   * 보고 면제하면 근거 없는 최우선 과제가 통과한다. 반대로 "비배열 필수 필드에 값이
   * 있으면 면제 안 함" 규칙을 쓰면 CODE_REVIEWER 의 `summary`(요약문은 늘 채워진다)가
   * 걸려 원래 잡으려던 오탐이 되살아난다. 어느 필드가 주장인지는 계약이 정한다.
   *
   * 미지정이면 면제하지 않는다 — 근거 요구가 그대로 걸린다.
   */
  readonly claimFields?: readonly string[];
  /** 이 에이전트 고유 금칙어. 회사 공통 금칙어(COMPANY_FORBIDDEN_PHRASES) 에 더해진다. */
  readonly forbidPhrases?: readonly string[];
  /**
   * 산출물 검사는 켜되 프롬프트 머리말 주입은 건너뛴다.
   *
   * **`deliverableFields` 는 두 가지 서로 다른 것에 쓰인다.** 검수기에서는
   * "`agent_run.output` 의 최상위 키" 지만, 프롬프트 머리말에서는 "모델이 낼 응답의 키"
   * 로 읽힌다(`buildContractPreamble` 이 "산출물에 반드시 포함할 것" 으로 적어 보낸다).
   * 두 스키마가 같은 에이전트에서는 문제가 없다 — PM·CODE_REVIEWER 처럼 모델 응답이
   * 그대로 output 이 되는 경우다.
   *
   * 문제는 **output 을 usecase 가 조립하는 에이전트**다. 모델은 도메인 응답을 내고
   * usecase 가 그것을 집계·가공해 다른 모양으로 저장한다. 이런 계약에 머리말을 넣으면
   * 모델에게 **존재하지 않는 스키마를 요구**하게 되고, 원래 기대했던 응답 형태가 깨져
   * 파서가 실패한다. 검사는 output 을 보므로 켜 두는 것이 맞고, 머리말만 꺼야 한다.
   *
   * 판정 기준: `AgentRunService.execute` 의 `run` 이 돌려주는 `result` 가 모델 응답
   * 그대로인가. 조립이면 이 플래그를 켠다.
   *
   * 설계문서 `2026-07-31-idaeri-company-rules-design.md` §5 가 "프롬프트 머리말이 기존
   * 출력 스키마와 충돌한다" 로 예고한 리스크의 구체형이다.
   */
  readonly skipPreamble?: boolean;
  /** 산출물을 넘겨받는 다음 부서. 체인 끝이면 null. */
  readonly nextAgent: AgentType | null;
}

/**
 * 회사 공통 금칙어 — 모든 에이전트 산출물에 적용된다.
 *
 * 코드가 단일 소스다. `COMPANY_RULES.md` 는 이 상수를 링크로 가리키기만 한다
 * (문서와 코드 두 곳에 목록을 두면 반드시 어긋난다).
 *
 * 초기값은 대표가 아직 브랜드 문체 기준을 확정하지 않아 일반적인 AI 상투어로 채웠다.
 * 실제 산출물에서 걸러야 할 표현이 관측되면 여기에 추가한다.
 */
export const COMPANY_FORBIDDEN_PHRASES: readonly string[] = [
  '마법 같은',
  '놀라운 변화',
  '함께 알아볼까요',
  '해보시는 건 어떨까요',
];

/**
 * 계약 스텁 — 부서와 직무만 정하고 산출물 검사는 건너뛴다.
 *
 * 대상: 실행 이력이 없어 산출물 형태를 실측할 수 없는 에이전트, 그리고
 * `AgentRunService` 를 경유하지 않는 내부 유틸형. 이들이 실제로 돌기 시작하면
 * 그때 산출물을 실측해 `deliverableFields` 를 채운다.
 */
const stub = (department: Department, job: string): AgentContract => ({
  department,
  job,
  deliverableFields: [],
  requireEvidence: false,
  nextAgent: null,
});

export const AGENT_CONTRACTS: Record<AgentType, AgentContract> = {
  // ──────────────────────────────── 기획 ────────────────────────────────
  [AgentType.PM]: {
    department: Department.PLANNING,
    job: '오늘 할 일 목록과 우선순위를 정한다',
    deliverableFields: ['topPriority', 'morning', 'afternoon'],
    requireEvidence: true,
    nextAgent: AgentType.CTO,
  },
  [AgentType.PO_EVAL]: {
    department: Department.PLANNING,
    job: '기간 성과를 정성 평가하고 커리어 로그를 남긴다',
    deliverableFields: ['qualitative', 'careerLog'],
    requireEvidence: false,
    nextAgent: AgentType.CEO,
  },
  [AgentType.PO_SHADOW]: stub(
    Department.PLANNING,
    'PO 관점에서 기획을 그림자 검토한다',
  ),

  // ──────────────────────────────── 개발 ────────────────────────────────
  [AgentType.BE]: stub(Department.ENGINEERING, '백엔드 구현 계획을 세운다'),
  [AgentType.BE_SCHEMA]: stub(
    Department.ENGINEERING,
    'DB 스키마 변경안을 제안한다',
  ),
  [AgentType.BE_TEST]: stub(Department.ENGINEERING, '테스트 코드를 작성한다'),
  [AgentType.BE_SRE]: stub(
    Department.ENGINEERING,
    '스택 트레이스를 분석해 장애 원인을 찾는다',
  ),
  [AgentType.BE_FIX]: stub(
    Department.ENGINEERING,
    'PR 의 컨벤션 위반을 찾아 고칠 곳을 알린다',
  ),

  // ──────────────────────────────── 리뷰 ────────────────────────────────
  [AgentType.CODE_REVIEWER]: {
    department: Department.REVIEW,
    job: 'PR 을 리뷰하고 머지 가부를 판단한다',
    deliverableFields: ['summary', 'findings', 'approvalRecommendation'],
    requireEvidence: true,
    // 지적이 곧 주장이다. 둘 다 비면 승인 리뷰라 근거를 붙일 대상이 없다.
    claimFields: ['findings', 'mustFix'],
    nextAgent: null,
  },
  [AgentType.WORK_REVIEWER]: {
    department: Department.REVIEW,
    job: '오늘 한 일을 업무 로그로 정리한다',
    deliverableFields: ['summary', 'oneLineAchievement', 'nextActions'],
    requireEvidence: false,
    nextAgent: AgentType.PO_EVAL,
  },
  [AgentType.IMPACT_REPORTER]: {
    department: Department.REVIEW,
    job: 'PR 이 만든 변화를 정량·정성으로 보고한다',
    deliverableFields: ['headline', 'quantitative', 'qualitative'],
    requireEvidence: false,
    nextAgent: AgentType.PO_EVAL,
  },
  // 콘솔 Swift 매핑에는 아직 없어 화면에서는 '내부' 로 폴백되지만, 하는 일이 리뷰 보조라
  // 백엔드 계약은 리뷰로 둔다. 4단계에서 Swift 가 이 API 값을 소비하면 자동으로 리뷰 구역에 선다.
  [AgentType.REVIEW_REPLY_JUDGE]: stub(
    Department.REVIEW,
    'PR 리뷰 지적에 달린 답변이 수용인지 판정한다',
  ),

  // ──────────────────────────────── 경영 ────────────────────────────────
  [AgentType.CTO]: {
    department: Department.EXECUTIVE,
    job: 'PM 이 뽑은 할 일을 백엔드 워커에 분배한다',
    // 2026-08-24 실측: 성공 실행 15/15 전건에 세 키가 비어 있지 않은 값으로 등장.
    // `skipPreamble` 을 켜지 않는다 — output 이 모델 응답 그대로다
    // (`generate-assignment.usecase.ts` 의 `result: output`, 같은 키를 타입가드가 검증).
    deliverableFields: ['ctoSummary', 'assignments', 'unassignedTasks'],
    requireEvidence: false,
    nextAgent: AgentType.BE,
  },
  [AgentType.CEO]: {
    department: Department.EXECUTIVE,
    job: '주간 실행을 메타 관점에서 총평한다',
    deliverableFields: [
      'finalSummary',
      'contextDriftReport',
      'docsQualityReport',
    ],
    requireEvidence: false,
    nextAgent: null,
  },

  // ──────────────────────────────── 성장 ────────────────────────────────
  [AgentType.BLOG]: {
    department: Department.GROWTH,
    job: '블로그 초안을 만들어 노션에 적재한다',
    deliverableFields: ['notionUrl', 'published'],
    requireEvidence: true,
    nextAgent: null,
  },
  [AgentType.CAREER_MATE]: stub(
    Department.GROWTH,
    '머지된 PR 을 합성해 역량 프로필과 이력서를 만든다',
  ),
  [AgentType.JOB_APPLICATION]: stub(
    Department.GROWTH,
    '지원 이력을 기록하고 상태를 추적한다',
  ),
  [AgentType.VACATION]: stub(
    Department.GROWTH,
    '연차 잔여일을 계산하고 사용을 기록한다',
  ),
  [AgentType.INVEST]: stub(
    Department.GROWTH,
    '보유 종목의 시세 이상을 장 마감 후 점검한다',
  ),
  [AgentType.PAPER_TRADE]: {
    department: Department.GROWTH,
    job: '모의투자 계좌의 포지션과 일일 수익률을 평가한다',
    // 2026-08-24 실측: 성공 실행 8/8 전건. exitBandAccounts 계열은 5/8 로 매도 밴드가
    // 걸린 회차에만 등장해 필수에서 뺐다.
    deliverableFields: ['accounts', 'accountCount', 'failedCount'],
    requireEvidence: false,
    // output 은 `buildPaperTradingAudit` 이 계좌 평가를 집계해 만든다. 현재 이 워커는
    // 모델을 부르지 않아 머리말 경로 자체가 없지만, 조립 output 이라는 성질은 그대로다 —
    // 나중에 모델 호출이 붙는 순간 함정이 되므로 미리 끈다.
    skipPreamble: true,
    nextAgent: null,
  },
  [AgentType.PAPER_RECOMMEND]: {
    department: Department.GROWTH,
    job: '모의투자 후보와 보유 종목을 검토해 매수와 전량 매도를 추천한다',
    // 2026-08-24 실측: 성공 실행 16/16 전건. agentRunId 는 자기 실행 식별자일 뿐
    // 산출물의 내용이 아니라 제외했다(`claimFields` 주석의 taskId 판단과 같은 이유).
    deliverableFields: ['strategy', 'accountId', 'ordersCreated'],
    requireEvidence: false,
    // 모델은 추천 종목을 내고, output 은 usecase 가 계좌·주문 수를 집계해 만든다
    // (`generate-paper-recommendation.usecase.ts` 의 `result` 조립). 머리말이 이 키를
    // 요구하면 모델이 추천 스키마 대신 집계값을 지어낸다.
    skipPreamble: true,
    nextAgent: null,
  },

  // ──────────────────────────────── 내부 ────────────────────────────────
  [AgentType.OPS_SUPERVISOR]: {
    department: Department.INTERNAL_OPS,
    job: '운영 이상 징후를 찾아 조치를 제안한다',
    deliverableFields: ['advice'],
    requireEvidence: false,
    nextAgent: null,
  },
  [AgentType.EVENING_RETRO]: {
    department: Department.INTERNAL_OPS,
    job: '하루를 회고해 발행 초안을 만든다',
    // 2026-08-24 실측: 성공 실행 14/14 전건.
    // `skipPreamble` 을 켜지 않는다 — 세 키를 모델에게 직접 요구하는 프롬프트가 이미 있다
    // (`evening-retro.prompt.ts`). 머리말이 같은 스키마를 되짚어 주는 셈이라 안전하다.
    deliverableFields: ['prNotes', 'candidates', 'retrospective'],
    requireEvidence: false,
    nextAgent: null,
  },
  [AgentType.HUMANIZER]: {
    department: Department.INTERNAL_OPS,
    job: '기계적인 문장을 사람이 쓴 글로 다듬는다',
    // 2026-08-24 실측: 성공 실행 141/141 전건. 산출물이 이 키 하나뿐이라 검사가
    // 잡아내는 것은 "윤문 결과를 아예 못 담은 회차" 로 좁다. 그래도 켜 두는 이유는
    // 141 회차가 무검사로 남는 쪽이 더 나쁘기 때문이다.
    deliverableFields: ['humanizedKeys'],
    requireEvidence: false,
    // 두 겹으로 위험하다. (1) `humanize.service.ts` 는 `prompt` 에 윤문 대상 JSON 을
    // 그대로 담고 응답도 JSON 파싱을 기대하는데, 머리말이 그 JSON 앞에 붙는다.
    // (2) humanizedKeys 는 모델이 내는 키가 아니라 어댑터가 만드는 메타 필드라
    // 머리말이 모델에게 없는 스키마를 요구한다.
    skipPreamble: true,
    nextAgent: null,
  },
  [AgentType.ISSUE_LABELER]: stub(
    Department.INTERNAL_OPS,
    '새 이슈에 기존 라벨 중 적합한 것을 붙인다',
  ),
  [AgentType.SUBCONSCIOUS_GATE]: {
    department: Department.INTERNAL_OPS,
    job: '감지된 상태 변화를 제안으로 올릴지 판정한다',
    // 2026-08-24 실측: 성공 실행 102/102 전건. promotedCount 는 0 이 정상값이고
    // `isEmptyValue` 가 숫자 0 을 비어 있다고 보지 않으므로 필수로 둬도 오탐이 없다.
    deliverableFields: ['decisions', 'promotedCount'],
    requireEvidence: false,
    // 모델은 판정 목록만 내고 promotedCount 는 코드가 세어 붙인다
    // (`llm-subconscious-gate.ts` 의 `decisions.filter(...).length`).
    skipPreamble: true,
    nextAgent: null,
  },
  [AgentType.CONTRADICTION_JUDGE]: stub(
    Department.INTERNAL_OPS,
    '기록된 지식 사이의 모순을 판정한다',
  ),
  [AgentType.DOCS_AUDIT_OPTIMIZER]: stub(
    Department.INTERNAL_OPS,
    '문서와 코드의 어긋남을 찾아 고칠 곳을 제안한다',
  ),
  [AgentType.DOCS_AUDIT_EVALUATOR]: stub(
    Department.INTERNAL_OPS,
    '문서 감사 결과의 타당성을 채점한다',
  ),
  [AgentType.PREFERENCE_LEARNING]: stub(
    Department.INTERNAL_OPS,
    '대표의 취향을 관찰해 선호 프로필을 갱신한다',
  ),
  [AgentType.BLOG_PUBLISH]: {
    department: Department.GROWTH,
    job: 'Notion 블로그 초안을 익명화해 GitHub 발행 승인을 요청한다',
    // 2026-08-24 실측에서는 성공 실행 5/5 전건에 path·title·notionUrl 이 있었지만,
    // 그 5 건이 전부 'preview'(발행 진행) 분기였을 뿐이다. `PublishNotionDraftResult`
    // 는 4 갈래 union 이고 empty·skipped·blocked 도 정상 SUCCEEDED 로 저장되는데
    // (`publish-notion-draft.usecase.ts` 의 `status !== 'ready'` 조기 반환), 그 셋에는
    // path·title·notionUrl 이 애초에 없다. 넣어 두면 정상 실행마다 missingField 가
    // 찍혀 추이를 오염시킨다 — 네 분기 전부에 있는 것은 status 하나다.
    // 분기별 필수 필드를 따로 검사하는 것은 계약 구조 확장이 필요해 범위 밖으로 둔다.
    deliverableFields: ['status'],
    requireEvidence: false,
    // 모델은 익명화된 본문을 내고, output 의 path·status·notionUrl 은 발행 경로가
    // 만든다. 머리말이 이 키를 요구하면 익명화 응답 형태가 깨진다.
    skipPreamble: true,
    nextAgent: null,
  },
  [AgentType.CTO_STUDY]: stub(
    Department.GROWTH,
    '딥다이브 주제를 대표의 현재 일과 연결해 학습 필요성을 판정한다',
  ),
};

/**
 * 계약을 프롬프트 머리말로 변환한다. 모델이 기준을 모른 채 답하는 것을 막는다.
 *
 * 스텁 계약(산출물 규격도 근거 요구도 없는 계약)은 `null` 을 돌려 주입하지 않는다 —
 * 알릴 기준이 사실상 직무 한 줄뿐이라, 얻는 것보다 프롬프트를 흐릴 위험이 크다.
 * 특히 HUMANIZER 처럼 입력 텍스트를 그대로 다듬는 에이전트는 머리말이 산출물을
 * 오염시킬 수 있다.
 *
 * 길이는 200바이트 안팎이라 프롬프트 상한(16KB)에 실질적 영향이 없다.
 */
export function buildContractPreamble(agentType: AgentType): string | null {
  const contract = AGENT_CONTRACTS[agentType];
  // 계약이 있어도 머리말만 끄는 경우가 있다 — 사유는 `skipPreamble` 주석 참조.
  if (contract.skipPreamble === true) {
    return null;
  }
  const isStub =
    contract.deliverableFields.length === 0 &&
    contract.requireEvidence === false;
  if (isStub) {
    return null;
  }

  const lines = [
    `[사규] 너는 ${DEPARTMENT_LABEL[contract.department]}에서 "${contract.job}" 를 맡고 있다.`,
  ];

  if (contract.deliverableFields.length > 0) {
    lines.push(
      `산출물에 반드시 포함할 것: ${contract.deliverableFields.join(', ')}`,
    );
  }
  if (contract.requireEvidence) {
    lines.push(
      '주장에는 근거(링크·PR 번호·파일 경로)를 붙인다. 확인하지 못한 것은 "미확인"이라고 표시한다.',
    );
  }

  const forbidden = [
    ...COMPANY_FORBIDDEN_PHRASES,
    ...(contract.forbidPhrases ?? []),
  ];
  if (forbidden.length > 0) {
    lines.push(`다음 표현은 쓰지 않는다: ${forbidden.join(' / ')}`);
  }

  return lines.join('\n');
}
