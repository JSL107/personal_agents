# PR 리뷰 루프 Phase 1 (발사·게시) 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이대리가 cron 스윕으로 열린 PR을 스스로 리뷰하고, 지적을 낱개 카드(`PrReviewFinding`)로 영속화한 뒤 GitHub 인라인 코멘트로 게시한다. 신호 수집·학습은 Phase 2·3.

**Architecture:** 신규 모듈 `src/pr-review-loop/`가 스윕 오케스트레이션·카드 영속화·게시를 전담한다. 리뷰 생성(LLM)은 기존 `code-reviewer` 모듈에 그대로 두고 출력 스키마만 확장한다. 발사는 autopilot playbook task(`pr-review-sweep`)가 담당한다 — GitHub webhook은 이 환경에 도달하지 않으므로(실적 0건) 쓰지 않는다.

**Tech Stack:** NestJS 10 (hexagonal: domain/application/infrastructure), Prisma 6 (PostgreSQL@5434), Octokit REST, BullMQ(autopilot), Jest, pnpm@9.15.9

**Spec:** `docs/superpowers/specs/2026-07-31-self-learning-code-reviewer-design.md`

---

## Global Constraints

- **패키지 매니저는 `pnpm` 고정.** `npm`/`yarn` 금지.
- **ORM은 Prisma만.** TypeORM / `@nestjs/typeorm` import 금지. raw SQL 금지.
- **`process.env` 직접 참조 금지** → `ConfigService.get(...)`. (DI 컨텍스트 밖만 예외)
- **모든 신규 기능은 기본 OFF.** CI 불변식 검사(`scripts/check-invariants.cjs`)가 자율 기능의 default OFF를 강제한다.
- **DB 변경은 `prisma/schema.prisma` 수정 → `pnpm db:push`** (마이그레이션 파일 없음). 스키마 변경 후 `pnpm prisma:generate` 필수.
- **DB는 병렬 worktree가 공유한다** (PostgreSQL@5434). `db:push`는 반드시 **작업 중인 worktree에서** 실행한다 — 다른 브랜치에서 push하면 이 브랜치 테이블이 사라진다.
- **env 추가 시 4곳 동기 갱신**: `.env.example` + `.env` + `src/config/app.config.ts`(class-validator) + `README` 표.
- **커밋 전 게이트**: `pnpm lint:check && pnpm test && pnpm build` 3중 exit 0. 하나라도 실패하면 완료가 아니다.
- **단일 파일 테스트는 `pnpm exec jest <경로>`로 돌린다.** `pnpm test -- <경로>`는 이 레포의 2단계 test 스크립트 때문에 필터가 먹지 않고 전체가 돈다.
- **코드 스타일**: `catch (error)` (`err` 금지), `found`/`repository`/`request` (`existing`/`repo`/`req` 금지), `if` 단일 라인도 중괄호 필수, `try` 안에서 `return await`, 인라인 반환 타입 금지(별도 type 추출).
- **파일명**: kebab-case + role suffix (`*.usecase.ts`, `*.repository.ts`, `*.parser.ts`, `*.spec.ts`).
- **커밋은 이 플랜의 각 Task 끝에서만.** 플랜 밖 자발적 커밋 금지.

### 작업 공간

구현은 **격리 worktree**에서 한다. 경로는 ASCII만 사용한다 — 한글 경로(`기타`)는 codex 위임 시 websocket 실패를 유발한다.

```bash
git worktree add /Users/juneseok/worktrees/idaeri-review-loop -b feat/pr-review-loop-phase1 main
cd /Users/juneseok/worktrees/idaeri-review-loop
pnpm install
pnpm prisma:generate   # @prisma 빌드 에러 예방
pnpm rebuild           # tree-sitter TypeError 예방
```

baseline 확인: `pnpm lint:check && pnpm test && pnpm build`가 **변경 전에** 3중 green이어야 한다. 아니면 코드를 만지기 전에 위 두 명령을 먼저 돌린다.

### Task별 TDD 적용 여부

| Task | 내용 | TDD |
|---|---|---|
| 1 | 리뷰 출력 스키마 `findings` + 파서 하위호환 + 프롬프트 | ✅ (파서) |
| 2 | `PrReviewFinding` Prisma 스키마 + db:push | ❌ 선언·마이그레이션 |
| 3 | 지문(fingerprint) 생성 | ✅ |
| 4 | diff hunk 파싱 + 줄 스냅 | ✅ |
| 5 | Finding 타입·포트·Prisma 어댑터 | ✅ |
| 6 | `GithubClientPort` 확장 + Octokit 어댑터 | ✅ |
| 7 | 게시 정책(순수) + 게시 서비스(3단 폴백) | ✅ |
| 8 | Slack 요약 포맷터 | ✅ |
| 9 | 스윕 usecase | ✅ |
| 10 | autopilot task + playbook + 모듈 배선 | ✅ (task만, 배선은 ❌) |
| 11 | env 4곳 동기화 + 전체 게이트 | ❌ 설정 |
| 12 | 연습 모드 실증 | ❌ 수동 검증 |

---

## File Structure

**생성**

| 파일 | 책임 |
|---|---|
| `src/pr-review-loop/domain/pr-review-finding.type.ts` | 카드 도메인 타입·상태·게시 모드 |
| `src/pr-review-loop/domain/finding-fingerprint.ts` | 지문 생성 (순수) |
| `src/pr-review-loop/domain/diff-hunk.parser.ts` | diff hunk 범위 파싱 + 줄 스냅 (순수) |
| `src/pr-review-loop/domain/publish-policy.ts` | allowlist 판정, 게시 상한 정렬·절단 (순수) |
| `src/pr-review-loop/domain/publish-outcome.type.ts` | 게시 집계·스윕 결과 타입 (application ↔ slack 순환 import 차단용) |
| `src/pr-review-loop/domain/port/pr-review-finding.repository.port.ts` | 카드 저장 포트 |
| `src/pr-review-loop/infrastructure/pr-review-finding.prisma.repository.ts` | Prisma 어댑터 |
| `src/pr-review-loop/application/publish-findings.service.ts` | 게시 오케스트레이션 (3단 폴백) |
| `src/pr-review-loop/application/sweep-pr-reviews.usecase.ts` | 스윕: 발사 → 카드 생성 → 게시 |
| `src/pr-review-loop/pr-review-loop.module.ts` | 모듈 |
| `src/slack/format/pr-review-sweep.formatter.ts` | 스윕 결과 Slack 요약 |
| `src/autopilot/infrastructure/tasks/pr-review-sweep.autopilot-task.ts` | autopilot task |

**수정**

| 파일 | 변경 |
|---|---|
| `src/agent/code-reviewer/domain/code-reviewer.type.ts` | `ReviewFinding`·카테고리·심각도 추가, `PullRequestReview.findings` 필수 필드 |
| `src/agent/code-reviewer/domain/prompt/pr-review.parser.ts` | `findings` 검증 + 구버전 응답 변환 |
| `src/agent/code-reviewer/domain/prompt/code-reviewer-system.prompt.ts` | `findings` 출력 지시 + 줄 번호 규칙 |
| `src/github/domain/github.type.ts` | `PullRequestDetail.headSha`, 게시 결과 타입 |
| `src/github/domain/port/github-client.port.ts` | `createReviewComment` 추가 |
| `src/github/infrastructure/octokit-github.client.ts` | 위 메서드 구현 + `headSha` 매핑 |
| `src/agent-run/domain/agent-run.type.ts` | `TriggerType.PR_REVIEW_SWEEP` |
| `prisma/schema.prisma` | `PrReviewFinding` 모델 + `AgentRun` 역관계 |
| `src/autopilot/domain/autopilot.playbook.ts` / `autopilot.playbook-defaults.ts` | `pr-review-sweep` 등록 |
| `src/autopilot/autopilot.module.ts` | task 프로바이더 등록 |
| `src/app.module.ts` | `PrReviewLoopModule` import |
| `src/config/app.config.ts` | env 4개 |
| `.env.example` / `.env` / `README.md` | env 4개 |

---

### Task 1: 리뷰 출력에 카테고리·심각도 추가

지금 지적은 `mustFix: string[]`이라 카테고리가 없다. 카테고리가 없으면 Phase 3의 카테고리별 채택률을 낼 수 없고, 심각도가 없으면 "버그 지적은 억제 면제"를 판정할 수 없다. 따라서 카드 구조의 전제가 여기서 만들어진다.

**Files:**
- Modify: `src/agent/code-reviewer/domain/code-reviewer.type.ts`
- Modify: `src/agent/code-reviewer/domain/prompt/pr-review.parser.ts`
- Modify: `src/agent/code-reviewer/domain/prompt/code-reviewer-system.prompt.ts`
- Test: `src/agent/code-reviewer/domain/prompt/pr-review.parser.spec.ts` (기존 파일에 추가)
- Modify (타입 컴파일 보수): `src/agent/code-reviewer/application/review-pull-request.usecase.spec.ts`, `src/agent/code-reviewer/infrastructure/code-reviewer.dispatcher.spec.ts`, `src/slack/slack.service.spec.ts`

