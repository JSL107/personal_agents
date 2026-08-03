# 이대리 사규 체계 — 부서 개편과 에이전트 계약 (1단계)

작성일: 2026-07-31
범위: 전체 4단계 중 **1단계** (헌법 · 부서 개편 · 계약 · 결정론 검수)

---

## 1. 왜 이 작업을 하는가

이대리는 27개 에이전트를 가진 멀티 에이전트 회사다. 그런데 조직도상 27명이 있을 뿐,
누가 무슨 기준으로 일하고 무엇을 내놓아야 하는지는 코드 어디에도 정의돼 있지 않다.
에이전트마다 프롬프트에 암묵적으로 흩어져 있을 뿐이라, 산출물 품질을 회사 차원에서
보증할 방법이 없다.

동시에 **조직이 실제로 어떻게 돌아가고 있는지도 확인된 적이 없었다.**
이번에 처음으로 실행 이력을 전수 조회했고, 결과는 조직도와 크게 달랐다.

### 1.1 실행 이력 감사 (2026-07-31, `agent_run` 테이블 전수)

| 구분 | 에이전트 | 근거 |
|---|---|---|
| **실사용** (9) | WORK_REVIEWER 90회 · PM 75 · PO_EVAL 71 · IMPACT_REPORTER 27 · CEO 20 · CAREER_MATE 11 · VACATION 9 · BLOG 7 · CODE_REVIEWER 6 | 모두 cron 자동 실행 축 |
| **실행 0회** (8) | BE · CTO · BE_SCHEMA · BE_TEST · BE_SRE · BE_FIX · PO_SHADOW · JOB_APPLICATION | 이들 usecase는 전부 `AgentRunService.execute`로 감싸져 있다. 기록이 없다는 것은 한 번도 실행되지 않았다는 뜻이다 |
| **미발화** (3) | OPS_SUPERVISOR · EVENING_RETRO · ISSUE_LABELER | 배선은 완료됐으나 트리거 조건(cron·webhook)이 아직 오지 않음 |
| **판정 보류** (6) | SUBCONSCIOUS_GATE · CONTRADICTION_JUDGE · HUMANIZER · DOCS_AUDIT_OPTIMIZER · DOCS_AUDIT_EVALUATOR · PREFERENCE_LEARNING | `AgentRunService`를 경유하지 않는 내부 유틸형. 실행 이력 부재만으로 미사용을 단정할 수 없다 |

부수 확인:

- `job_application` 0건, `user_preference_profile` 0건 — 해당 기능은 데이터가 전혀 쌓이지 않았다
- BLOG는 2026-06-25 실패 3건을 마지막으로 정지 상태
- IMPACT_REPORTER 실패 12건은 **2026-07-18 하루에 몰린 사건**이며 그 이후 실패 없음. 현재 고장이 아니다

### 1.2 감사가 드러낸 것

살아 있는 에이전트는 전부 "관찰 · 평가 · 기록" 축이고, 죽어 있는 에이전트는 전부 "개발" 축이다.

개발 에이전트(BE 계열, CTO)는 Slack 슬래시 명령으로만 진입할 수 있는데, 대표는 실제 개발을
Claude Code와 Codex로 수행한다. **기능이 겹쳐서 쓰이지 않는 것**이지 고장난 것이 아니다.

---

## 2. 정체성 재정의

> 이대리는 코드를 짜는 회사가 아니라, **대표의 하루를 관찰해 평가·기록하고 콘텐츠로 바꾸는 회사**다.
> 개발은 대표가 Claude Code로 한다.

이 문장이 이후 모든 부서 배치와 계약의 기준이 된다.

---

## 3. 설계

### 3.1 회사 헌법 — `COMPANY_RULES.md`

레포 루트에 신설한다. 기존 문서와 역할을 분리한다.

| 문서 | 다루는 것 |
|---|---|
| `AGENTS.md` | 개발 규칙 — 코드를 어떻게 짜고 무엇을 금지하는가 |
| `CODE_RULES.md` | 코드 컨벤션 |
| **`COMPANY_RULES.md`** (신설) | **에이전트 행동 규범** — 산출물을 어떻게 내놓고 무엇을 보고하면 안 되는가 |

겹치는 항목은 중복 서술하지 않고 `AGENTS.md`를 링크로 참조한다.

수록 내용:

**절대 규칙 7조** (이대리 맥락으로 번역)