**Interfaces:**
- Produces: `FindingCategory`, `FindingSeverity`, `ReviewFinding`, `PullRequestReview.findings: ReviewFinding[]` — Task 5·7·9가 이 타입을 소비한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/agent/code-reviewer/domain/prompt/pr-review.parser.spec.ts` 맨 아래에 추가한다. 기존 테스트에서 쓰는 유효 응답 객체 리터럴이 있으면 재사용하고, 없으면 아래 `baseResponse`를 그대로 쓴다.

```ts
describe('parsePullRequestReview — findings', () => {
  const baseResponse = {
    summary: '요약',
    riskLevel: 'medium',
    mustFix: ['트랜잭션 누락'],
    niceToHave: ['변수명 개선'],
    missingTests: ['실패 케이스 테스트 없음'],
    reviewCommentDrafts: [],
    approvalRecommendation: 'request_changes',
  };

  it('findings 가 있으면 그대로 정본으로 쓴다', () => {
    const text = JSON.stringify({
      ...baseResponse,
      findings: [
        {
          category: 'RELIABILITY',
          severity: 'MUST_FIX',
          file: 'src/foo.service.ts',
          line: 42,
          body: '트랜잭션 밖에서 저장한다',
        },
      ],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings).toEqual([
      {
        category: 'RELIABILITY',
        severity: 'MUST_FIX',
        file: 'src/foo.service.ts',
        line: 42,
        body: '트랜잭션 밖에서 저장한다',
      },
    ]);
  });

  it('findings 가 없으면 기존 3배열에서 UNCLASSIFIED 로 변환한다', () => {
    const parsed = parsePullRequestReview(JSON.stringify(baseResponse));

    expect(parsed.findings).toEqual([
      {
        category: 'UNCLASSIFIED',
        severity: 'MUST_FIX',
        body: '트랜잭션 누락',
      },
      {
        category: 'UNCLASSIFIED',
        severity: 'NICE_TO_HAVE',
        body: '변수명 개선',
      },
      {
        category: 'UNCLASSIFIED',
        severity: 'MISSING_TEST',
        body: '실패 케이스 테스트 없음',
      },
    ]);
  });

  it('findings 요소의 category 가 목록 밖이면 UNCLASSIFIED 로 강등한다', () => {
    const text = JSON.stringify({
      ...baseResponse,
      findings: [{ category: 'NONSENSE', severity: 'MUST_FIX', body: '본문' }],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings[0].category).toBe('UNCLASSIFIED');
  });

  it('findings 요소의 severity 가 목록 밖이면 NICE_TO_HAVE 로 강등한다', () => {
    const text = JSON.stringify({
      ...baseResponse,
      findings: [{ category: 'STYLE', severity: 'WHATEVER', body: '본문' }],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings[0].severity).toBe('NICE_TO_HAVE');
  });

  it('findings 요소에 body 가 없으면 그 요소를 버린다', () => {
    const text = JSON.stringify({
      ...baseResponse,
      findings: [{ category: 'STYLE', severity: 'NICE_TO_HAVE' }],
    });

    const parsed = parsePullRequestReview(text);

    expect(parsed.findings).toEqual([]);
  });
});
```

카테고리·심각도를 예외로 던지지 않고 강등하는 이유: LLM이 라벨 하나를 틀렸다고 리뷰 전체를 버리면 손해가 크다. 지적 본문이 살아 있으면 가치가 있다.

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm exec jest src/agent/code-reviewer/domain/prompt/pr-review.parser.spec.ts
```

Expected: FAIL — `parsed.findings`가 `undefined` (`Property 'findings' does not exist on type 'PullRequestReview'` 컴파일 에러도 함께).

- [ ] **Step 3: 타입 추가**

`src/agent/code-reviewer/domain/code-reviewer.type.ts`에 추가한다. 카테고리 목록은 시스템 프롬프트의 6단 우선순위와 1:1 정렬한 것이다.

```ts
// 지적 분류 — 시스템 프롬프트의 우선순위 6단과 1:1 정렬.
// Phase 3 의 카테고리별 채택률 집계와 억제 면제 판정이 이 값에 의존한다.
export type FindingCategory =
  | 'CORRECTNESS' // 정확성·회귀·데이터 유실
  | 'SECURITY'
  | 'RELIABILITY' // 동시성·트랜잭션·에러 처리·외부 API graceful
  | 'TEST' // 커버리지 누락
  | 'ARCHITECTURE' // DDD / Port-Adapter 위반, 의존 방향
  | 'READABILITY' // 네이밍·가독성·중복
  | 'STYLE' // 포맷·주석·lint 영역
  | 'UNCLASSIFIED'; // 구버전 응답 호환 / 라벨 강등

export type FindingSeverity = 'MUST_FIX' | 'NICE_TO_HAVE' | 'MISSING_TEST';

export interface ReviewFinding {
  category: FindingCategory;
  severity: FindingSeverity;
  file?: string;
  line?: number;
  body: string;
}
```

`PullRequestReview`에 필드를 추가한다. optional 이 아니라 필수로 둔다 — 파서가 항상 채우므로, optional 로 두면 소비처마다 `?? []` 가 번진다.

```ts
export interface PullRequestReview {
  summary: string;
  riskLevel: RiskLevel;
  mustFix: string[];
  niceToHave: string[];
  missingTests: string[];
  reviewCommentDrafts: ReviewCommentDraft[];
  approvalRecommendation: ApprovalRecommendation;
  // 지적 낱개 목록 — 카드(PrReviewFinding)의 원본. 파서가 항상 채운다.
  // 구버전 모델 응답(findings 없음)은 mustFix/niceToHave/missingTests 에서 변환된다.
  findings: ReviewFinding[];
}
```

- [ ] **Step 4: 파서 구현**

`src/agent/code-reviewer/domain/prompt/pr-review.parser.ts`를 수정한다.

import 를 확장한다.

```ts
import {
  ApprovalRecommendation,
  FindingCategory,
  FindingSeverity,
  PullRequestReview,
  ReviewCommentDraft,
  ReviewFinding,
  RiskLevel,
} from '../code-reviewer.type';
```

상수와 변환 함수를 파일 하단(기존 헬퍼들 옆)에 추가한다.

```ts
const FINDING_CATEGORIES: ReadonlySet<FindingCategory> = new Set([
  'CORRECTNESS',
  'SECURITY',
  'RELIABILITY',
  'TEST',
  'ARCHITECTURE',
  'READABILITY',
  'STYLE',
  'UNCLASSIFIED',
]);

const FINDING_SEVERITIES: ReadonlySet<FindingSeverity> = new Set([
  'MUST_FIX',
  'NICE_TO_HAVE',
  'MISSING_TEST',
]);

// 라벨이 틀렸다고 지적을 버리지 않는다 — 본문이 살아 있으면 가치가 있으므로 강등만 한다.
const toFinding = (value: unknown): ReviewFinding | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.body !== 'string' || record.body.trim().length === 0) {
    return null;
  }
  const category = FINDING_CATEGORIES.has(record.category as FindingCategory)
    ? (record.category as FindingCategory)
    : 'UNCLASSIFIED';
  const severity = FINDING_SEVERITIES.has(record.severity as FindingSeverity)
    ? (record.severity as FindingSeverity)
    : 'NICE_TO_HAVE';
  const finding: ReviewFinding = { category, severity, body: record.body };
  if (typeof record.file === 'string') {
    finding.file = record.file;
  }
  if (typeof record.line === 'number') {
    finding.line = record.line;
  }
  return finding;
};

// 구버전 응답(findings 없음) 호환 — 3배열을 severity 로 매핑해 카드 원본을 만든다.
const findingsFromLegacyArrays = (
  review: Omit<PullRequestReview, 'findings'>,
): ReviewFinding[] => [
  ...review.mustFix.map((body) => legacyFinding(body, 'MUST_FIX')),
  ...review.niceToHave.map((body) => legacyFinding(body, 'NICE_TO_HAVE')),
  ...review.missingTests.map((body) => legacyFinding(body, 'MISSING_TEST')),
];

const legacyFinding = (
  body: string,
  severity: FindingSeverity,
): ReviewFinding => ({ category: 'UNCLASSIFIED', severity, body });
```

`parsePullRequestReview` 를 수정한다. shape 검증은 기존 필드만 보고(`findings` 는 optional 취급), 검증 통과 후 `findings` 를 채운다.

```ts
export const parsePullRequestReview = (text: string): PullRequestReview => {
  const cleaned = stripCodeFence(text.trim());
  const parsed = parseJson(cleaned);

  if (!isPullRequestReviewShape(parsed)) {
    throw new CodeReviewerException({
      code: CodeReviewerErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답이 PullRequestReview 스키마와 맞지 않습니다.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  const rawFindings = (parsed as unknown as Record<string, unknown>).findings;
  const findings = Array.isArray(rawFindings)
    ? rawFindings.map(toFinding).filter((finding): finding is ReviewFinding => finding !== null)
    : findingsFromLegacyArrays(parsed);

  return { ...parsed, findings };
};
```

`isPullRequestReviewShape` 의 반환 타입을 `value is Omit<PullRequestReview, 'findings'>` 로 바꾼다 — 검증 시점에는 `findings` 가 아직 없다.

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm exec jest src/agent/code-reviewer/domain/prompt/pr-review.parser.spec.ts
```

Expected: PASS (신규 5건 + 기존 전부).

- [ ] **Step 6: 시스템 프롬프트에 출력 지시 추가**

`src/agent/code-reviewer/domain/prompt/code-reviewer-system.prompt.ts` 의 `## 출력 규칙` JSON 스키마에 `findings` 를 추가하고, 그 위에 규칙 문단을 넣는다.

기존 `- 근거 없는 칭찬/비판 금지. diff 에서 인용 가능한 사실만.` 아래에 추가한다.

```
- findings 는 위 mustFix / niceToHave / missingTests 를 **낱개 항목으로 쪼갠 것**이다. 같은 지적을 중복해 넣지 말고, 각 항목에 category 와 severity 를 붙인다.
  - category: CORRECTNESS(정확성·회귀·데이터 유실) / SECURITY / RELIABILITY(동시성·트랜잭션·에러 처리·외부 API) / TEST(커버리지 누락) / ARCHITECTURE(DDD·Port-Adapter 위반) / READABILITY(네이밍·가독성·중복) / STYLE(포맷·주석·lint 영역)
  - severity: MUST_FIX(머지 전 필수) / NICE_TO_HAVE(후속 가능) / MISSING_TEST(테스트 누락)
- **line 은 diff 에 실제로 나타난 줄만 쓴다.** diff 에 없는 줄 번호를 쓰면 GitHub 이 코멘트를 거부한다. 확실하지 않으면 line 을 생략하고 file 만 쓴다.
```

JSON 스키마 블록에 필드를 추가한다.

```
  "findings": [
    { "category": string, "severity": string, "file": string?, "line": number?, "body": string }
  ],
```

- [ ] **Step 7: 타입 확장으로 깨진 기존 spec 보수**

`PullRequestReview` 리터럴을 만드는 spec 3곳에 `findings: []` 를 추가한다. (`findings` 를 실제로 검증하는 테스트는 이번 Task 범위가 아니므로 빈 배열로 컴파일만 통과시킨다.)

```bash
pnpm exec jest src/agent/code-reviewer src/slack/slack.service.spec.ts
```

Expected: FAIL 목록에 `Property 'findings' is missing` 이 뜨는 파일들 — `review-pull-request.usecase.spec.ts`, `code-reviewer.dispatcher.spec.ts`, `slack.service.spec.ts`. 각 리터럴에 `findings: []` 를 넣고 다시 돌려 PASS 확인.

- [ ] **Step 8: 전체 게이트 + 커밋**

```bash
pnpm lint:check && pnpm test && pnpm build
```

3중 green 확인 후 커밋한다.

```bash
git add src/agent/code-reviewer src/slack/slack.service.spec.ts
git commit -m "feat(code-reviewer): 리뷰 출력에 findings(카테고리·심각도) 추가 — 카드 단위 학습 전제"
```

---

### Task 2: `PrReviewFinding` Prisma 스키마

**TDD 없음** — 스키마 선언과 DB 반영이다. 검증은 `prisma:generate` 성공과 `pnpm build` 통과로 한다.

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `prisma.prReviewFinding` 델리게이트 — Task 5 의 어댑터가 소비한다.

- [ ] **Step 1: 모델 추가**

`prisma/schema.prisma` 의 `PrReviewOutcome` 모델 아래에 추가한다.

```prisma
// PR 리뷰 루프 Phase 1 — 지적 1건 = 카드 1행. 리뷰 전체 평가인 PrReviewOutcome 과 다른 개념이다.
// status 가 카드 생애의 정본이고, GitHub 은 동기화 대상이다(스펙 §4-6).
model PrReviewFinding {
  id         Int      @id @default(autoincrement())
  agentRunId Int      @map("agent_run_id")
  agentRun   AgentRun @relation(fields: [agentRunId], references: [id], onDelete: Cascade)
  // 'CODE_REVIEWER' — BE_FIX 등 다른 에이전트 지적 편입 대비.
  agentType  String   @map("agent_type")
  repo       String
  pullNumber Int      @map("pull_number")
  // 리뷰 시점 head sha — Phase 2 커밋 대조의 기준선.
  headSha    String   @map("head_sha")
  category   String
  severity   String
  filePath   String?  @map("file_path")
  line       Int?
  body       String   @db.Text
  // sha256(repo, pullNumber, filePath, 정규화 body) — 재스윕 시 중복 게시 차단.
  fingerprint String  @unique
  // OPEN | ACKED | REJECTED | FIXED | RESOLVED | STALE | SUPPRESSED
  status      String  @default("OPEN")
  // INLINE | FILE | ISSUE_COMMENT | DRY_RUN | NOT_POSTED
  postMode    String  @map("post_mode")
  githubCommentId    BigInt?   @map("github_comment_id")
  githubThreadNodeId String?   @map("github_thread_node_id")
  rejectReason       String?   @db.Text
  decidedAt          DateTime? @map("decided_at")
  resolvedAt         DateTime? @map("resolved_at")
  createdAt          DateTime  @default(now()) @map("created_at")

  @@index([repo, pullNumber, status])
  @@index([category, severity, status])
  @@map("pr_review_finding")
}
```

`AgentRun` 모델의 역관계 목록(`prReviewOutcomes PrReviewOutcome[]` 옆)에 한 줄 추가한다.

```prisma
  prReviewFindings PrReviewFinding[]
```

- [ ] **Step 2: 포맷 + DB 반영 + 클라이언트 재생성**

**반드시 이 worktree 안에서** 실행한다. 다른 worktree에서 돌리면 공유 DB(5434)의 이 브랜치 테이블이 사라진다.

```bash
pnpm prisma format
pnpm db:push
pnpm prisma:generate
```

- [ ] **Step 3: 타입 반영 확인**

```bash
pnpm build
```

Expected: exit 0. (아직 `prReviewFinding` 을 쓰는 코드가 없으므로 통과만 확인한다.)

- [ ] **Step 4: 커밋**

```bash
git add prisma/schema.prisma
git commit -m "feat(pr-review-loop): PrReviewFinding 스키마 — 지적 낱개 카드"
```

---

### Task 3: 지문(fingerprint) 생성

스윕은 15분마다 반복되므로, 같은 지적을 다시 게시하지 않을 유일 키가 필요하다.

**Files:**
- Create: `src/pr-review-loop/domain/finding-fingerprint.ts`
- Test: `src/pr-review-loop/domain/finding-fingerprint.spec.ts`

**Interfaces:**
- Produces: `buildFindingFingerprint({ repo, pullNumber, filePath, body }): string` — Task 9 가 카드 생성 시 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { buildFindingFingerprint } from './finding-fingerprint';

describe('buildFindingFingerprint', () => {
  const base = {
    repo: 'JSL107/personal_agents',
    pullNumber: 180,
    filePath: 'src/foo.service.ts',
    body: '트랜잭션 밖에서 저장한다',
  };

  it('같은 입력은 같은 지문을 낸다', () => {
    expect(buildFindingFingerprint(base)).toBe(buildFindingFingerprint(base));
  });

  it('공백·대소문자 차이는 같은 지문으로 뭉친다', () => {
    const noisy = { ...base, body: '  트랜잭션  밖에서   저장한다 ' };

    expect(buildFindingFingerprint(noisy)).toBe(buildFindingFingerprint(base));
  });

  it('본문이 다르면 지문이 다르다', () => {
    const other = { ...base, body: '인덱스가 없다' };

    expect(buildFindingFingerprint(other)).not.toBe(
      buildFindingFingerprint(base),
    );
  });

  it('PR 번호가 다르면 지문이 다르다 — 다른 PR 의 같은 지적은 별개 카드', () => {
    const other = { ...base, pullNumber: 181 };

    expect(buildFindingFingerprint(other)).not.toBe(
      buildFindingFingerprint(base),
    );
  });

  it('파일이 없어도(null) 지문을 만든다', () => {
    const noFile = { ...base, filePath: null };

    expect(buildFindingFingerprint(noFile)).toHaveLength(64);
  });

  it('줄 번호는 지문에 넣지 않는다 — 같은 지적에 모델이 다른 줄을 줄 수 있다', () => {
    // 시그니처에 line 이 없다는 것 자체가 계약. 컴파일로 보장되므로 문서용 assertion.
    expect(Object.keys(base)).not.toContain('line');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm exec jest src/pr-review-loop/domain/finding-fingerprint.spec.ts
```

Expected: FAIL — `Cannot find module './finding-fingerprint'`.

- [ ] **Step 3: 구현**

```ts
import { createHash } from 'node:crypto';

// 정규화는 최소한만 한다. 과하게 뭉개면 서로 다른 지적이 한 지문으로 합쳐져
// 두 번째 지적이 영구히 게시되지 않는다.
const normalizeBody = (body: string): string =>
  body.trim().replace(/\s+/g, ' ').toLowerCase();

export interface FindingFingerprintInput {
  repo: string;
  pullNumber: number;
  filePath: string | null;
  body: string;
}

// 재스윕 시 같은 지적을 다시 게시하지 않기 위한 유일 키.
// line 은 의도적으로 제외 — 같은 지적에 모델이 매번 다른 줄을 줄 수 있어,
// 줄이 달라도 같은 지적으로 뭉치는 편이 중복 게시보다 낫다.
export const buildFindingFingerprint = ({
  repo,
  pullNumber,
  filePath,
  body,
}: FindingFingerprintInput): string => {
  const source = [
    repo,
    String(pullNumber),
    filePath ?? '',
    normalizeBody(body),
  ].join(' ');
  return createHash('sha256').update(source).digest('hex');
};
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/pr-review-loop/domain/finding-fingerprint.spec.ts
```

Expected: PASS (6건).

- [ ] **Step 5: 커밋**

```bash
pnpm lint:check
git add src/pr-review-loop/domain/finding-fingerprint.ts src/pr-review-loop/domain/finding-fingerprint.spec.ts
git commit -m "feat(pr-review-loop): 지적 지문 생성 — 재스윕 중복 게시 차단"
```

---

### Task 4: diff hunk 파싱 + 줄 스냅

GitHub 인라인 코멘트는 diff에 나타난 줄에만 달 수 있다. LLM이 준 줄이 hunk 밖이면 API가 422로 거부한다. 게시 전에 줄을 교정하는 순수 로직이다.

**Files:**
- Create: `src/pr-review-loop/domain/diff-hunk.parser.ts`
- Test: `src/pr-review-loop/domain/diff-hunk.parser.spec.ts`

**Interfaces:**
- Produces:
  - `parseDiffHunks(diff: string): FileHunkRanges[]`
  - `snapToCommentableLine({ hunks, filePath, line, maxDistance }): number | null`
  - `SNAP_MAX_DISTANCE = 20`
  - Task 7 의 게시 서비스가 둘 다 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import {
  parseDiffHunks,
  snapToCommentableLine,
  SNAP_MAX_DISTANCE,
} from './diff-hunk.parser';

const DIFF = `diff --git a/src/foo.service.ts b/src/foo.service.ts
index 1111111..2222222 100644
--- a/src/foo.service.ts
+++ b/src/foo.service.ts
@@ -10,3 +10,5 @@ export class FooService {
   const a = 1;
+  const b = 2;
+  const c = 3;
   return a;
@@ -40,2 +42,2 @@ export class FooService {
-  old();
+  next();
diff --git a/src/bar.util.ts b/src/bar.util.ts
--- a/src/bar.util.ts
+++ b/src/bar.util.ts
@@ -1 +1,2 @@
+export const bar = 1;
`;

describe('parseDiffHunks', () => {
  it('파일별로 신규 줄 범위를 뽑는다', () => {
    const hunks = parseDiffHunks(DIFF);

    expect(hunks).toEqual([
      {
        filePath: 'src/foo.service.ts',
        ranges: [
          { start: 10, end: 14 },
          { start: 42, end: 43 },
        ],
      },
      { filePath: 'src/bar.util.ts', ranges: [{ start: 1, end: 2 }] },
    ]);
  });

  it('count 가 생략된 hunk 헤더는 1줄로 본다', () => {
    const diff = `--- a/x.ts
+++ b/x.ts
@@ -5 +7 @@
+one
`;

    expect(parseDiffHunks(diff)).toEqual([
      { filePath: 'x.ts', ranges: [{ start: 7, end: 7 }] },
    ]);
  });

  it('삭제된 파일(+++ /dev/null)은 건너뛴다', () => {
    const diff = `--- a/gone.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-gone
`;

    expect(parseDiffHunks(diff)).toEqual([]);
  });

  it('빈 diff 는 빈 배열', () => {
    expect(parseDiffHunks('')).toEqual([]);
  });
});

describe('snapToCommentableLine', () => {
  const hunks = parseDiffHunks(DIFF);

  it('범위 안의 줄은 그대로 반환한다', () => {
    const snapped = snapToCommentableLine({
      hunks,
      filePath: 'src/foo.service.ts',
      line: 12,
      maxDistance: SNAP_MAX_DISTANCE,
    });

    expect(snapped).toBe(12);
  });

  it('범위 밖이면 가장 가까운 경계로 당긴다', () => {
    const snapped = snapToCommentableLine({
      hunks,
      filePath: 'src/foo.service.ts',
      line: 16,
      maxDistance: SNAP_MAX_DISTANCE,
    });

    expect(snapped).toBe(14);
  });

  it('허용 거리를 넘으면 null 을 반환한다', () => {
    const snapped = snapToCommentableLine({
      hunks,
      filePath: 'src/foo.service.ts',
      line: 500,
      maxDistance: SNAP_MAX_DISTANCE,
    });

    expect(snapped).toBeNull();
  });

  it('diff 에 없는 파일이면 null 을 반환한다', () => {
    const snapped = snapToCommentableLine({
      hunks,
      filePath: 'src/unknown.ts',
      line: 3,
      maxDistance: SNAP_MAX_DISTANCE,
    });

    expect(snapped).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm exec jest src/pr-review-loop/domain/diff-hunk.parser.spec.ts
```

Expected: FAIL — `Cannot find module './diff-hunk.parser'`.

- [ ] **Step 3: 구현**

```ts
export interface LineRange {
  start: number;
  end: number;
}

export interface FileHunkRanges {
  filePath: string;
  ranges: LineRange[];
}

export interface SnapInput {
  hunks: FileHunkRanges[];
  filePath: string;
  line: number;
  maxDistance: number;
}

// 스냅 허용 거리. 이보다 멀면 다른 코드에 엉뚱하게 붙는 편보다 파일 단위 강등이 낫다.
export const SNAP_MAX_DISTANCE = 20;

const NEW_FILE_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

// unified diff 에서 파일별 "신규(오른쪽) 파일 기준 줄 범위"를 뽑는다.
// GitHub 인라인 코멘트는 이 범위 안의 줄에만 달 수 있다.
export const parseDiffHunks = (diff: string): FileHunkRanges[] => {
  const files: FileHunkRanges[] = [];
  let current: FileHunkRanges | null = null;

  for (const rawLine of diff.split('\n')) {
    const fileMatch = rawLine.match(NEW_FILE_HEADER);
    if (fileMatch) {
      const filePath = fileMatch[1].trim();
      if (filePath === '/dev/null') {
        current = null;
        continue;
      }
      current = { filePath, ranges: [] };
      files.push(current);
      continue;
    }

    const hunkMatch = rawLine.match(HUNK_HEADER);
    if (hunkMatch && current) {
      const start = Number(hunkMatch[1]);
      const count = hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]);
      if (count > 0) {
        current.ranges.push({ start, end: start + count - 1 });
      }
      continue;
    }
  }

  return files.filter((file) => file.ranges.length > 0);
};

// 범위 안이면 그대로, 밖이면 가장 가까운 경계로 당긴다. 너무 멀면 null.
export const snapToCommentableLine = ({
  hunks,
  filePath,
  line,
  maxDistance,
}: SnapInput): number | null => {
  const found = hunks.find((file) => file.filePath === filePath);
  if (!found) {
    return null;
  }
  const inside = found.ranges.some(
    (range) => line >= range.start && line <= range.end,
  );
  if (inside) {
    return line;
  }

  const candidates = found.ranges.flatMap((range) => [range.start, range.end]);
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - line);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best === null || bestDistance > maxDistance) {
    return null;
  }
  return best;
};
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/pr-review-loop/domain/diff-hunk.parser.spec.ts
```

Expected: PASS (9건).

- [ ] **Step 5: 커밋**

```bash
pnpm lint:check
git add src/pr-review-loop/domain/diff-hunk.parser.ts src/pr-review-loop/domain/diff-hunk.parser.spec.ts
git commit -m "feat(pr-review-loop): diff hunk 파싱 + 줄 스냅 — 인라인 코멘트 422 예방"
```

---

### Task 5: Finding 타입 · 포트 · Prisma 어댑터

**Files:**
- Create: `src/pr-review-loop/domain/pr-review-finding.type.ts`
- Create: `src/pr-review-loop/domain/port/pr-review-finding.repository.port.ts`
- Create: `src/pr-review-loop/infrastructure/pr-review-finding.prisma.repository.ts`
- Test: `src/pr-review-loop/infrastructure/pr-review-finding.prisma.repository.spec.ts`

**Interfaces:**
- Consumes: Task 1 의 `FindingCategory`·`FindingSeverity`, Task 2 의 `prisma.prReviewFinding`
- Produces:
  - `FindingStatus`, `FindingPostMode`, `PrReviewFindingRecord`, `CreateFindingInput`
  - `PR_REVIEW_FINDING_REPOSITORY_PORT` 심볼
  - `PrReviewFindingRepositoryPort`: `createIfAbsent`, `hasAnyForPullRequest`, `markPosted`
  - Task 7·9 가 이 포트를 주입받는다.

- [ ] **Step 1: 도메인 타입 작성**

`src/pr-review-loop/domain/pr-review-finding.type.ts`:

```ts
import {
  FindingCategory,
  FindingSeverity,
} from '../../agent/code-reviewer/domain/code-reviewer.type';

// 카드 생애 상태. 채택률 집계(Phase 3)는 ACKED/FIXED/REJECTED 만 분모에 넣고
// OPEN(미열람)·STALE(결론 없이 PR 종료)·SUPPRESSED 는 제외한다.
export type FindingStatus =
  | 'OPEN'
  | 'ACKED'
  | 'REJECTED'
  | 'FIXED'
  | 'RESOLVED'
  | 'STALE'
  | 'SUPPRESSED';

// 어떤 형태로 게시됐는지. 3단 폴백의 결과가 여기 남는다.
export type FindingPostMode =
  | 'INLINE'
  | 'FILE'
  | 'ISSUE_COMMENT'
  | 'DRY_RUN'
  | 'NOT_POSTED';

export interface CreateFindingInput {
  agentRunId: number;
  agentType: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  category: FindingCategory;
  severity: FindingSeverity;
  filePath: string | null;
  line: number | null;
  body: string;
  fingerprint: string;
  postMode: FindingPostMode;
}

export interface PrReviewFindingRecord {
  id: number;
  agentRunId: number;
  repo: string;
  pullNumber: number;
  headSha: string;
  category: FindingCategory;
  severity: FindingSeverity;
  filePath: string | null;
  line: number | null;
  body: string;
  fingerprint: string;
  status: FindingStatus;
  postMode: FindingPostMode;
  githubCommentId: string | null;
  createdAt: Date;
}

export interface MarkPostedInput {
  id: number;
  postMode: FindingPostMode;
  githubCommentId: string | null;
  githubThreadNodeId: string | null;
}
```

`githubCommentId` 를 `string | null` 로 두는 이유: Prisma `BigInt` 는 JS `bigint` 로 오는데, 도메인·JSON 직렬화에서 `bigint` 는 다루기 번거롭다. 경계에서 문자열로 변환한다.

- [ ] **Step 2: 포트 작성**

`src/pr-review-loop/domain/port/pr-review-finding.repository.port.ts`:

```ts
import {
  CreateFindingInput,
  MarkPostedInput,
  PrReviewFindingRecord,
} from '../pr-review-finding.type';

export const PR_REVIEW_FINDING_REPOSITORY_PORT = Symbol(
  'PR_REVIEW_FINDING_REPOSITORY_PORT',
);

export interface HasAnyForPullRequestInput {
  repo: string;
  pullNumber: number;
}

export interface PrReviewFindingRepositoryPort {
  // 지문이 이미 있으면 null — 재스윕 시 같은 지적을 다시 만들지 않는다.
  createIfAbsent(
    input: CreateFindingInput,
  ): Promise<PrReviewFindingRecord | null>;

  // 이 PR 을 이미 리뷰했는지. PR 당 리뷰 1회 정책의 판정 근거.
  hasAnyForPullRequest(input: HasAnyForPullRequestInput): Promise<boolean>;

  markPosted(input: MarkPostedInput): Promise<void>;
}
```

- [ ] **Step 3: 실패하는 테스트 작성**

`src/pr-review-loop/infrastructure/pr-review-finding.prisma.repository.spec.ts`:

```ts
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateFindingInput } from '../domain/pr-review-finding.type';
import { PrReviewFindingPrismaRepository } from './pr-review-finding.prisma.repository';

const createInput = (): CreateFindingInput => ({
  agentRunId: 7,
  agentType: 'CODE_REVIEWER',
  repo: 'JSL107/personal_agents',
  pullNumber: 180,
  headSha: 'abc1234',
  category: 'RELIABILITY',
  severity: 'MUST_FIX',
  filePath: 'src/foo.service.ts',
  line: 42,
  body: '트랜잭션 밖에서 저장한다',
  fingerprint: 'fp-1',
  postMode: 'INLINE',
});

const buildPrisma = () => ({
  prReviewFinding: {
    create: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
});

describe('PrReviewFindingPrismaRepository', () => {
  let prisma: ReturnType<typeof buildPrisma>;
  let repository: PrReviewFindingPrismaRepository;

  beforeEach(() => {
    prisma = buildPrisma();
    repository = new PrReviewFindingPrismaRepository(
      prisma as unknown as PrismaService,
    );
  });

  it('생성된 행을 도메인 레코드로 변환한다 (BigInt → string)', async () => {
    prisma.prReviewFinding.create.mockResolvedValue({
      id: 1,
      agentRunId: 7,
      repo: 'JSL107/personal_agents',
      pullNumber: 180,
      headSha: 'abc1234',
      category: 'RELIABILITY',
      severity: 'MUST_FIX',
      filePath: 'src/foo.service.ts',
      line: 42,
      body: '트랜잭션 밖에서 저장한다',
      fingerprint: 'fp-1',
      status: 'OPEN',
      postMode: 'INLINE',
      githubCommentId: BigInt(999),
      createdAt: new Date('2026-07-31T00:00:00Z'),
    });

    const created = await repository.createIfAbsent(createInput());

    expect(created?.githubCommentId).toBe('999');
    expect(created?.status).toBe('OPEN');
  });

  it('지문 중복(P2002)이면 null 을 반환한다', async () => {
    prisma.prReviewFinding.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.0.0',
      }),
    );

    const created = await repository.createIfAbsent(createInput());

    expect(created).toBeNull();
  });

  it('P2002 가 아닌 에러는 그대로 던진다', async () => {
    prisma.prReviewFinding.create.mockRejectedValue(new Error('connection'));

    await expect(repository.createIfAbsent(createInput())).rejects.toThrow(
      'connection',
    );
  });

  it('카드가 1건 이상이면 hasAnyForPullRequest 가 true', async () => {
    prisma.prReviewFinding.count.mockResolvedValue(3);

    const found = await repository.hasAnyForPullRequest({
      repo: 'JSL107/personal_agents',
      pullNumber: 180,
    });

    expect(found).toBe(true);
    expect(prisma.prReviewFinding.count).toHaveBeenCalledWith({
      where: { repo: 'JSL107/personal_agents', pullNumber: 180 },
    });
  });

  it('카드가 없으면 hasAnyForPullRequest 가 false', async () => {
    prisma.prReviewFinding.count.mockResolvedValue(0);

    const found = await repository.hasAnyForPullRequest({
      repo: 'JSL107/personal_agents',
      pullNumber: 181,
    });

    expect(found).toBe(false);
  });

  it('markPosted 는 게시 모드와 코멘트 id 를 갱신한다', async () => {
    prisma.prReviewFinding.update.mockResolvedValue({});

    await repository.markPosted({
      id: 1,
      postMode: 'FILE',
      githubCommentId: '999',
      githubThreadNodeId: 'PRRT_node',
    });

    expect(prisma.prReviewFinding.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: {
        postMode: 'FILE',
        githubCommentId: BigInt(999),
        githubThreadNodeId: 'PRRT_node',
      },
    });
  });
});
```

- [ ] **Step 4: 테스트 실패 확인**

```bash
pnpm exec jest src/pr-review-loop/infrastructure/pr-review-finding.prisma.repository.spec.ts
```

Expected: FAIL — `Cannot find module './pr-review-finding.prisma.repository'`.

- [ ] **Step 5: 어댑터 구현**

`src/pr-review-loop/infrastructure/pr-review-finding.prisma.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  FindingCategory,
  FindingSeverity,
} from '../../agent/code-reviewer/domain/code-reviewer.type';
import { PrismaService } from '../../prisma/prisma.service';
import {
  HasAnyForPullRequestInput,
  PrReviewFindingRepositoryPort,
} from '../domain/port/pr-review-finding.repository.port';
import {
  CreateFindingInput,
  FindingPostMode,
  FindingStatus,
  MarkPostedInput,
  PrReviewFindingRecord,
} from '../domain/pr-review-finding.type';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class PrReviewFindingPrismaRepository
  implements PrReviewFindingRepositoryPort
{
  constructor(private readonly prisma: PrismaService) {}

  async createIfAbsent(
    input: CreateFindingInput,
  ): Promise<PrReviewFindingRecord | null> {
    try {
      const created = await this.prisma.prReviewFinding.create({
        data: input,
      });
      return this.toRecord(created);
    } catch (error: unknown) {
      if (this.isDuplicateFingerprint(error)) {
        return null;
      }
      throw error;
    }
  }

  async hasAnyForPullRequest({
    repo,
    pullNumber,
  }: HasAnyForPullRequestInput): Promise<boolean> {
    const count = await this.prisma.prReviewFinding.count({
      where: { repo, pullNumber },
    });
    return count > 0;
  }

  async markPosted({
    id,
    postMode,
    githubCommentId,
    githubThreadNodeId,
  }: MarkPostedInput): Promise<void> {
    await this.prisma.prReviewFinding.update({
      where: { id },
      data: {
        postMode,
        githubCommentId:
          githubCommentId === null ? null : BigInt(githubCommentId),
        githubThreadNodeId,
      },
    });
  }

  private isDuplicateFingerprint(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_CONSTRAINT_VIOLATION
    );
  }

  // BigInt 는 도메인·JSON 경계에서 문자열로 변환한다.
  private toRecord(row: {
    id: number;
    agentRunId: number;
    repo: string;
    pullNumber: number;
    headSha: string;
    category: string;
    severity: string;
    filePath: string | null;
    line: number | null;
    body: string;
    fingerprint: string;
    status: string;
    postMode: string;
    githubCommentId: bigint | null;
    createdAt: Date;
  }): PrReviewFindingRecord {
    return {
      id: row.id,
      agentRunId: row.agentRunId,
      repo: row.repo,
      pullNumber: row.pullNumber,
      headSha: row.headSha,
      category: row.category as FindingCategory,
      severity: row.severity as FindingSeverity,
      filePath: row.filePath,
      line: row.line,
      body: row.body,
      fingerprint: row.fingerprint,
      status: row.status as FindingStatus,
      postMode: row.postMode as FindingPostMode,
      githubCommentId:
        row.githubCommentId === null ? null : row.githubCommentId.toString(),
      createdAt: row.createdAt,
    };
  }
}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
pnpm exec jest src/pr-review-loop/infrastructure/pr-review-finding.prisma.repository.spec.ts
```

Expected: PASS (6건).

- [ ] **Step 7: 커밋**

```bash
pnpm lint:check
git add src/pr-review-loop
git commit -m "feat(pr-review-loop): Finding 타입·포트·Prisma 어댑터"
```

---

### Task 6: `GithubClientPort` 확장 — 인라인 코멘트 게시 + headSha

**Files:**
- Modify: `src/github/domain/github.type.ts`
- Modify: `src/github/domain/port/github-client.port.ts`
- Modify: `src/github/infrastructure/octokit-github.client.ts`
- Test: `src/github/infrastructure/octokit-github.client.spec.ts` (기존 파일에 추가)
- Modify (mock 보수): `GithubClientPort` 전체 타입을 mock 하는 spec들

**Interfaces:**
- Produces:
  - `PullRequestDetail.headSha: string`
  - `CreateReviewCommentInput`, `CreateReviewCommentResult`
  - `GithubClientPort.createReviewComment(input): Promise<CreateReviewCommentResult>`
  - Task 7 이 `createReviewComment` 를, Task 9 가 `headSha` 를 쓴다.

`compareCommits` 는 이 Task에 넣지 않는다 — 후속 커밋 해소 판정(Phase 2)에서만 쓰이므로 지금 추가하면 죽은 코드가 된다. 스펙 §8의 Phase 1 목록에 있던 `compare` 는 Phase 2로 옮긴다.

- [ ] **Step 1: 타입 추가**

`src/github/domain/github.type.ts` 의 `PullRequestDetail` 에 필드를 추가한다.

```ts
  // 리뷰 시점 head commit sha — 카드의 커밋 대조 기준선(Phase 2)이자 인라인 코멘트의 commit_id.
  headSha: string;
```

파일 하단에 게시 타입을 추가한다.

```ts
// PR 리뷰 루프 — 인라인 리뷰 코멘트 1건 게시.
// line 이 있으면 줄 단위, 없으면 파일 단위(subject_type: 'file')로 붙인다.
export interface CreateReviewCommentInput {
  repo: string; // "owner/repo"
  pullNumber: number;
  commitSha: string;
  filePath: string;
  line: number | null;
  body: string;
}

export interface CreateReviewCommentResult {
  commentId: string; // BigInt 를 문자열로
  nodeId: string; // GraphQL resolve(Phase 2) 대상
}
```

- [ ] **Step 2: 포트에 메서드 추가**

`src/github/domain/port/github-client.port.ts` — 파일 상단 import 에 `CreateReviewCommentInput`, `CreateReviewCommentResult` 를 추가하고, 인터페이스에 메서드를 넣는다.

```ts
  // PR 리뷰 루프 Phase 1 — 인라인 리뷰 코멘트 1건 게시.
  // 낱개 호출인 이유: 여러 건을 pulls.createReview 로 묶어 보내면 한 건이 422(줄 앵커 거부)일 때
  // 전체가 실패한다. 낱개로 보내 부분 실패를 격리한다.
  // PAT 에 `pull_requests: write`(fine-grained) 또는 `repo`(classic) 권한이 필요하다.
  createReviewComment(
    input: CreateReviewCommentInput,
  ): Promise<CreateReviewCommentResult>;
```

- [ ] **Step 3: 실패하는 테스트 작성**

`src/github/infrastructure/octokit-github.client.spec.ts` 의 최상위 `describe('OctokitGithubClient')` 안에 아래 블록을 추가한다. 이 파일의 관례는 **테스트마다 인라인으로 Octokit mock 을 만들어 `new OctokitGithubClient(octokit)` 에 넘기는 것**이다(`getPullRequestDiff` 블록과 동일한 형태). 공용 `buildClient` 헬퍼는 없다.

```ts
  describe('createReviewComment', () => {
    it('line 이 있으면 줄 단위로 게시하고 id·nodeId 를 반환한다', async () => {
      const createReviewComment = jest.fn().mockResolvedValue({
        data: { id: 555, node_id: 'PRRC_abc' },
      });
      const octokit = {
        rest: { pulls: { createReviewComment } },
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      const result = await client.createReviewComment({
        repo: 'JSL107/personal_agents',
        pullNumber: 180,
        commitSha: 'abc1234',
        filePath: 'src/foo.service.ts',
        line: 42,
        body: '트랜잭션 밖에서 저장한다',
      });

      expect(createReviewComment).toHaveBeenCalledWith({
        owner: 'JSL107',
        repo: 'personal_agents',
        pull_number: 180,
        commit_id: 'abc1234',
        path: 'src/foo.service.ts',
        body: '트랜잭션 밖에서 저장한다',
        line: 42,
        side: 'RIGHT',
      });
      expect(result).toEqual({ commentId: '555', nodeId: 'PRRC_abc' });
    });

    it('line 이 null 이면 파일 단위(subject_type=file)로 게시한다', async () => {
      const createReviewComment = jest.fn().mockResolvedValue({
        data: { id: 556, node_id: 'PRRC_def' },
      });
      const octokit = {
        rest: { pulls: { createReviewComment } },
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      await client.createReviewComment({
        repo: 'JSL107/personal_agents',
        pullNumber: 180,
        commitSha: 'abc1234',
        filePath: 'src/foo.service.ts',
        line: null,
        body: '본문',
      });

      expect(createReviewComment).toHaveBeenCalledWith({
        owner: 'JSL107',
        repo: 'personal_agents',
        pull_number: 180,
        commit_id: 'abc1234',
        path: 'src/foo.service.ts',
        body: '본문',
        subject_type: 'file',
      });
    });

    it('API 실패는 GithubException 으로 감싼다', async () => {
      const createReviewComment = jest
        .fn()
        .mockRejectedValue(new Error('422 Unprocessable Entity'));
      const octokit = {
        rest: { pulls: { createReviewComment } },
      } as unknown as Octokit;
      const client = new OctokitGithubClient(octokit);

      await expect(
        client.createReviewComment({
          repo: 'JSL107/personal_agents',
          pullNumber: 180,
          commitSha: 'abc1234',
          filePath: 'src/foo.service.ts',
          line: 42,
          body: '본문',
        }),
      ).rejects.toThrow('인라인 리뷰 코멘트 게시 실패');
    });

    it('Octokit 이 없으면 TOKEN_NOT_CONFIGURED 예외', async () => {
      const client = new OctokitGithubClient(null);

      await expect(
        client.createReviewComment({
          repo: 'JSL107/personal_agents',
          pullNumber: 180,
          commitSha: 'abc1234',
          filePath: 'src/foo.service.ts',
          line: 42,
          body: '본문',
        }),
      ).rejects.toMatchObject({
        githubErrorCode: GithubErrorCode.TOKEN_NOT_CONFIGURED,
      });
    });
  });
```

- [ ] **Step 4: 테스트 실패 확인**

```bash
pnpm exec jest src/github/infrastructure/octokit-github.client.spec.ts
```

Expected: FAIL — `client.createReviewComment is not a function`.

- [ ] **Step 5: 어댑터 구현**

`src/github/infrastructure/octokit-github.client.ts` 의 `addIssueComment` 아래에 추가한다. import 에 새 타입 2개를 넣는다.

```ts
  // PR 리뷰 루프 Phase 1 — 카드 1장 = 코멘트 1건. 낱개 호출로 부분 실패를 격리한다.
  async createReviewComment({
    repo,
    pullNumber,
    commitSha,
    filePath,
    line,
    body,
  }: CreateReviewCommentInput): Promise<CreateReviewCommentResult> {
    this.assertOctokitConfigured();
    const [owner, repoName] = parseRepo(repo);

    try {
      // line 이 있으면 줄 단위(side=RIGHT: 변경 후 파일 기준), 없으면 파일 단위.
      const response = await this.octokit!.rest.pulls.createReviewComment(
        line === null
          ? {
              owner,
              repo: repoName,
              pull_number: pullNumber,
              commit_id: commitSha,
              path: filePath,
              body,
              subject_type: 'file',
            }
          : {
              owner,
              repo: repoName,
              pull_number: pullNumber,
              commit_id: commitSha,
              path: filePath,
              body,
              line,
              side: 'RIGHT',
            },
      );
      return {
        commentId: String(response.data.id),
        nodeId: response.data.node_id,
      };
    } catch (error: unknown) {
      throw this.wrapRequestFailed(
        error,
        `인라인 리뷰 코멘트 게시 실패 (${repo}#${pullNumber} ${filePath}:${line ?? 'file'})`,
      );
    }
  }
```

`getPullRequest` 의 반환 객체에 `headSha` 를 추가한다. Octokit 응답의 `data.head.sha` 를 매핑한다.

```ts
      headSha: data.head.sha,
```

- [ ] **Step 6: 테스트 통과 확인 + 깨진 mock 보수**

```bash
pnpm exec jest src/github/infrastructure/octokit-github.client.spec.ts
```

Expected: PASS (4건).

포트에 메서드를 추가했으므로 `jest.Mocked<GithubClientPort>` 로 전체 mock 하는 spec들이 "Property 'createReviewComment' is missing" 으로 깨진다. **전체 테스트로만 잡히므로 반드시 전체를 돌린다.**

```bash
pnpm test
```

깨진 각 spec 의 mock 객체에 stub 을 추가한다.

```ts
  createReviewComment: jest.fn(),
```

`PullRequestDetail` 리터럴을 만드는 spec들에도 `headSha: 'sha'` 를 추가한다.

- [ ] **Step 7: 커밋**

```bash
pnpm lint:check && pnpm test && pnpm build
git add src/github src/agent src/preview-gate src/webhook
git commit -m "feat(github): 인라인 리뷰 코멘트 게시 + PullRequestDetail.headSha"
```

---

### Task 7: 게시 정책(순수) + 게시 서비스(3단 폴백)

**Files:**
- Create: `src/pr-review-loop/domain/publish-outcome.type.ts`
- Create: `src/pr-review-loop/domain/publish-policy.ts`
- Create: `src/pr-review-loop/domain/publish-policy.spec.ts`
- Create: `src/pr-review-loop/application/publish-findings.service.ts`
- Create: `src/pr-review-loop/application/publish-findings.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ReviewFinding`, Task 4 `parseDiffHunks`/`snapToCommentableLine`/`SNAP_MAX_DISTANCE`, Task 5 포트, Task 6 `createReviewComment`
- Produces:
  - `PublishOutcome`, `SweepPullRequestResult` (domain 타입 파일)
  - `isRepoAllowed(repo, allowlistRaw): boolean`
  - `planPublication({ findings, max }): PublishPlan`
  - `PublishFindingsService.publish(input): Promise<PublishOutcome>`
  - Task 8(포맷터)·Task 9(usecase) 가 소비한다.

- [ ] **Step 0: 결과 타입을 domain 에 먼저 만든다**

`PublishOutcome` 을 서비스 파일에 두면 안 된다. Slack 포맷터(Task 8)가 그것을 import 하고, usecase(Task 9)가 다시 포맷터의 `SweepPullRequestResult` 를 import 하게 되어 `application ↔ slack/format` 순환 의존이 생긴다. 두 타입을 domain 에 두면 양쪽이 domain 만 바라본다.

`src/pr-review-loop/domain/publish-outcome.type.ts`:

```ts
// 게시 결과 집계. 각 카드가 어떤 경로로 처리됐는지 센다.
export interface PublishOutcome {
  inline: number; // 줄 단위 인라인 게시 성공
  file: number; // 줄 앵커 실패 → 파일 단위 강등
  issueComment: number; // 인라인·파일 모두 실패 → 일반 코멘트 묶음
  dryRun: number; // 연습 모드 (게시 안 함)
  notPosted: number; // allowlist 밖 또는 모든 경로 실패
  dropped: number; // 게시 상한 초과
  duplicate: number; // 지문 중복 (이미 있는 카드)
}

// 스윕이 처리한 PR 1건의 결과. Slack 요약(포맷터)과 usecase 가 공유한다.
export interface SweepPullRequestResult {
  prRef: string; // "owner/repo#number"
  riskLevel: string;
  outcome: PublishOutcome;
}
```

- [ ] **Step 1: 정책 테스트 작성**

`src/pr-review-loop/domain/publish-policy.spec.ts`:

```ts
import { ReviewFinding } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { isRepoAllowed, planPublication } from './publish-policy';

const finding = (
  severity: ReviewFinding['severity'],
  body: string,
): ReviewFinding => ({ category: 'STYLE', severity, body });

describe('isRepoAllowed', () => {
  it('allowlist 에 있으면 허용', () => {
    expect(
      isRepoAllowed('JSL107/personal_agents', 'JSL107/personal_agents,a/b'),
    ).toBe(true);
  });

  it('공백이 섞여도 매칭한다', () => {
    expect(
      isRepoAllowed('JSL107/personal_agents', ' a/b , JSL107/personal_agents '),
    ).toBe(true);
  });

  it('allowlist 밖이면 거부', () => {
    expect(isRepoAllowed('other/repo', 'JSL107/personal_agents')).toBe(false);
  });

  it('allowlist 미설정이면 거부 — 게시는 명시적 옵트인만', () => {
    expect(isRepoAllowed('JSL107/personal_agents', undefined)).toBe(false);
    expect(isRepoAllowed('JSL107/personal_agents', '')).toBe(false);
    expect(isRepoAllowed('JSL107/personal_agents', '   ')).toBe(false);
  });
});

describe('planPublication', () => {
  it('MUST_FIX → MISSING_TEST → NICE_TO_HAVE 순으로 정렬한다', () => {
    const plan = planPublication({
      findings: [
        finding('NICE_TO_HAVE', 'n'),
        finding('MUST_FIX', 'm'),
        finding('MISSING_TEST', 't'),
      ],
      max: 3,
    });

    expect(plan.toPost.map((item) => item.body)).toEqual(['m', 't', 'n']);
    expect(plan.dropped).toEqual([]);
  });

  it('상한을 넘으면 뒤쪽을 dropped 로 분리한다', () => {
    const plan = planPublication({
      findings: [
        finding('NICE_TO_HAVE', 'n1'),
        finding('MUST_FIX', 'm1'),
        finding('NICE_TO_HAVE', 'n2'),
      ],
      max: 2,
    });

    expect(plan.toPost.map((item) => item.body)).toEqual(['m1', 'n1']);
    expect(plan.dropped.map((item) => item.body)).toEqual(['n2']);
  });

  it('같은 심각도 안에서는 입력 순서를 지킨다', () => {
    const plan = planPublication({
      findings: [finding('MUST_FIX', 'a'), finding('MUST_FIX', 'b')],
      max: 2,
    });

    expect(plan.toPost.map((item) => item.body)).toEqual(['a', 'b']);
  });

  it('max 가 0 이면 전부 dropped', () => {
    const plan = planPublication({
      findings: [finding('MUST_FIX', 'a')],
      max: 0,
    });

    expect(plan.toPost).toEqual([]);
    expect(plan.dropped).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm exec jest src/pr-review-loop/domain/publish-policy.spec.ts
```

Expected: FAIL — `Cannot find module './publish-policy'`.

- [ ] **Step 3: 정책 구현**

`src/pr-review-loop/domain/publish-policy.ts`:

```ts
import {
  FindingSeverity,
  ReviewFinding,
} from '../../agent/code-reviewer/domain/code-reviewer.type';

// 게시 우선순위 — 상한에 걸릴 때 무엇을 살릴지 결정한다.
const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  MUST_FIX: 0,
  MISSING_TEST: 1,
  NICE_TO_HAVE: 2,
};

export interface PublishPlan {
  toPost: ReviewFinding[];
  dropped: ReviewFinding[];
}

export interface PlanPublicationInput {
  findings: ReviewFinding[];
  max: number;
}

// 게시 허용 레포 판정. 미설정이면 거부 — 게시는 외부에 보이는 행위라 명시적 옵트인만 인정한다.
// (issue 자동 라벨링의 allowlist 는 "미설정 = 전체 허용"이지만, 코멘트 게시는 반대로 잠근다.)
export const isRepoAllowed = (
  repo: string,
  allowlistRaw: string | undefined,
): boolean => {
  if (allowlistRaw === undefined || allowlistRaw.trim().length === 0) {
    return false;
  }
  const allowed = allowlistRaw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return allowed.includes(repo);
};

// 심각도 우선 정렬 후 상한으로 자른다. 같은 심각도 안에서는 모델이 낸 순서를 지킨다.
export const planPublication = ({
  findings,
  max,
}: PlanPublicationInput): PublishPlan => {
  const sorted = findings
    .map((finding, index) => ({ finding, index }))
    .sort((left, right) => {
      const bySeverity =
        SEVERITY_ORDER[left.finding.severity] -
        SEVERITY_ORDER[right.finding.severity];
      if (bySeverity !== 0) {
        return bySeverity;
      }
      return left.index - right.index;
    })
    .map((item) => item.finding);

  return { toPost: sorted.slice(0, max), dropped: sorted.slice(max) };
};
```

- [ ] **Step 4: 정책 테스트 통과 확인**

```bash
pnpm exec jest src/pr-review-loop/domain/publish-policy.spec.ts
```

Expected: PASS (8건).

- [ ] **Step 5: 게시 서비스 테스트 작성**

`src/pr-review-loop/application/publish-findings.service.spec.ts`:

```ts
import { ReviewFinding } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { PrReviewFindingRepositoryPort } from '../domain/port/pr-review-finding.repository.port';
import { PublishFindingsService } from './publish-findings.service';

const DIFF = `--- a/src/foo.service.ts
+++ b/src/foo.service.ts
@@ -10,3 +10,5 @@
+  const b = 2;
`;

const finding = (overrides: Partial<ReviewFinding> = {}): ReviewFinding => ({
  category: 'RELIABILITY',
  severity: 'MUST_FIX',
  file: 'src/foo.service.ts',
  line: 12,
  body: '트랜잭션 밖에서 저장한다',
  ...overrides,
});

const buildGithub = () =>
  ({
    createReviewComment: jest.fn(),
    addIssueComment: jest.fn(),
  }) as unknown as jest.Mocked<
    Pick<GithubClientPort, 'createReviewComment' | 'addIssueComment'>
  >;

const buildRepository = () =>
  ({
    createIfAbsent: jest.fn(),
    hasAnyForPullRequest: jest.fn(),
    markPosted: jest.fn(),
  }) as unknown as jest.Mocked<PrReviewFindingRepositoryPort>;

const baseInput = (findings: ReviewFinding[]) => ({
  agentRunId: 7,
  repo: 'JSL107/personal_agents',
  pullNumber: 180,
  headSha: 'abc1234',
  diff: DIFF,
  findings,
  max: 4,
  dryRun: false,
  allowlistRaw: 'JSL107/personal_agents',
});

describe('PublishFindingsService', () => {
  let github: ReturnType<typeof buildGithub>;
  let repository: ReturnType<typeof buildRepository>;
  let service: PublishFindingsService;

  beforeEach(() => {
    github = buildGithub();
    repository = buildRepository();
    repository.createIfAbsent.mockImplementation(async (input) => ({
      id: 1,
      agentRunId: input.agentRunId,
      repo: input.repo,
      pullNumber: input.pullNumber,
      headSha: input.headSha,
      category: input.category,
      severity: input.severity,
      filePath: input.filePath,
      line: input.line,
      body: input.body,
      fingerprint: input.fingerprint,
      status: 'OPEN',
      postMode: input.postMode,
      githubCommentId: null,
      createdAt: new Date(),
    }));
    service = new PublishFindingsService(
      github as unknown as GithubClientPort,
      repository,
    );
  });

  it('diff 범위 안의 줄은 인라인으로 게시한다', async () => {
    github.createReviewComment.mockResolvedValue({
      commentId: '555',
      nodeId: 'PRRC_a',
    });

    const outcome = await service.publish(baseInput([finding()]));

    expect(github.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ line: 12, filePath: 'src/foo.service.ts' }),
    );
    expect(outcome.inline).toBe(1);
    expect(repository.markPosted).toHaveBeenCalledWith({
      id: 1,
      postMode: 'INLINE',
      githubCommentId: '555',
      githubThreadNodeId: 'PRRC_a',
    });
  });

  it('diff 범위 밖 줄은 가까운 줄로 스냅해 게시한다', async () => {
    github.createReviewComment.mockResolvedValue({
      commentId: '556',
      nodeId: 'PRRC_b',
    });

    await service.publish(baseInput([finding({ line: 16 })]));

    expect(github.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ line: 14 }),
    );
  });

  it('스냅이 불가능하면 파일 단위로 강등한다', async () => {
    github.createReviewComment.mockResolvedValue({
      commentId: '557',
      nodeId: 'PRRC_c',
    });

    const outcome = await service.publish(baseInput([finding({ line: 900 })]));

    expect(github.createReviewComment).toHaveBeenCalledWith(
      expect.objectContaining({ line: null }),
    );
    expect(outcome.file).toBe(1);
  });

  it('인라인·파일 게시가 모두 실패하면 남은 카드를 일반 코멘트로 묶어 올린다', async () => {
    github.createReviewComment.mockRejectedValue(new Error('422'));
    github.addIssueComment.mockResolvedValue(undefined);

    const outcome = await service.publish(baseInput([finding()]));

    expect(github.addIssueComment).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'JSL107/personal_agents', number: 180 }),
    );
    expect(outcome.issueComment).toBe(1);
    expect(repository.markPosted).toHaveBeenCalledWith(
      expect.objectContaining({ postMode: 'ISSUE_COMMENT' }),
    );
  });

  it('파일 정보가 없는 카드는 곧바로 일반 코멘트로 간다', async () => {
    github.addIssueComment.mockResolvedValue(undefined);

    const outcome = await service.publish(
      baseInput([finding({ file: undefined, line: undefined })]),
    );

    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(outcome.issueComment).toBe(1);
  });

  it('연습 모드에서는 GitHub 을 호출하지 않고 DRY_RUN 으로 기록한다', async () => {
    const outcome = await service.publish({
      ...baseInput([finding()]),
      dryRun: true,
    });

    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(github.addIssueComment).not.toHaveBeenCalled();
    expect(repository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ postMode: 'DRY_RUN' }),
    );
    expect(outcome.dryRun).toBe(1);
  });

  it('allowlist 밖 레포는 게시하지 않고 NOT_POSTED 로 기록한다', async () => {
    const outcome = await service.publish({
      ...baseInput([finding()]),
      allowlistRaw: 'other/repo',
    });

    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(repository.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ postMode: 'NOT_POSTED' }),
    );
    expect(outcome.notPosted).toBe(1);
  });

  it('상한을 넘은 카드는 NOT_POSTED 로 저장하고 dropped 로 센다', async () => {
    github.createReviewComment.mockResolvedValue({
      commentId: '558',
      nodeId: 'PRRC_d',
    });

    const outcome = await service.publish({
      ...baseInput([
        finding({ body: 'a' }),
        finding({ body: 'b', severity: 'NICE_TO_HAVE' }),
      ]),
      max: 1,
    });

    expect(outcome.inline).toBe(1);
    expect(outcome.dropped).toBe(1);
  });

  it('지문이 이미 있으면(null) 게시하지 않는다', async () => {
    repository.createIfAbsent.mockResolvedValue(null);

    const outcome = await service.publish(baseInput([finding()]));

    expect(github.createReviewComment).not.toHaveBeenCalled();
    expect(outcome.duplicate).toBe(1);
  });
});
```

- [ ] **Step 6: 테스트 실패 확인**

```bash
pnpm exec jest src/pr-review-loop/application/publish-findings.service.spec.ts
```

Expected: FAIL — `Cannot find module './publish-findings.service'`.

- [ ] **Step 7: 서비스 구현**

`src/pr-review-loop/application/publish-findings.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';