1. 외부 발송·게시는 PreviewGate 승인 후에만 한다 — 노션 기록, PR 코멘트, 블로그 발행, Slack DM
2. 결제·구독·해지 행위를 하지 않는다
3. 원본을 파괴하지 않는다 — DB 삭제, force push, main 직접 커밋 금지
4. 실패를 성공으로 보고하지 않는다 — FAILED 를 요약에서 감추지 않는다
5. 확인되지 않은 정보를 사실처럼 쓰지 않는다 — 근거가 없으면 "미확인"이라고 표시한다
6. 대표 승인 지점을 건너뛰지 않는다
7. 산출물은 소속 부서의 계약(반려 기준)을 통과해야 한다

**문체 기준** — 금칙어, 표기 규칙, 말투. 기존 `HumanizeService`가 이미 담당하는 영역과
겹치므로, 헌법에는 **회사 공통 금칙어 목록만** 두고 문체 교정은 계속 Humanize에 위임한다.

공통 금칙어는 문서와 코드 두 곳에 두면 반드시 어긋난다. **코드를 단일 소스로 삼는다** —
`agent-contract.ts`에 `COMPANY_FORBIDDEN_PHRASES` 상수를 두고, `COMPANY_RULES.md`는
그 상수 파일을 가리키는 링크와 대표 예시 몇 개만 싣는다. 검수기(§3.4)는 이 상수와
에이전트 고유 `forbidPhrases`를 합쳐 검사한다.

### 3.2 부서 — 기존 6부서 유지 + 횡단 2계층

부서 구분은 원래 **Swift 클라이언트에만 하드코딩**돼 있었다
(`clients/idaeri-console/Sources/ConsoleCore/Department.swift:34-49`). 백엔드에는 부서 개념 자체가 없었다.
이번 단계에서 **백엔드를 단일 소스로 만들고**, 콘솔 전환은 4단계로 미룬다.

| 부서 | 소속 |
|---|---|
| **기획** `planning` | PM, PO_EVAL, PO_SHADOW |
| **개발** `engineering` | BE, BE_SCHEMA, BE_TEST, BE_SRE, BE_FIX |
| **리뷰** `review` | CODE_REVIEWER, WORK_REVIEWER, IMPACT_REPORTER, REVIEW_REPLY_JUDGE |
| **경영** `executive` | CTO, CEO |
| **성장** `growth` | BLOG, CAREER_MATE, JOB_APPLICATION, VACATION |
| **내부** `internalOps` | OPS_SUPERVISOR, EVENING_RETRO, HUMANIZER, ISSUE_LABELER, SUBCONSCIOUS_GATE, CONTRADICTION_JUDGE, DOCS_AUDIT_OPTIMIZER, DOCS_AUDIT_EVALUATOR, PREFERENCE_LEARNING |

합계 27개. 부서 값은 Swift `Department` enum 의 rawValue 와 동일하게 맞춰 4단계 전환 시
`Department(rawValue:)` 파싱이 그대로 되게 한다.

**횡단 계층 2개** — 부서가 아니라 모든 부서를 가로지르는 기능이다.

- **검수** — 산출물이 계약을 지켰는지 검사한다. 별도 에이전트가 아니라 코드(§3.4)로 구현한다
- **비서실** — 하루 1회 전 부서를 종합해 "대표가 결정할 것 1건"을 올린다. **2단계 작업**

#### 5부서 재편을 보류한 이유 (2026-08-03 갱신)

초안은 §1.2 실측(개발 축 실행 이력 0)을 근거로 관측·평가·콘텐츠 중심의 **5부서 재편**과
휴직(dormant) 표시를 제안했다. 구현 직전 두 가지가 바뀌어 보류했다.