import { ReviewFinding } from '../../agent/code-reviewer/domain/code-reviewer.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import {
  FileHunkRanges,
  parseDiffHunks,
  SNAP_MAX_DISTANCE,
  snapToCommentableLine,
} from '../domain/diff-hunk.parser';
import { buildFindingFingerprint } from '../domain/finding-fingerprint';
import {
  PR_REVIEW_FINDING_REPOSITORY_PORT,
  PrReviewFindingRepositoryPort,
} from '../domain/port/pr-review-finding.repository.port';
import {
  CreateFindingInput,
  FindingPostMode,
  PrReviewFindingRecord,
} from '../domain/pr-review-finding.type';
import { PublishOutcome } from '../domain/publish-outcome.type';
import { isRepoAllowed, planPublication } from '../domain/publish-policy';

const AGENT_TYPE = 'CODE_REVIEWER';

export interface PublishFindingsInput {
  agentRunId: number;
  repo: string;
  pullNumber: number;
  headSha: string;
  diff: string;
  findings: ReviewFinding[];
  max: number;
  dryRun: boolean;
  allowlistRaw: string | undefined;
}

@Injectable()
export class PublishFindingsService {
  private readonly logger = new Logger(PublishFindingsService.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    @Inject(PR_REVIEW_FINDING_REPOSITORY_PORT)
    private readonly repository: PrReviewFindingRepositoryPort,
  ) {}

  async publish(input: PublishFindingsInput): Promise<PublishOutcome> {
    const outcome: PublishOutcome = {
      inline: 0,
      file: 0,
      issueComment: 0,
      dryRun: 0,
      notPosted: 0,
      dropped: 0,
      duplicate: 0,
    };
    const plan = planPublication({
      findings: input.findings,
      max: input.max,
    });
    const canPost =
      !input.dryRun && isRepoAllowed(input.repo, input.allowlistRaw);
    const hunks = parseDiffHunks(input.diff);
    const fallback: { record: PrReviewFindingRecord; body: string }[] = [];

    for (const finding of plan.toPost) {
      const record = await this.createCard({
        input,
        finding,
        // 게시 성공 시 markPosted 가 INLINE/FILE/ISSUE_COMMENT 로 갱신한다.
        postMode: input.dryRun ? 'DRY_RUN' : 'NOT_POSTED',
      });
      if (record === null) {
        outcome.duplicate += 1;
        continue;
      }
      if (input.dryRun) {
        outcome.dryRun += 1;
        continue;
      }
      if (!canPost) {
        outcome.notPosted += 1;
        continue;
      }
      await this.postWithFallback({ input, finding, record, hunks, outcome, fallback });
    }

    for (const finding of plan.dropped) {
      const record = await this.createCard({
        input,
        finding,
        postMode: 'NOT_POSTED',
      });
      if (record === null) {
        outcome.duplicate += 1;
        continue;
      }
      outcome.dropped += 1;
    }

    if (fallback.length > 0) {
      await this.postGroupedComment({ input, fallback, outcome });
    }

    return outcome;
  }