1. **콘솔 픽셀 오피스(#201)가 머지되며 평면도가 6구역으로 굳었다.** `OfficeFloorPlan.swift`
   가 기존 `Department` 를 그대로 소비하므로, 백엔드만 5부서로 가면 화면과 어긋난다.
2. **#199 로 CTO·PO Shadow 가 autopilot noon 그룹에 편입됐다.** "안 쓰인다" 는 전제가
   일부 무너졌다(BE 계열 5종은 여전히 실행 0).

휴직 표시도 같은 이유로 넣지 않는다 — 실행 0회 에이전트를 자동화에 묶는 작업이 진행 중이라
곧 뒤집힐 라벨이다. 계약의 알맹이(하는 일·산출물 규격·근거 요구·다음 부서)는 부서 구분과
독립이므로 이 보류가 1단계의 나머지 설계에 영향을 주지 않는다.

### 3.3 계약 데이터 — `src/agent-registry/agent-contract.ts` (신설)

노션 템플릿의 "부서별 명세"(오늘 할 일 / 기준 3줄 / 결과물 / 다음 부서)를 코드가 읽을 수 있는
형태로 옮긴다.

```ts
export enum Department {
  PLANNING = 'planning',
  ENGINEERING = 'engineering',
  REVIEW = 'review',
  EXECUTIVE = 'executive',
  GROWTH = 'growth',
  INTERNAL_OPS = 'internalOps',
}

export interface AgentContract {
  /** 소속 부서. */
  readonly department: Department;
  /** "오늘 할 일" 한 줄. 프롬프트 주입에 사용한다. */
  readonly job: string;
  /** 산출물 JSON 이 반드시 가져야 할 최상위 키. 빈 배열이면 필드 검사를 건너뛴다. */
  readonly deliverableFields: readonly string[];
  /** 근거(URL · PR 참조 · 파일:라인) 를 1개 이상 요구하는가. */
  readonly requireEvidence: boolean;
  /** 이 에이전트 고유 금칙어. 회사 공통 금칙어에 더해진다. */
  readonly forbidPhrases?: readonly string[];
  /** 산출물을 넘겨받는 다음 부서. 체인 끝이면 null. */
  readonly nextAgent: AgentType | null;
}

export const AGENT_CONTRACTS: Record<AgentType, AgentContract> = { ... };
```

`Record<AgentType, ...>` 타입이므로 새 에이전트를 추가하면 계약 누락이 **컴파일 타임에** 걸린다.
기존 `AGENT_TO_PROVIDER`와 같은 방식이다.

**계약 정밀도는 실사용도에 맞춘다** — 27개를 전부 정밀하게 채우는 비용이 크고, 한 번도
돌아본 적 없는 에이전트는 산출물 형태를 실측할 방법 자체가 없다.

| 정밀도 | 대상 | 채우는 범위 |
|---|---|---|
| 정밀 | 실사용 9 + 미발화 3 = **12개** | 실제 usecase 출력 타입을 읽어 `deliverableFields`를 정확히 채운다 |
| 스텁 | 나머지 **15개** | `department` · `job`만. `deliverableFields`는 빈 배열(검사 스킵) |

`deliverableFields`는 반드시 **각 usecase의 실제 출력 타입에서 뽑는다.** 실제 스키마와 다른
필드명을 계약에 적으면 프롬프트 주입(§3.6) 시 모델이 혼란을 겪는다.

### 3.4 결정론 검수 — `src/agent-registry/contract-inspector.ts` (신설)

부수효과 없는 순수 함수 하나다. LLM을 호출하지 않으므로 비용과 지연이 0이다.

```ts
export interface ContractViolation {
  readonly rule: 'missingField' | 'forbiddenPhrase' | 'noEvidence';
  readonly detail: string;
}

export function inspectContract(
  agentType: AgentType,
  output: unknown,
): readonly ContractViolation[];
```

검사 규칙 3종:

| 규칙 | 판정 |
|---|---|
| `missingField` | `deliverableFields`의 키가 output 최상위에 없거나 값이 비어 있다 |
| `forbiddenPhrase` | 회사 공통 금칙어 또는 에이전트 고유 금칙어가 output 문자열에 포함돼 있다 |
| `noEvidence` | `requireEvidence: true`인데 output 어디에도 URL · `#숫자` PR 참조 · `파일:라인` 패턴이 없다 |

`deliverableFields`가 빈 배열이면 필드 검사를 건너뛴다. 산출물이 객체가 아니면(배열·문자열·null)
최상위 키 개념이 성립하지 않으므로 검사 전체를 건너뛴다.

판단형 기준(예: "추상적 감상으로 끝나지 않았는가")은 이 단계에서 다루지 않는다. 결정론 검사가
쌓아 놓은 위반 데이터를 본 뒤 3단계에서 검수 LLM 도입 여부를 판단한다.

### 3.5 집행 지점 — 관측 모드부터

`AgentRunService.execute`(`src/agent-run/application/agent-run.service.ts:105`) 한 곳에서
호출한다. 모든 에이전트가 이 경로를 지나므로 개별 usecase를 건드릴 필요가 없다.

**1단계에서는 차단하지 않는다.** 위반이 발견돼도 실행 상태(`status`)를 바꾸지 않고 기록만 한다.

이유: 27개 에이전트의 기존 산출물이 새 계약을 얼마나 지키는지 아직 모른다. 처음부터 차단하면
매일 도는 cron 산출물이 무더기로 반려돼 서비스가 멈출 수 있다. 실측 데이터를 먼저 쌓는다.

기록 위치는 `agent_run` 테이블에 **컬럼을 추가**한다.

```prisma
contractViolations Json? @map("contract_violations")
```

`output` JSON 안에 섞지 않는 이유는, 기존 output 소비자(콘솔 read API, 리포트 포매터)가
예상하지 못한 키를 만나 깨지는 것을 피하기 위해서다.

차단 모드로의 전환은 위반 통계를 확인한 뒤 별도 판단한다.

### 3.6 프롬프트 주입 — 계약을 모델에게 알린다

계약을 데이터로만 두면 모델은 여전히 기준을 모른 채 답한다. 계약 요약을 프롬프트 앞에 붙여
모델이 스스로 지키게 한다.

주입 지점은 `ModelRouterUsecase`(`src/model-router/application/model-router.usecase.ts`) 한 곳이다.
CLI provider 호출 직전에 agentType으로 계약을 조회해 4줄 내외의 머리말을 붙인다.

```
[사규] 너는 {부서명}의 {job} 담당이다.
산출물에 반드시 포함: {deliverableFields}
근거 없는 주장을 쓰지 않는다. 확인 못 한 것은 "미확인"이라고 표시한다.
{금칙어가 있으면} 다음 표현을 쓰지 않는다: {forbidPhrases}
```

- 길이는 200바이트 내외다. 기존 프롬프트 상한 16KB(`MAX_PROMPT_BYTES`)에 실질적 영향이 없다
- 계약이 스텁(산출물 규격도 근거 요구도 없음)이면 주입하지 않는다
- 별도 env 플래그를 만들지 않는다. 문제가 생기면 커밋 되돌리기로 충분하다

### 3.7 콘솔로의 부서 노출 (백엔드까지만)

`src/console/application/console-read.service.ts`가 만드는 에이전트 카드 응답에
`department`와 `status`를 추가한다. Swift는 이번 단계에서 **수정하지 않는다** — 모르는 필드는
무시되므로 안전하다.

Swift의 하드코딩 매핑을 API 소비로 바꾸는 작업은 4단계다. 그때까지 부서 정의가 두 곳에
존재하며, 이는 **의도된 일시적 중복**이다.

---

## 4. 범위 밖 (후속 단계)

| 단계 | 내용 |
|---|---|
| 2단계 | 비서실 브리핑 — 하루 1회 전 부서 종합 + "대표가 결정할 것 1건" |
| 3단계 | 콘텐츠부 파이프라인 — 조사 → 기획 → 검수 → 대표 승인 → 발행 → 성과. BLOG 복구 포함 |
| 4단계 | 콘솔 오피스 UI — 새 부서 5구획 반영, 휴직 에이전트 시각 구분, Swift 부서 매핑을 API 소비로 전환 |

이번 단계에서 **하지 않는 것**:

- 에이전트 코드 삭제 · BE 계열 통합 리팩토링
- 검수 LLM 도입 (결정론 검사만)
- 위반 시 차단 · 재시도
- PreviewGate 승인 지점 변경
- Swift 클라이언트 수정

---

## 5. 리스크

| 리스크 | 대응 |
|---|---|
| 프롬프트 머리말이 기존 출력 스키마와 충돌해 산출물 형식이 깨진다 | `deliverableFields`를 실제 usecase 출력 타입에서 뽑는다. 정밀 12개는 구현 시 타입을 직접 확인한다 |
| 부서 정의가 백엔드·Swift 두 곳에 존재해 드리프트가 난다 | 의도된 일시 중복임을 명시하고 4단계에서 해소. 그때까지 Swift는 폴백으로만 동작 |
| `agent_run` 컬럼 추가가 병렬 worktree의 DB를 흔든다 | 로컬 PostgreSQL@5434는 여러 worktree가 공유한다. `db:push` 직전 현재 worktree에서 재동기화한다 |
| 계약이 지나치게 엄격해 정상 산출물이 위반으로 기록된다 | 1단계는 관측 모드라 실제 피해가 없다. 위반 통계를 보고 계약을 조정한다 |

---

## 6. 검증

- `inspectContract` 단위 테스트 — 규칙 3종 × (위반 · 통과), 빈 계약 스킵, 비객체 산출물 스킵
- 계약 완전성 테스트 — `AGENT_CONTRACTS` 키 집합이 `AgentType` enum과 일치 (기존 `agent-registry.spec.ts` 패턴)
- 계약 무결성 테스트 — 모든 계약이 `job` 을 명시, 다음 부서로 자기 자신을 지정하지 않음,
  근거를 요구하는 계약은 산출물 필수 필드도 함께 정의
- `pnpm lint:check && pnpm test && pnpm build` 3중 통과
- `pnpm docs:check` 통과 (계약이 문서 생성에 반영되는 경우)
- 실제 동작 확인: 앱 기동 후 PM 등 실사용 에이전트를 1회 실행해 `contract_violations` 컬럼이
  채워지는지 확인. 이 검증은 실행 결과와 함께 정직하게 보고한다