  private async createCard({
    input,
    finding,
    postMode,
  }: {
    input: PublishFindingsInput;
    finding: ReviewFinding;
    postMode: FindingPostMode;
  }): Promise<PrReviewFindingRecord | null> {
    const filePath = finding.file ?? null;
    const createInput: CreateFindingInput = {
      agentRunId: input.agentRunId,
      agentType: AGENT_TYPE,
      repo: input.repo,
      pullNumber: input.pullNumber,
      headSha: input.headSha,
      category: finding.category,
      severity: finding.severity,
      filePath,
      line: finding.line ?? null,
      body: finding.body,
      fingerprint: buildFindingFingerprint({
        repo: input.repo,
        pullNumber: input.pullNumber,
        filePath,
        body: finding.body,
      }),
      postMode,
    };
    return this.repository.createIfAbsent(createInput);
  }

  // 1) 줄 단위 → 2) 파일 단위 → 3) 일반 코멘트 묶음. 지적이 조용히 유실되지 않게 한다.
  private async postWithFallback({
    input,
    finding,
    record,
    hunks,
    outcome,
    fallback,
  }: {
    input: PublishFindingsInput;
    finding: ReviewFinding;
    record: PrReviewFindingRecord;
    hunks: FileHunkRanges[];
    outcome: PublishOutcome;
    fallback: { record: PrReviewFindingRecord; body: string }[];
  }): Promise<void> {
    const filePath = finding.file;
    if (filePath === undefined) {
      fallback.push({ record, body: finding.body });
      return;
    }

    const snapped =
      finding.line === undefined
        ? null
        : snapToCommentableLine({
            hunks,
            filePath,
            line: finding.line,
            maxDistance: SNAP_MAX_DISTANCE,
          });

    try {
      const posted = await this.githubClient.createReviewComment({
        repo: input.repo,
        pullNumber: input.pullNumber,
        commitSha: input.headSha,
        filePath,
        line: snapped,
        body: finding.body,
      });
      await this.repository.markPosted({
        id: record.id,
        postMode: snapped === null ? 'FILE' : 'INLINE',
        githubCommentId: posted.commentId,
        githubThreadNodeId: posted.nodeId,
      });
      if (snapped === null) {
        outcome.file += 1;
        return;
      }
      outcome.inline += 1;
    } catch (error: unknown) {
      this.logger.warn(
        `인라인 게시 실패, 일반 코멘트로 강등 (${filePath}:${snapped ?? 'file'}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      fallback.push({ record, body: finding.body });
    }
  }

  private async postGroupedComment({
    input,
    fallback,
    outcome,
  }: {
    input: PublishFindingsInput;
    fallback: { record: PrReviewFindingRecord; body: string }[];
    outcome: PublishOutcome;
  }): Promise<void> {
    const lines = [
      '이대리 리뷰 — 줄 앵커를 찾지 못해 묶어서 남깁니다.',
      '',
      ...fallback.map((item) => `- ${item.body}`),
    ];
    try {
      await this.githubClient.addIssueComment({
        repo: input.repo,
        number: input.pullNumber,
        body: lines.join('\n'),
      });
      for (const item of fallback) {
        await this.repository.markPosted({
          id: item.record.id,
          postMode: 'ISSUE_COMMENT',
          githubCommentId: null,
          githubThreadNodeId: null,
        });
        outcome.issueComment += 1;
      }
    } catch (error: unknown) {
      this.logger.error(
        `일반 코멘트 강등까지 실패 — 카드는 NOT_POSTED 로 남는다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      outcome.notPosted += fallback.length;
    }
  }
}
```

- [ ] **Step 8: 테스트 통과 확인**

```bash
pnpm exec jest src/pr-review-loop/application/publish-findings.service.spec.ts
```

Expected: PASS (9건). 실패하면 mock 반환값과 구현의 호출 인자를 대조해 맞춘다.

- [ ] **Step 9: 커밋**

```bash
pnpm lint:check
git add src/pr-review-loop
git commit -m "feat(pr-review-loop): 게시 정책 + 3단 폴백 게시 서비스"
```

---

### Task 8: Slack 요약 포맷터

**Files:**
- Create: `src/slack/format/pr-review-sweep.formatter.ts`
- Test: `src/slack/format/pr-review-sweep.formatter.spec.ts`

**Interfaces:**
- Consumes: Task 7 Step 0 의 `PublishOutcome`·`SweepPullRequestResult` (**`src/pr-review-loop/domain/publish-outcome.type.ts` 에서 import** — 서비스 파일에서 가져오면 순환 의존이 된다)
- Produces: `formatPrReviewSweep({ results }): string` — Task 10 의 autopilot task 가 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { formatPrReviewSweep } from './pr-review-sweep.formatter';

const outcome = (overrides = {}) => ({
  inline: 0,
  file: 0,
  issueComment: 0,
  dryRun: 0,
  notPosted: 0,
  dropped: 0,
  duplicate: 0,
  ...overrides,
});

describe('formatPrReviewSweep', () => {
  it('PR 별 게시 결과를 한 줄씩 렌더한다', () => {
    const text = formatPrReviewSweep({
      results: [
        {
          prRef: 'JSL107/personal_agents#180',
          riskLevel: 'high',
          outcome: outcome({ inline: 3, dropped: 1 }),
        },
      ],
    });

    expect(text).toContain('JSL107/personal_agents#180');
    expect(text).toContain('🔴');
    expect(text).toContain('인라인 3');
    expect(text).toContain('상한 초과 1');
  });

  it('연습 모드 건수는 별도로 표기한다', () => {
    const text = formatPrReviewSweep({
      results: [
        {
          prRef: 'a/b#1',
          riskLevel: 'low',
          outcome: outcome({ dryRun: 2 }),
        },
      ],
    });

    expect(text).toContain('연습 2');
  });

  it('강등 건수를 표기한다', () => {
    const text = formatPrReviewSweep({
      results: [
        {
          prRef: 'a/b#1',
          riskLevel: 'medium',
          outcome: outcome({ file: 1, issueComment: 2 }),
        },
      ],
    });

    expect(text).toContain('파일 1');
    expect(text).toContain('묶음 2');
  });

  it('결과가 없으면 빈 문자열', () => {
    expect(formatPrReviewSweep({ results: [] })).toBe('');
  });

  it('본문에 Slack 제어문자가 있어도 escape 한다', () => {
    const text = formatPrReviewSweep({
      results: [
        {
          prRef: 'a/b#1 <script>',
          riskLevel: 'low',
          outcome: outcome({ inline: 1 }),
        },
      ],
    });

    expect(text).not.toContain('<script>');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm exec jest src/slack/format/pr-review-sweep.formatter.spec.ts
```

Expected: FAIL — `Cannot find module './pr-review-sweep.formatter'`.

- [ ] **Step 3: 구현**

```ts
import {
  PublishOutcome,
  SweepPullRequestResult,
} from '../../pr-review-loop/domain/publish-outcome.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

const RISK_ICON: Record<string, string> = {
  low: '🟢',
  medium: '🟡',
  high: '🔴',
};

export interface FormatPrReviewSweepInput {
  results: SweepPullRequestResult[];
}

const COUNT_LABELS: { key: keyof PublishOutcome; label: string }[] = [
  { key: 'inline', label: '인라인' },
  { key: 'file', label: '파일' },
  { key: 'issueComment', label: '묶음' },
  { key: 'dryRun', label: '연습' },
  { key: 'notPosted', label: '미게시' },
  { key: 'dropped', label: '상한 초과' },
  { key: 'duplicate', label: '중복' },
];

// 스윕 결과 요약. 게시할 게 없으면 빈 문자열 — 호출자가 skip 처리한다.
export const formatPrReviewSweep = ({
  results,
}: FormatPrReviewSweepInput): string => {
  if (results.length === 0) {
    return '';
  }
  const lines = ['*🤖 PR 리뷰 스윕*'];
  for (const result of results) {
    const icon = RISK_ICON[result.riskLevel] ?? '⚪';
    const counts = COUNT_LABELS.filter(
      ({ key }) => result.outcome[key] > 0,
    ).map(({ key, label }) => `${label} ${result.outcome[key]}`);
    lines.push(
      `${icon} \`${escapeSlackMrkdwn(result.prRef)}\` — ${counts.join(' · ')}`,
    );
  }
  return lines.join('\n');
};
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/slack/format/pr-review-sweep.formatter.spec.ts
```

Expected: PASS (5건).

- [ ] **Step 5: 커밋**

```bash
pnpm lint:check
git add src/slack/format/pr-review-sweep.formatter.ts src/slack/format/pr-review-sweep.formatter.spec.ts
git commit -m "feat(slack): PR 리뷰 스윕 요약 포맷터"
```

---

### Task 9: 스윕 usecase

**Files:**
- Create: `src/pr-review-loop/application/sweep-pr-reviews.usecase.ts`
- Test: `src/pr-review-loop/application/sweep-pr-reviews.usecase.spec.ts`
- Modify: `src/agent-run/domain/agent-run.type.ts` (`TriggerType.PR_REVIEW_SWEEP`)

**Interfaces:**
- Consumes: `ReviewPullRequestUsecase.execute`, `GithubClientPort.listAuthorOpenPullRequests`/`getPullRequest`/`getPullRequestDiff`, Task 5 포트, Task 7 서비스 + `SweepPullRequestResult`(domain 타입 파일에서 import)
- Produces: `SweepPrReviewsUsecase.execute(): Promise<SweepPullRequestResult[]>` — Task 10 의 autopilot task 가 호출한다.

열린 PR 조회는 **기존 `listAuthorOpenPullRequests` 를 재사용**한다(신규 GitHub 메서드 없음). `headSha` 는 `getPullRequest` 로 얻는다.

- [ ] **Step 1: TriggerType 추가**

`src/agent-run/domain/agent-run.type.ts` 의 `TriggerType` enum 에 추가한다.

```ts
  // PR 리뷰 루프 — cron 스윕이 발사한 리뷰. 수동 /review-pr(SLACK_COMMAND_REVIEW_PR),
  // webhook(WEBHOOK) 과 구분해 집계·감사한다.
  PR_REVIEW_SWEEP = 'PR_REVIEW_SWEEP',
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
import { ConfigService } from '@nestjs/config';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { PrReviewFindingRepositoryPort } from '../domain/port/pr-review-finding.repository.port';
import { PublishFindingsService } from './publish-findings.service';
import { SweepPrReviewsUsecase } from './sweep-pr-reviews.usecase';

const OPEN_PR = {
  number: 180,
  title: 'feat: 무언가',
  body: '',
  repo: 'JSL107/personal_agents',
  url: 'https://github.com/JSL107/personal_agents/pull/180',
  state: 'open' as const,
  mergedAt: null,
  updatedAt: '2026-07-31T00:00:00Z',
  additions: 10,
  deletions: 2,
  changedFilesCount: 1,
};

const REVIEW_OUTCOME = {
  agentRunId: 7,
  result: {
    summary: '요약',
    riskLevel: 'high' as const,
    mustFix: ['m'],
    niceToHave: [],
    missingTests: [],
    reviewCommentDrafts: [],
    approvalRecommendation: 'request_changes' as const,
    findings: [
      {
        category: 'RELIABILITY' as const,
        severity: 'MUST_FIX' as const,
        file: 'src/foo.service.ts',
        line: 12,
        body: '트랜잭션 밖에서 저장한다',
      },
    ],
  },
};

const buildConfig = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('SweepPrReviewsUsecase', () => {
  let github: jest.Mocked<
    Pick<
      GithubClientPort,
      'listAuthorOpenPullRequests' | 'getPullRequest' | 'getPullRequestDiff'
    >
  >;
  let reviewUsecase: jest.Mocked<Pick<ReviewPullRequestUsecase, 'execute'>>;
  let repository: jest.Mocked<PrReviewFindingRepositoryPort>;
  let publishService: jest.Mocked<Pick<PublishFindingsService, 'publish'>>;

  const buildUsecase = (values: Record<string, string | undefined>) =>
    new SweepPrReviewsUsecase(
      github as unknown as GithubClientPort,
      reviewUsecase as unknown as ReviewPullRequestUsecase,
      repository,
      publishService as unknown as PublishFindingsService,
      buildConfig(values),
    );

  const ENABLED = {
    PR_REVIEW_LOOP_ENABLED: 'true',
    PR_REVIEW_INLINE_REPOS: 'JSL107/personal_agents',
    PR_REVIEW_INLINE_DRYRUN: 'true',
    PR_REVIEW_INLINE_MAX: '4',
    GITHUB_WEBHOOK_OWNER_LOGIN: 'JSL107',
    AUTOPILOT_OWNER_SLACK_USER_ID: 'U123',
  };

  beforeEach(() => {
    github = {
      listAuthorOpenPullRequests: jest.fn().mockResolvedValue([OPEN_PR]),
      getPullRequest: jest.fn().mockResolvedValue({
        number: 180,
        title: 'feat: 무언가',
        body: '',
        repo: 'JSL107/personal_agents',
        url: OPEN_PR.url,
        baseRef: 'main',
        headRef: 'feat/x',
        headSha: 'abc1234',
        authorLogin: 'JSL107',
        changedFiles: ['src/foo.service.ts'],
        changedFilesTruncated: false,
        changedFilesTotalCount: 1,
        additions: 10,
        deletions: 2,
      }),
      getPullRequestDiff: jest
        .fn()
        .mockResolvedValue({ diff: 'diff', truncated: false, bytes: 4 }),
    } as never;
    reviewUsecase = { execute: jest.fn().mockResolvedValue(REVIEW_OUTCOME) };
    repository = {
      createIfAbsent: jest.fn(),
      hasAnyForPullRequest: jest.fn().mockResolvedValue(false),
      markPosted: jest.fn(),
    } as never;
    publishService = {
      publish: jest.fn().mockResolvedValue({
        inline: 0,
        file: 0,
        issueComment: 0,
        dryRun: 1,
        notPosted: 0,
        dropped: 0,
        duplicate: 0,
      }),
    };
  });

  it('마스터 스위치가 꺼져 있으면 아무것도 하지 않는다', async () => {
    const results = await buildUsecase({
      ...ENABLED,
      PR_REVIEW_LOOP_ENABLED: 'false',
    }).execute();

    expect(results).toEqual([]);
    expect(github.listAuthorOpenPullRequests).not.toHaveBeenCalled();
  });

  it('owner login 이 없으면 아무것도 하지 않는다', async () => {
    const results = await buildUsecase({
      ...ENABLED,
      GITHUB_WEBHOOK_OWNER_LOGIN: undefined,
    }).execute();

    expect(results).toEqual([]);
  });

  it('allowlist 레포의 열린 PR 을 리뷰하고 게시 서비스에 넘긴다', async () => {
    const results = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        prRef: 'JSL107/personal_agents#180',
        triggerType: 'PR_REVIEW_SWEEP',
      }),
    );
    expect(publishService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRunId: 7,
        headSha: 'abc1234',
        dryRun: true,
        max: 4,
      }),
    );
    expect(results).toEqual([
      expect.objectContaining({
        prRef: 'JSL107/personal_agents#180',
        riskLevel: 'high',
      }),
    ]);
  });

  it('이미 카드가 있는 PR 은 다시 리뷰하지 않는다 — PR 당 리뷰 1회', async () => {
    repository.hasAnyForPullRequest.mockResolvedValue(true);

    const results = await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('스윕 1회의 신규 리뷰는 상한(5건)까지만', async () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...OPEN_PR,
      number: 200 + index,
    }));
    github.listAuthorOpenPullRequests.mockResolvedValue(many);

    await buildUsecase(ENABLED).execute();

    expect(reviewUsecase.execute).toHaveBeenCalledTimes(5);
  });

  it('한 PR 의 실패가 다른 PR 을 막지 않는다', async () => {
    github.listAuthorOpenPullRequests.mockResolvedValue([
      OPEN_PR,
      { ...OPEN_PR, number: 181 },
    ]);
    reviewUsecase.execute
      .mockRejectedValueOnce(new Error('모델 호출 실패'))
      .mockResolvedValueOnce(REVIEW_OUTCOME);

    const results = await buildUsecase(ENABLED).execute();

    expect(results).toHaveLength(1);
  });

  it('findings 가 비어 있으면 게시 서비스를 호출하지 않는다', async () => {
    reviewUsecase.execute.mockResolvedValue({
      ...REVIEW_OUTCOME,
      result: { ...REVIEW_OUTCOME.result, findings: [] },
    });

    const results = await buildUsecase(ENABLED).execute();

    expect(publishService.publish).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('DRYRUN 이 false 면 실게시 모드로 넘긴다', async () => {
    await buildUsecase({
      ...ENABLED,
      PR_REVIEW_INLINE_DRYRUN: 'false',
    }).execute();

    expect(publishService.publish).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false }),
    );
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
pnpm exec jest src/pr-review-loop/application/sweep-pr-reviews.usecase.spec.ts
```

Expected: FAIL — `Cannot find module './sweep-pr-reviews.usecase'`.

- [ ] **Step 4: 구현**

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import {
  PR_REVIEW_FINDING_REPOSITORY_PORT,
  PrReviewFindingRepositoryPort,
} from '../domain/port/pr-review-finding.repository.port';
import { SweepPullRequestResult } from '../domain/publish-outcome.type';
import { PublishFindingsService } from './publish-findings.service';

// 스윕 1회에 새로 리뷰할 PR 최대 개수. LLM 호출 폭주를 막는 상한.
const NEW_REVIEW_LIMIT_PER_SWEEP = 5;
// 열린 PR 조회 기간. 오래 방치된 PR 까지 매번 훑지 않는다.
const OPEN_PR_LOOKBACK_DAYS = 14;
const OPEN_PR_FETCH_LIMIT = 20;
const DEFAULT_INLINE_MAX = 4;

@Injectable()
export class SweepPrReviewsUsecase {
  private readonly logger = new Logger(SweepPrReviewsUsecase.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly reviewPullRequestUsecase: ReviewPullRequestUsecase,
    @Inject(PR_REVIEW_FINDING_REPOSITORY_PORT)
    private readonly repository: PrReviewFindingRepositoryPort,
    private readonly publishService: PublishFindingsService,
    private readonly configService: ConfigService,
  ) {}

  async execute(): Promise<SweepPullRequestResult[]> {
    if (!this.isEnabled()) {
      return [];
    }
    const ownerLogin = this.configService.get<string>(
      'GITHUB_WEBHOOK_OWNER_LOGIN',
    );
    const slackUserId = this.configService.get<string>(
      'AUTOPILOT_OWNER_SLACK_USER_ID',
    );
    if (!ownerLogin || !slackUserId) {
      this.logger.warn(
        'owner login 또는 Slack owner id 미설정 — PR 리뷰 스윕 skip',
      );
      return [];
    }

    const repos = this.allowlistRepos();
    if (repos.length === 0) {
      return [];
    }

    const results: SweepPullRequestResult[] = [];
    let reviewed = 0;

    for (const repo of repos) {
      if (reviewed >= NEW_REVIEW_LIMIT_PER_SWEEP) {
        break;
      }
      const pullRequests = await this.listOpenPullRequests({
        repo,
        ownerLogin,
      });
      for (const pullRequest of pullRequests) {
        if (reviewed >= NEW_REVIEW_LIMIT_PER_SWEEP) {
          break;
        }
        const alreadyReviewed = await this.repository.hasAnyForPullRequest({
          repo: pullRequest.repo,
          pullNumber: pullRequest.number,
        });
        if (alreadyReviewed) {
          continue;
        }
        reviewed += 1;
        const result = await this.reviewAndPublish({
          repo: pullRequest.repo,
          pullNumber: pullRequest.number,
          slackUserId,
        });
        if (result !== null) {
          results.push(result);
        }
      }
    }

    return results;
  }

  private async listOpenPullRequests({
    repo,
    ownerLogin,
  }: {
    repo: string;
    ownerLogin: string;
  }) {
    const since = new Date(
      Date.now() - OPEN_PR_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    try {
      return await this.githubClient.listAuthorOpenPullRequests({
        repo,
        author: ownerLogin,
        sinceIsoDate: since,
        limit: OPEN_PR_FETCH_LIMIT,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `열린 PR 조회 실패 (${repo}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // 한 PR 의 실패가 스윕 전체를 멈추지 않게 격리한다.
  private async reviewAndPublish({
    repo,
    pullNumber,
    slackUserId,
  }: {
    repo: string;
    pullNumber: number;
    slackUserId: string;
  }): Promise<SweepPullRequestResult | null> {
    const prRef = `${repo}#${pullNumber}`;
    try {
      const [detail, diff] = await Promise.all([
        this.githubClient.getPullRequest({ repo, number: pullNumber }),
        this.githubClient.getPullRequestDiff({ repo, number: pullNumber }),
      ]);
      const outcome = await this.reviewPullRequestUsecase.execute({
        prRef,
        slackUserId,
        triggerType: TriggerType.PR_REVIEW_SWEEP,
      });
      if (outcome.result.findings.length === 0) {
        return null;
      }
      const published = await this.publishService.publish({
        agentRunId: outcome.agentRunId,
        repo,
        pullNumber,
        headSha: detail.headSha,
        diff: diff.diff,
        findings: outcome.result.findings,
        max: this.inlineMax(),
        dryRun: this.isDryRun(),
        allowlistRaw: this.configService.get<string>('PR_REVIEW_INLINE_REPOS'),
      });
      return {
        prRef,
        riskLevel: outcome.result.riskLevel,
        outcome: published,
      };
    } catch (error: unknown) {
      this.logger.error(
        `PR 리뷰 스윕 실패 (${prRef}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private isEnabled(): boolean {
    return this.configService.get<string>('PR_REVIEW_LOOP_ENABLED') === 'true';
  }

  // 기본 true — 명시적으로 'false' 일 때만 실게시. 연습 모드가 기본값이다.
  private isDryRun(): boolean {
    return this.configService.get<string>('PR_REVIEW_INLINE_DRYRUN') !== 'false';
  }

  private inlineMax(): number {
    const raw = this.configService.get<string>('PR_REVIEW_INLINE_MAX');
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return DEFAULT_INLINE_MAX;
    }
    return parsed;
  }

  private allowlistRepos(): string[] {
    const raw = this.configService.get<string>('PR_REVIEW_INLINE_REPOS');
    if (!raw) {
      return [];
    }
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}
```

`allowlistRepos` 가 비면 스윕 자체를 안 하는 이유: 게시 대상이 아닌 레포를 리뷰하면 LLM 토큰만 쓰고 결과가 Slack 요약에만 남는다. Phase 1의 목적은 실데이터 축적이므로 게시 가능한 레포에 집중한다.

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm exec jest src/pr-review-loop/application/sweep-pr-reviews.usecase.spec.ts
```

Expected: PASS (9건).

- [ ] **Step 6: 커밋**

```bash
pnpm lint:check
git add src/pr-review-loop src/agent-run/domain/agent-run.type.ts
git commit -m "feat(pr-review-loop): 스윕 usecase — 발사·카드 생성·게시 오케스트레이션"
```

---

### Task 10: autopilot task + playbook + 모듈 배선

**Files:**
- Create: `src/autopilot/infrastructure/tasks/pr-review-sweep.autopilot-task.ts`
- Test: `src/autopilot/infrastructure/tasks/pr-review-sweep.autopilot-task.spec.ts`
- Create: `src/pr-review-loop/pr-review-loop.module.ts`
- Modify: `src/autopilot/domain/autopilot.playbook-defaults.ts`
- Modify: `src/autopilot/domain/autopilot.playbook.ts`
- Modify: `src/autopilot/autopilot.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: Task 9 `SweepPrReviewsUsecase.execute`, Task 8 `formatPrReviewSweep`
- Produces: `PrReviewSweepAutopilotTask` (`id = 'pr-review-sweep'`)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { SweepPrReviewsUsecase } from '../../../pr-review-loop/application/sweep-pr-reviews.usecase';
import { PrReviewSweepAutopilotTask } from './pr-review-sweep.autopilot-task';

const CONTEXT = { ownerSlackUserId: 'U123', firedAtKst: '2026-07-31' };

describe('PrReviewSweepAutopilotTask', () => {
  let usecase: jest.Mocked<Pick<SweepPrReviewsUsecase, 'execute'>>;
  let task: PrReviewSweepAutopilotTask;

  beforeEach(() => {
    usecase = { execute: jest.fn() };
    task = new PrReviewSweepAutopilotTask(
      usecase as unknown as SweepPrReviewsUsecase,
    );
  });

  it('id 는 pr-review-sweep', () => {
    expect(task.id).toBe('pr-review-sweep');
  });

  it('결과가 없으면 skip — 15분마다 빈 알림을 보내지 않는다', async () => {
    usecase.execute.mockResolvedValue([]);

    await expect(task.run(CONTEXT)).resolves.toEqual({ skip: true });
  });

  it('결과가 있으면 요약을 summaryText 로 낸다', async () => {
    usecase.execute.mockResolvedValue([
      {
        prRef: 'JSL107/personal_agents#180',
        riskLevel: 'high',
        outcome: {
          inline: 2,
          file: 0,
          issueComment: 0,
          dryRun: 0,
          notPosted: 0,
          dropped: 0,
          duplicate: 0,
        },
      },
    ]);

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('JSL107/personal_agents#180');
    expect(result.summaryText).toContain('인라인 2');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm exec jest src/autopilot/infrastructure/tasks/pr-review-sweep.autopilot-task.spec.ts
```

Expected: FAIL — `Cannot find module './pr-review-sweep.autopilot-task'`.

- [ ] **Step 3: task 구현**

```ts
import { Injectable } from '@nestjs/common';

import { SweepPrReviewsUsecase } from '../../../pr-review-loop/application/sweep-pr-reviews.usecase';
import { formatPrReviewSweep } from '../../../slack/format/pr-review-sweep.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// PR 리뷰 루프 Phase 1 — 열린 PR 을 찾아 리뷰하고 지적을 카드로 게시한다.
// 15분마다 돌기 때문에 할 일이 없으면 반드시 skip 해 빈 알림을 만들지 않는다.
// enable 판정·allowlist·연습 모드는 usecase 안에 있다(env 단일 소유).
@Injectable()
export class PrReviewSweepAutopilotTask implements AutopilotTask {
  readonly id = 'pr-review-sweep';

  constructor(private readonly sweepUsecase: SweepPrReviewsUsecase) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    const results = await this.sweepUsecase.execute();
    if (results.length === 0) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: formatPrReviewSweep({ results }),
    };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/autopilot/infrastructure/tasks/pr-review-sweep.autopilot-task.spec.ts
```

Expected: PASS (3건).

- [ ] **Step 5: 모듈 작성**

`src/pr-review-loop/pr-review-loop.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { CodeReviewerModule } from '../agent/code-reviewer/code-reviewer.module';
import { GithubModule } from '../github/github.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PublishFindingsService } from './application/publish-findings.service';
import { SweepPrReviewsUsecase } from './application/sweep-pr-reviews.usecase';
import { PR_REVIEW_FINDING_REPOSITORY_PORT } from './domain/port/pr-review-finding.repository.port';
import { PrReviewFindingPrismaRepository } from './infrastructure/pr-review-finding.prisma.repository';

@Module({
  imports: [PrismaModule, GithubModule, CodeReviewerModule],
  providers: [
    PublishFindingsService,
    SweepPrReviewsUsecase,
    {
      provide: PR_REVIEW_FINDING_REPOSITORY_PORT,
      useClass: PrReviewFindingPrismaRepository,
    },
  ],
  exports: [SweepPrReviewsUsecase],
})
export class PrReviewLoopModule {}
```

`CodeReviewerModule` 이 `ReviewPullRequestUsecase` 를 export 하는지 먼저 확인하고, 안 하면 export 에 추가한다.

- [ ] **Step 6: playbook 등록**

`src/autopilot/domain/autopilot.playbook-defaults.ts` 에 추가한다.

```ts
// PR 리뷰 루프 스윕 — 15분 주기. 할 일 없으면 skip 하므로 알림 스팸은 없다.
export const DEFAULT_PR_REVIEW_SWEEP_CRON = '*/15 * * * *';
export const DEFAULT_PR_REVIEW_SWEEP_TIMEZONE = 'Asia/Seoul';
```

`src/autopilot/domain/autopilot.playbook.ts` 의 배열 마지막 항목 뒤에 추가한다(import 도 함께).

```ts
  // PR 리뷰 스윕 — 열린 PR 리뷰 + 지적 카드 게시. T0_AUTO:
  // 게시는 외부 부작용이지만 레포 allowlist + 건수 상한 + 연습 모드 기본값으로 통제한다.
  // PR_REVIEW_LOOP_ENABLED 미설정/false 시 usecase 가 즉시 skip(안전).
  {
    id: 'pr-review-sweep',
    taskId: 'pr-review-sweep',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_PR_REVIEW_SWEEP_CRON,
      timezone: DEFAULT_PR_REVIEW_SWEEP_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
```

- [ ] **Step 7: autopilot 모듈 등록**

`src/autopilot/autopilot.module.ts` 에서:
1. `PrReviewLoopModule` 을 `imports` 에 추가
2. `PrReviewSweepAutopilotTask` 를 `providers` 에 추가
3. `AUTOPILOT_TASKS` `useFactory` 의 파라미터와 반환 배열, `inject` 배열에 각각 추가

```ts
        prReviewSweep: PrReviewSweepAutopilotTask,
```

반환 배열과 `inject` 배열에도 같은 순서로 넣는다. **`useFactory` 파라미터 순서와 `inject` 순서가 어긋나면 런타임에 엉뚱한 프로바이더가 주입된다** — 세 곳을 함께 확인한다.

- [ ] **Step 8: app.module 등록**

`src/app.module.ts` 의 `imports` 에 `PrReviewLoopModule` 을 추가한다.

- [ ] **Step 9: playbook 무결성 + 전체 게이트**

```bash
pnpm exec jest src/autopilot
pnpm lint:check && pnpm test && pnpm build
```

Expected: playbook 검증 테스트(`validatePlaybook`) 통과 + 3중 green. DI 배선 오류는 build 가 아니라 앱 부팅에서 드러나므로, Task 12 의 실증에서 최종 확인한다.

- [ ] **Step 10: 커밋**

```bash
git add src/autopilot src/pr-review-loop src/app.module.ts
git commit -m "feat(pr-review-loop): autopilot pr-review-sweep task 등록 + 모듈 배선"
```

---

### Task 11: env 4곳 동기화

**TDD 없음** — 설정이다. 검증은 `app.config.ts` 의 class-validator 통과(앱 부팅)와 `pnpm docs:check` 로 한다.

**Files:**
- Modify: `src/config/app.config.ts`
- Modify: `.env.example`
- Modify: `.env`
- Modify: `README.md`

스펙 §7의 env 는 5개지만 이번에 만드는 것은 **4개**다. `PR_REVIEW_SUPPRESSION_ENABLED` 는 억제 게이트(Phase 3)에서만 쓰이므로, 지금 선언하면 아무 코드도 읽지 않는 죽은 설정이 된다. Phase 3 에서 추가한다.

- [ ] **Step 1: `app.config.ts` 에 env 4개 선언**

기존 `GITHUB_ISSUE_AUTO_LABEL_ENABLED` 근처 패턴을 그대로 따른다.

```ts
  // PR 리뷰 루프 마스터 스위치. `true` (string) 일 때만 스윕이 동작한다.
  // 미설정/false → autopilot task 가 즉시 skip (기존 동작 그대로).
  @IsOptional()
  @IsString()
  PR_REVIEW_LOOP_ENABLED?: string;

  // 인라인 코멘트 게시를 허용할 repo allowlist (콤마 구분 "owner/repo").
  // 미설정/빈 값 → 게시 안 함 + 스윕 자체 skip. 게시는 외부에 보이는 행위라
  // 명시적 옵트인만 인정한다 (issue 자동 라벨링의 allowlist 와 기본값 방향이 반대).
  @IsOptional()
  @IsString()
  PR_REVIEW_INLINE_REPOS?: string;

  // 연습 모드. `false` (string) 일 때만 실제로 GitHub 에 게시한다.
  // 미설정 시 연습 모드 — 카드는 DRY_RUN 으로 저장되고 Slack 요약만 나간다.
  @IsOptional()
  @IsString()
  PR_REVIEW_INLINE_DRYRUN?: string;

  // PR 당 게시 상한. MUST_FIX 우선 정렬 후 절단. 미설정/비정상 값 → 4.
  @IsOptional()
  @IsString()
  PR_REVIEW_INLINE_MAX?: string;
```

- [ ] **Step 2: `.env.example` 에 추가**

```bash
# PR 리뷰 루프 (Phase 1) — 열린 PR 자동 리뷰 + 지적 카드 GitHub 인라인 게시.
# 전부 기본 OFF. 게시 대상 repo 를 명시하지 않으면 스윕 자체가 돌지 않는다.
PR_REVIEW_LOOP_ENABLED=false
PR_REVIEW_INLINE_REPOS=
PR_REVIEW_INLINE_DRYRUN=true
PR_REVIEW_INLINE_MAX=4
```

- [ ] **Step 3: `.env` 에 같은 4줄 추가**

값도 `.env.example` 과 동일하게 둔다(전부 OFF). 실제 활성화는 Task 12 실증에서 사용자가 결정한다.

- [ ] **Step 4: README env 표에 4행 추가**

기존 env 표의 형식(변수명 · 필수여부 · 설명)을 그대로 따라 4행을 넣는다. 설명에는 "기본 OFF", "allowlist 미설정 시 스윕 skip", "DRYRUN 기본 연습 모드"를 적는다.

- [ ] **Step 5: 문서 동기 검증 + 전체 게이트**

```bash
pnpm docs:check
pnpm lint:check && pnpm test && pnpm build
```

`docs:check` 는 로컬 3중 게이트에 없고 CI(`verify`)에서만 걸리므로 여기서 직접 돌린다.

- [ ] **Step 6: 커밋**

```bash
git add src/config/app.config.ts .env.example README.md
git commit -m "chore(pr-review-loop): env 4개 추가 (전부 기본 OFF)"
```

`.env` 는 커밋하지 않는다(gitignore).

---

### Task 12: 연습 모드 실증

**TDD 없음** — 실제 GitHub·DB를 쓰는 수동 검증이다. 단위 테스트로 재현되지 않는 두 가지(인라인 코멘트 422, PAT 권한)를 여기서 확인한다.

**Files:** 없음 (실행·관찰만)

- [ ] **Step 1: 앱 부팅으로 DI 배선 확인**

```bash
PORT=3099 pnpm start:dev
```

Expected: 부팅 로그에 Nest 주입 에러가 없다. `AUTOPILOT_TASKS` 의 `useFactory`/`inject` 순서가 어긋났다면 여기서 드러난다.

부팅 후 로그에서 `pr-review-sweep` 이 등록됐는지 확인한다.

- [ ] **Step 2: 연습 모드로 스윕 1회 실행**

`.env` 를 임시로 바꾼다.

```
PR_REVIEW_LOOP_ENABLED=true
PR_REVIEW_INLINE_REPOS=JSL107/personal_agents
PR_REVIEW_INLINE_DRYRUN=true
```

재시작 후 최대 15분 안에 스윕이 돈다. cron 을 기다리기 싫으면 `DEFAULT_PR_REVIEW_SWEEP_CRON` 을 임시로 `*/2 * * * *` 로 바꿔 확인하고 원복한다.

Expected:
- Slack DM 에 `🤖 PR 리뷰 스윕` 요약이 오고, 건수가 `연습 N` 으로 표기된다
- DB 확인: 카드가 `DRY_RUN` 으로 쌓였다

```bash
docker exec idaeri-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id, repo, pull_number, category, severity, file_path, line, status, post_mode FROM pr_review_finding ORDER BY id DESC LIMIT 10;"'
```

- [ ] **Step 3: 게시 페이로드 검토**

Slack 요약과 DB 의 `file_path` / `line` 을 실제 PR diff 와 대조한다. 줄 번호가 diff 안에 있는지, 스냅이 엉뚱한 위치로 당기지 않았는지 확인한다.

- [ ] **Step 4: 실게시 1건 확인**

품질이 납득되면 `PR_REVIEW_INLINE_DRYRUN=false` 로 바꾸고 재시작한다.

Expected:
- GitHub PR 에 인라인 코멘트가 달린다
- DB 의 `post_mode` 가 `INLINE`(또는 강등 시 `FILE`/`ISSUE_COMMENT`), `github_comment_id` 와 `github_thread_node_id` 가 채워진다

**PAT 권한이 없으면** 여기서 `인라인 리뷰 코멘트 게시 실패 ... 403` 로그가 뜬다. 그 경우 fine-grained 토큰에 `pull_requests: write` 를 추가하고 재시도한다. 이 실패는 설계 결함이 아니라 예상된 확인 절차다.

- [ ] **Step 5: 관찰 결과 기록**

실증 결과를 스펙 §11(실데이터를 본 뒤 정할 항목)의 근거로 남긴다. 최소한 다음을 적는다.

- 스냅이 발생한 비율, 강등(`FILE`/`ISSUE_COMMENT`) 비율
- PR당 카드 수 분포 — 상한 4가 적절한지
- 리뷰가 붙기까지 걸린 시간 — 15분 주기가 머지 속도를 따라가는지

- [ ] **Step 6: `.env` 원복 여부 결정**

계속 운영하려면 그대로 둔다. 아니면 `PR_REVIEW_LOOP_ENABLED=false` 로 되돌린다. `.env` 는 커밋 대상이 아니므로 git 작업은 없다.

---

## 완료 조건

- [ ] Task 1~11 의 모든 커밋이 브랜치에 있다
- [ ] `pnpm lint:check && pnpm test && pnpm build` 3중 green
- [ ] `pnpm docs:check` 통과
- [ ] Task 12 실증: 연습 모드 카드가 DB에 쌓이고, 실게시 1건이 GitHub에 확인된다
- [ ] 미검증 항목이 남았다면 정직하게 기록한다 (PAT 권한, 422 발생 여부)

## Phase 2 로 넘기는 것

- `compareCommits` GitHub 메서드 (후속 커밋 해소 판정에서만 쓰임)
- `listReviewThreads` / `resolveReviewThread` GraphQL
- 리액션 신호 수집, `STALE` 처리, `REVIEW_RESOLUTION_JUDGE`
- 기각 이유 회수(GitHub 답글 수집 + Slack 버튼·modal)
- `REJECTED` 카드 → episodic 적재

## Phase 3 로 넘기는 것

- `PR_REVIEW_SUPPRESSION_ENABLED` env + 억제 게이트 + 면제 규칙
- 카테고리별 채택률 집계, `PreferenceSection` `'review'`, `ReviewFindingSignalSource`
