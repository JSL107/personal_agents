# 스스로 배우는 코드 리뷰봇 — 설계

2026-07-31 결정 기록. 이 문서는 단일 시점의 설계 계약이며 사후 갱신하지 않는다. 방향이 바뀌면 새 문서를 만든다.

---

## 1. 한 줄 요약

이대리가 열린 PR을 스스로 찾아 리뷰하고, 지적을 **낱개 단위로 GitHub 코드 줄에 붙이고**, 각 지적이 채택됐는지 기각됐는지를 모아, **다음 리뷰에서 취향에 안 맞는 지적을 스스로 줄이는** 순환 구조를 만든다. 처리가 끝난 지적은 GitHub 스레드를 스스로 닫는다.

---

## 2. 배경 — 왜 지금인가

### 2.1 코드로는 절반이 이미 있다

| 조각 | 상태 | 위치 |
|---|---|---|
| PR 리뷰 생성 | 있음 | `src/agent/code-reviewer/application/review-pull-request.usecase.ts` |
| 리뷰 출력 구조 | 있음 (`mustFix` / `niceToHave` / `missingTests` / `reviewCommentDrafts` / `approvalRecommendation`) | `src/agent/code-reviewer/domain/code-reviewer.type.ts` |
| 채택·기각 저장 | 있음 (PR 전체 단위 1비트) | `PrReviewOutcome` 테이블, `save-review-outcome.usecase.ts` |
| 기각 사례를 다음 리뷰에 주입 | 있음 (episodic memory `kind='pr_review'`, e5 임베딩 유사검색 + recency 폴백) | `review-pull-request.usecase.ts:126-179` |
| 선호 프로필 학습 엔진 | 있음 (버전형 프로필, 주간 cron, PreviewGate 승인, 섹션별 프롬프트 주입) | `src/preference-profile/` |
| 자동 발사 배선 | 코드만 있음 (`pull_request.opened` webhook → BullMQ) | `src/webhook/interface/webhook.controller.ts:378-442` |

### 2.2 그런데 런타임 실적은 0이다

2026-07-31 로컬 DB 실측:

| 항목 | 건수 |
|---|---|
| `agent_run` 중 `agent_type='CODE_REVIEWER'` | **0** |
| `pr_review_outcome` (명시 신호) | **0** |
| `episodic_memory` 중 `kind='pr_review'` | **0** (전체 275건은 모두 `kind='agent_run'`) |
| `agent_run` 중 `trigger_type LIKE '%WEBHOOK%'` | **0** |

실행된 것은 전부 cron(`DAILY_EVAL_CRON` 149건, `MORNING_BRIEFING_CRON` 72건, `IMPACT_REPORT_RECENT_CRON` 27건 등)과 Slack 트리거다.

이 수치가 두 가지를 말해준다.

**첫째, GitHub webhook은 이대리 백엔드에 도달한 적이 없다.** 백엔드는 로컬 3099에서 도는데 외부에서 들어올 통로(터널)가 없다. `pull_request.opened → 자동 리뷰` 경로는 코드만 존재하는 미검증 경로다.

**둘째, 신호가 0인 이유는 사용자가 피드백을 게을리해서가 아니라 리뷰 자체가 나간 적이 없어서다.** 따라서 첫 병목은 학습이 아니라 발사다.

### 2.3 이 사실이 설계에 미치는 영향

- 발사 경로를 webhook이 아닌 **cron 폴링**으로 세운다. cron은 이 시스템에서 300건 이상 성공한 유일한 검증된 실행 경로이며, 절전 복귀 대응(`SystemWakeGuard`)도 이미 붙어 있다.
- 채택률 통계 기반 억제는 **표본 0에서 시작**한다. 최소 표본에 도달하기 전에는 억제를 끄고 관찰만 한다. 임계치 수치는 실데이터를 보고 정한다 — 지금 정하면 근거 없는 추측이 된다.

---

## 3. 목표 루프와 성공 기준

```
① 리뷰 발사        열린 PR 감지 → 리뷰 생성 → 지적을 낱개 카드로 영속화
② 게시            카드를 GitHub 인라인 리뷰 코멘트로 붙임 + Slack 요약 알림
③ 신호 수집        👍/👎 리액션 · 후속 커밋 해소 판정 · (선택) 기각 이유
④ 스레드 정리      결론 난 카드의 GitHub 스레드 자동 resolve
⑤ 학습            카테고리별 채택률 집계 → 사례·규칙·억제 3경로로 다음 리뷰에 반영
```

### 성공 기준

| 단계 | "됐다"의 정의 |
|---|---|
| 1 | 사람이 아무 명령을 내리지 않아도 새 PR에 리뷰가 붙는다. 카드가 DB에 남는다. |
| 2 | 카드가 실제 코드 줄에 달린다. 줄 앵커 실패 시 조용히 유실되지 않고 강등 경로로 전달된다. |
| 3 | 리액션 한 번, 또는 그냥 코드를 고치는 것만으로 카드 상태가 바뀐다. 별도 명령 입력이 필요 없다. |
| 4 | 결론 난 스레드가 사람 손 없이 닫힌다. |
| 5 | 채택률이 낮은 카테고리의 저위험 지적이 실제로 줄어든다. **동시에 버그·보안 지적은 채택률과 무관하게 계속 나온다.** |

---

## 4. 확정된 설계 결정

| # | 결정 | 근거 |
|---|---|---|
| 1 | **게시 무대 = GitHub 인라인 + Slack 요약 알림** | 지적이 코드 줄에 붙어야 리액션·후속 커밋·스레드 닫힘이라는 신호가 자연 발생한다. Slack은 사용자가 GitHub를 상시 보지 않으므로 알림 채널로 남긴다. 기존 결정(`code-reviewer.consumer.ts:20`, "PR comment X — Slack thread 중심")을 의도적으로 뒤집는다. |
| 2 | **신호 3층 = 👍/👎 리액션 + 후속 커밋 해소 판정 + 기각 이유 되묻기** | 리액션은 가장 싸고 정확한 명시 신호. 커밋 대조는 사람 손이 전혀 안 드는 암묵 신호이며 자동 resolve의 전제이기도 하다. 기각 이유 텍스트는 학습 재료 중 가치가 가장 높다(현재 `PrReviewOutcome.comment`가 하던 역할). |
| 3 | **학습 반영 3종 = 사례(episodic) + 규칙(선호 프로필 `review` 섹션) + 결정론 억제** | 프롬프트 주입만으로는 행동이 안 바뀔 가능성이 높다. 현행 시스템 프롬프트가 이미 "lint가 잡을 영역은 사람 리뷰 시간 낭비", "niceToHave만 5개 이상이면 톤이 잘못된 것"을 지시하고 있는데도 통제가 보장되지 않는다(`code-reviewer-system.prompt.ts:12-14`). 결정론 게이트가 실효를 담보한다. |
| 4 | **게시 게이트 = 레포 allowlist 자동 게시 + 건수 상한 + 연습 모드** | 매 PR 승인은 루프의 자동화 가치를 반감시키고 사람이 병목이 된다. 대신 allowlist 밖 레포는 기존 동작(Slack만)을 유지해 회귀를 0으로 만들고, 초기에는 연습 모드로 게시 페이로드만 확인한다. |
| 5 | **발사 경로 = cron 폴링 (autopilot playbook task)** | §2.2 참조. webhook 실적 0건, 터널 부재. `run-sweeper`가 `50 * * * *`로 시간당 도는 선례가 있어 고빈도 task가 autopilot에서 이미 검증됐다. |
| 6 | **상태 정본 = DB (`PrReviewFinding`), GitHub는 동기화 대상** | 기각 이유와 채택률 이력은 학습 자산이다. GitHub만 정본으로 두면 PR이 닫히거나 코멘트가 삭제될 때 자산이 사라지고, 통계 조회가 API rate limit에 묶인다. |

---

## 5. 아키텍처

### 5.1 모듈 경계

신규 모듈 `src/pr-review-loop/`가 루프 오케스트레이션을 전담한다. 리뷰 생성(LLM 호출)은 기존 `code-reviewer` 모듈에 그대로 남긴다 — 에이전트의 책임과 워크플로의 책임을 섞으면 두 파일이 함께 비대해진다.

| 모듈 | 책임 | 변경 |
|---|---|---|
| `src/agent/code-reviewer/` | 리뷰 **생성** | 출력 스키마에 카테고리·심각도 추가(§5.2), `getInjectionBlock('review')` `@Optional` 주입 |
| `src/pr-review-loop/` (신규) | 스윕 오케스트레이션, 카드 영속화, 게시, 신호 수집, 상태 전이, 집계, 억제 판정 | 신규 |
| `src/github/` | GitHub 능력 | 포트에 5개 메서드 추가(§5.4). GraphQL 첫 도입 |
| `src/preference-profile/` | 규칙 학습 | `PreferenceSection`에 `'review'` 추가, `ReviewFindingSignalSource` 등록 |
| `src/episodic-memory/` | 사례 학습 | **변경 없음** — 기존 `kind='pr_review'` 경로를 카드 단위로 채운다 |
| `src/autopilot/` | 스케줄 | playbook에 `pr-review-sweep` 1건 추가 |
| `src/slack/` | 알림·이유 입력 | 요약 포맷터 1개, "이유 남기기" 버튼 + modal 핸들러 1개 |

`preference-profile`의 신호 소스는 이미 멀티프로바이더 `useFactory` 패턴이다(`preference-profile.module.ts:31-35`). 따라서 리뷰 신호 소스는 **배선만 추가하면 기존 주간 학습 cron이 자동으로 흡수한다.** 학습용 cron을 새로 만들지 않는다.

### 5.2 리뷰 출력 스키마 변경

현재 지적은 `mustFix: string[]` 형태의 문자열 배열이다. 카테고리가 없으면 카테고리별 채택률을 낼 수 없고, 심각도가 없으면 "버그 지적은 억제 면제"를 판정할 수 없다.

`PullRequestReview`에 단일 배열 `findings`를 추가한다.

```ts
export type FindingCategory =
  | 'CORRECTNESS'    // 정확성·회귀·데이터 유실
  | 'SECURITY'
  | 'RELIABILITY'    // 동시성·트랜잭션·에러 처리·외부 API graceful
  | 'TEST'           // 커버리지 누락
  | 'ARCHITECTURE'   // DDD / Port-Adapter 위반, 의존 방향
  | 'READABILITY'    // 네이밍·가독성·중복
  | 'STYLE'          // 포맷·주석·lint 영역
  | 'UNCLASSIFIED';  // 구버전 응답 호환용

export type FindingSeverity = 'MUST_FIX' | 'NICE_TO_HAVE' | 'MISSING_TEST';

export interface ReviewFinding {
  category: FindingCategory;
  severity: FindingSeverity;
  file?: string;
  line?: number;
  body: string;
}
```

카테고리 목록은 현행 시스템 프롬프트의 6단 우선순위(`code-reviewer-system.prompt.ts:5-14`)와 1:1로 정렬한다. 프롬프트가 이미 이 순서로 사고하도록 지시하고 있으므로 새 분류 체계를 배우게 하는 것이 아니라 이미 하고 있는 판단을 밖으로 드러내게 하는 것이다.

**하위 호환**: 기존 `mustFix` / `niceToHave` / `missingTests`는 필드로 유지한다. 파서는 `findings`가 있으면 그것을 정본으로 쓰고, 없으면 기존 3배열에서 변환해 채운다 — `category='UNCLASSIFIED'`, severity는 배열별로 `mustFix→MUST_FIX`, `niceToHave→NICE_TO_HAVE`, `missingTests→MISSING_TEST`. 파일·줄은 비운다. Slack 포맷터는 그대로 동작한다.

프롬프트에 추가할 지시: **줄 번호는 diff에 나타난 줄만 쓸 것.** 이것만으로 앵커 실패가 사라지지는 않지만(§6.2) 실패율을 낮춘다.

### 5.3 데이터 모델

```prisma
model PrReviewFinding {
  id                 Int      @id @default(autoincrement())
  agentRunId         Int      @map("agent_run_id")
  agentRun           AgentRun @relation(fields: [agentRunId], references: [id], onDelete: Cascade)
  agentType          String   @map("agent_type")   // 'CODE_REVIEWER' — BE_FIX 편입 대비
  repo               String
  pullNumber         Int      @map("pull_number")
  headSha            String   @map("head_sha")     // 리뷰 시점 head — 커밋 대조 기준선
  category           String
  severity           String
  filePath           String?  @map("file_path")
  line               Int?
  body               String   @db.Text
  fingerprint        String   @unique              // 재스윕 중복 게시 차단
  status             String   @default("OPEN")
  githubCommentId    BigInt?  @map("github_comment_id")      // null = 미게시 또는 강등
  githubThreadNodeId String?  @map("github_thread_node_id")  // GraphQL resolve 대상
  postMode           String   @map("post_mode")    // 'INLINE' | 'FILE' | 'ISSUE_COMMENT' | 'NOT_POSTED'
  rejectReason       String?  @db.Text
  decidedAt          DateTime? @map("decided_at")  // ACKED/REJECTED/FIXED 전이 시각
  resolvedAt         DateTime? @map("resolved_at")
  createdAt          DateTime @default(now()) @map("created_at")

  @@index([repo, pullNumber, status])
  @@index([category, severity, status])
  @@map("pr_review_finding")
}
```

`AgentRun`에 역관계 필드 `prReviewFindings PrReviewFinding[]`를 추가한다.

**지문(`fingerprint`)** — 스윕은 반복 실행되므로 같은 지적을 다시 게시할 위험이 있다. `sha256(repo, pullNumber, filePath, 정규화된 body)`를 유일 제약으로 걸어 차단한다. 정규화는 공백 축약 + 소문자화 수준으로 최소화한다. 과하게 정규화하면 다른 지적이 같은 지문으로 뭉개진다.

**기존 `PrReviewOutcome`은 그대로 둔다.** "리뷰 전체에 대한 평가"라는 다른 의미이고, `/review-feedback` 슬래시도 유지한다. 실적이 0건이지만 제거는 이 작업의 범위가 아니다.

### 5.4 상태 기계

```
              ┌─ 👍 리액션 ─────────────→ ACKED ────┐
게시됨 OPEN ──┼─ 👎 리액션 ─────────────→ REJECTED ─┼─→ RESOLVED
              ├─ 후속 커밋 해소 판정 ────→ FIXED ────┘
              └─ PR 종료(닫힘·머지) ────→ STALE

게시 전 판정: SUPPRESSED  (억제 게이트가 게시 자체를 막음 — 행은 남긴다)
```

| 상태 | 뜻 | 통계 반영 |
|---|---|---|
| `OPEN` | 게시됨, 아직 결론 없음 | **분모에서 제외** |
| `ACKED` | 👍 — 좋은 지적 | 채택 |
| `REJECTED` | 👎 — 헛짚음 | 기각 |
| `FIXED` | 후속 커밋이 지적을 해소 | 채택 |
| `RESOLVED` | GitHub 스레드까지 닫힘 (`ACKED`/`REJECTED`/`FIXED` 이후) | 직전 결론 유지 |
| `STALE` | 결론 없이 PR이 닫힘·머지됨 | **중립 — 분모에서 제외** |
| `SUPPRESSED` | 억제로 게시 안 됨 | 제외 (감사 전용) |

**채택률 = (ACKED + FIXED) / (ACKED + FIXED + REJECTED)**

두 가지를 분모에서 빼는 것이 이 설계의 핵심 방어선이다.

- `OPEN`을 빼는 이유: 아직 안 읽은 지적을 기각으로 세면 "리뷰가 늦게 올라온 것"을 "취향에 안 맞는 것"으로 오학습한다.
- `STALE`을 빼는 이유: 못 보고 머지한 것과 보고서 거부한 것은 다르다.

**`SUPPRESSED`를 행으로 남기는 이유**: 억제가 과했는지 사후에 확인할 근거가 필요하다. 억제된 카테고리에서 나중에 실제 결함이 발생했는지 대조할 수 없다면, 학습이 잘못된 방향으로 수렴해도 알아챌 방법이 없다.

### 5.5 GitHub 포트 확장

`GithubClientPort`에 4개 메서드를 추가한다. 앞의 2개는 GraphQL, 뒤의 2개는 REST다.

| 메서드 | 용도 | 방식 |
|---|---|---|
| `listReviewThreads(ref)` | 스레드 + 코멘트 + 리액션 + 답글 + resolve 여부를 한 번에 | GraphQL 1쿼리 (REST면 PR당 수십 회) |
| `resolveReviewThread(threadNodeId)` | 스레드 닫기 | GraphQL mutation |
| `createReviewComment(...)` | 인라인 코멘트 1건 게시 (부분 실패 격리를 위해 낱개 호출) | REST |
| `compareCommits(repo, baseSha, headSha)` | 후속 커밋의 변경 파일·hunk 범위 | REST |

봇이 자기 코멘트에 👍를 다는 기능은 넣지 않는다. "처리했다"는 표시는 스레드 resolve로 충분하고, owner 리액션만 신호로 인정하는 규칙(§6.3)과 섞이면 판정이 지저분해진다.

GraphQL은 이 레포에서 처음 쓴다(`octokit-github.client.ts`에 현재 `graphql` 호출 없음). Octokit 인스턴스는 이미 DI 토큰(`OCTOKIT_INSTANCE`)으로 주입되므로 `octokit.graphql(...)`을 그대로 쓴다.

**PAT 권한 요구사항**: 인라인 코멘트 게시와 스레드 resolve에는 `pull_requests: write`(fine-grained) 또는 `repo`(classic) 권한이 필요하다. 현재 토큰이 이 권한을 갖고 있는지는 **미확인**이며, Phase 1 착수 시 실호출로 확인한다. 권한이 없으면 연습 모드에서 Slack 알림만 나가고 게시는 실패로 기록된다(§7 참고).

---

## 6. 동작 흐름

### 6.1 스윕 사이클

`pr-review-sweep` autopilot task가 한 사이클에 네 단계를 순서대로 처리한다. 할 일이 없으면 `skip: true`를 반환해 Slack 알림을 만들지 않는다(빈 알림 방지는 기존 `AutopilotTaskResult` 계약).

```
1) 발사    allowlist 레포의 열린 PR 조회
           → 아직 리뷰 카드가 없는 PR만 (스윕 1회에 새로 리뷰할 PR은 최대 5개)
           → ReviewPullRequestUsecase 호출 → findings → 카드 생성
2) 게시    억제 게이트 통과한 카드를 GitHub에 (상한 내, MUST_FIX 우선)
3) 수집    기존 OPEN 카드의 스레드 상태 조회 → 리액션·답글·resolve 반영
           head_sha가 바뀐 PR → 커밋 대조 → FIXED 판정
4) 정리    결론 난 카드의 스레드 resolve, 종료된 PR의 OPEN 카드 → STALE
```

**PR 하나당 리뷰는 한 번만 한다.** 커밋마다 재리뷰하면 토큰이 새고 같은 지적이 반복된다. 새 커밋은 3)의 해소 판정에만 쓴다. 재리뷰가 필요하면 사용자가 `/review-pr`로 명시 호출한다.

주기는 `*/15 * * * *`로 시작한다(`playbook-defaults`에 상수로). `riskTier`는 게시가 외부 부작용이지만 allowlist + 상한 + 연습 모드로 통제되므로 `T0_AUTO`로 두고, 승인 게이트는 Phase 3의 프로필 갱신에만 둔다(기존 `preference-learning` task와 같은 구조).

### 6.2 GitHub 인라인 게시와 폴백

GitHub 인라인 코멘트는 **diff에 포함된 줄에만** 달 수 있다. LLM이 제시한 줄이 hunk 범위 밖이면 API가 422로 거부한다.

3단 폴백으로 대응한다.

1. **스냅** — diff를 파싱해 파일별 "코멘트 가능한 줄 집합"을 만든다(`@@ -a,b +c,d @@` 헤더에서 신규 줄 번호 범위 추출). LLM이 준 줄이 집합에 없으면 같은 파일 내 가장 가까운 줄로 당긴다. 거리가 임계(예: 20줄)를 넘으면 스냅을 포기한다.
2. **파일 단위 강등** — 줄 앵커 없이 파일에만 붙인다(`subject_type: 'file'`). `postMode='FILE'`로 기록.
3. **일반 코멘트로 강등** — 남은 카드를 묶어 PR 일반 코멘트 한 건으로 게시한다(기존 `addIssueComment` 재사용). `postMode='ISSUE_COMMENT'`. 줄 앵커는 잃지만 **지적이 조용히 유실되지는 않는다.**

**카드는 한 장씩 따로 게시한다.** `pulls.createReview`에 코멘트 배열을 실어 보내면 한 장이 422일 때 전체가 실패한다. 낱개 `createReviewComment`로 부분 실패를 격리한다.

스냅과 hunk 파싱은 외부 의존이 없는 순수 함수로 분리해 단위 테스트한다.

### 6.3 신호 수집 3층

**① 리액션 (명시)** — 스레드 조회 결과에서 각 카드의 코멘트에 달린 리액션을 읽는다. 👍 → `ACKED`, 👎 → `REJECTED`. **레포 owner(기존 `GITHUB_WEBHOOK_OWNER_LOGIN` 재사용)가 누른 것만 인정**하고 봇·타인 리액션은 무시한다. 👍👎가 함께 있으면 나중 것을 따른다.

**② 후속 커밋 해소 판정 (암묵)** — 2단 필터로 비용을 줄인다.

- **1차: 결정론 필터 (무료)** — `compareCommits(카드의 headSha → 현재 headSha)`로 변경 hunk를 얻고, 카드의 `filePath`·`line` 근방과 겹치는지 계산한다. 안 겹치는 카드는 LLM에게 묻지 않는다.
- **2차: LLM 배치 판정** — 겹치는 카드만 모아 한 번의 호출로 판정한다. 판정은 3택: `해소됨` / `안 됨` / `애매함`. **애매하면 `OPEN`을 유지한다** — 억지 판정보다 미결이 안전하다.

판정용 `AgentType`을 신규로 추가한다(`REVIEW_RESOLUTION_JUDGE`). 모델은 기존 정책대로 ChatGPT 단일 provider. 에이전트 타입을 추가하면 딸려오는 갱신이 있다 — `AGENT_TO_PROVIDER` 매핑, `agent-registry`, 그리고 `pnpm docs:check`(문서↔코드 동기 검증). 이 검증은 로컬 3중 게이트에 없고 CI에서만 걸리므로 커밋 전에 직접 돌린다. 슬래시 명령이 없는 내부 판정용이므로 `/retry-run` 분기는 대상이 아니다.

**③ 기각 이유 (선택적 보강)** — 이유 텍스트는 학습 재료 중 가치가 가장 높지만, 없어도 루프는 돈다.

- **마찰 0 경로**: GitHub 스레드에 사용자가 답글을 달면 그 본문을 `rejectReason`으로 자동 수집한다.
- **명시 경로**: Slack 요약 알림에 "이유 남기기" 버튼을 붙이고, 누르면 modal(입력창)로 받는다.

**Slack DM 자유 답장은 쓸 수 없다.** `router-message.handler.ts:99-100`이 `channel_type='im'` 메시지를 전부 router 입력으로 가져가기 때문에, "왜 기각했나요?"에 대한 답장이 intent 분류로 흘러가 엉뚱한 에이전트를 깨운다. 그래서 버튼+modal로 간다.

### 6.4 학습 반영 3종

**① 사례 (episodic memory) — 코드 변경 없이 완성된다**

`REJECTED` 카드의 `body` + `rejectReason`을 `EpisodicMemoryPort.record({ kind: 'pr_review', agentType: 'CODE_REVIEWER', ... })`로 적재한다. 검색 쪽은 이미 구현돼 있다(`review-pull-request.usecase.ts:143-179`) — 이번 PR과 의미가 유사한 과거 기각을 골라 "이 사용자가 과거에 무시한 리뷰 패턴" 블록으로 프롬프트에 붙인다.

즉 **저장 쪽을 카드 단위로 채우면 소비 쪽은 그대로 동작한다.** 현재 이 경로가 비어 있는 이유는 신호가 0건이기 때문이다.

Phase 3에서 채택 사례(`ACKED`/`FIXED`)도 적재하되 본문 앞에 `[채택]` / `[기각]` 라벨을 붙여 구분한다. 프롬프트가 양쪽을 대조하면 "이런 지적은 환영받는다"까지 학습된다.

**② 규칙 (선호 프로필 `review` 섹션) — 배선만 추가한다**

- `PreferenceSection`에 `'review'`를 추가하고 renderer에 섹션 헤더·렌더 규칙을 넣는다(기존 `plan` 섹션과 같은 구조).
- `ReviewFindingSignalSource`(`PreferenceSignalSource` 구현)를 만들어 `PREFERENCE_SIGNAL_SOURCES` 배열에 등록한다. 관측 텍스트는 기각 이유 + 카테고리별 채택률 요약이다.
- 그러면 **기존 주간 `preference-learning` task가 이 신호를 자동으로 흡수한다** → ChatGPT 추론 → PreviewGate 카드 → 사용자 승인 → 프로필 새 버전(`doNot` / `priorities` 갱신).
- `ReviewPullRequestUsecase`가 `getInjectionBlock('review')`를 `@Optional`로 주입받아 시스템 프롬프트에 append한다. 프로필이 비었으면 빈 문자열이 반환되므로 동작 변화가 없다.

모든 프로필 변경은 사람 승인을 거친다 — 조용한 자기 수정은 없다.

**③ 결정론 억제 게이트**

게시 직전, 카테고리별 통계로 카드를 걸러낸다. 순수 함수로 구현한다.

```
억제 조건 (모두 만족해야 억제):
  - 표본 수(결론 난 카드) >= MIN_SAMPLES
  - 채택률 < REJECT_THRESHOLD
  - severity != 'MUST_FIX'
  - category not in {CORRECTNESS, SECURITY, RELIABILITY}
```

**면제 규칙이 이 게이트의 안전핀이다.** 버그·보안·신뢰성 지적과 모든 `MUST_FIX`는 채택률이 아무리 낮아도 억제하지 않는다. 사용자가 바빠서 몇 번 넘긴 보안 경고를 학습해 영구히 입을 다무는 사고를 원천 차단한다.

`MIN_SAMPLES`와 `REJECT_THRESHOLD` 수치는 **Phase 1~2 실데이터를 본 뒤 정한다**(§11).

억제된 카드는 `status='SUPPRESSED'`, `postMode='SUPPRESSED'`로 저장하고, 스윕 요약에 "N건 억제(카테고리별)"를 남긴다. 조용히 사라지게 하지 않는다.

---

## 7. 안전장치

모든 신규 기능은 **기본 꺼짐**이다. 이 레포 CI에 "자율 기능 기본 OFF" 불변식 검사가 있으므로(`scripts/check-invariants.cjs`) 그 규칙을 따른다.

| env | 기본값 | 역할 |
|---|---|---|
| `PR_REVIEW_LOOP_ENABLED` | `false` | 마스터 스위치. 꺼져 있으면 스윕 task가 즉시 `skip` |
| `PR_REVIEW_INLINE_REPOS` | 빈 값 | 게시 허용 레포 allowlist (`owner/repo` 쉼표 구분). 목록 밖 레포는 Slack 요약만 |
| `PR_REVIEW_INLINE_DRYRUN` | `true` | 연습 모드 — GitHub 게시도 카드 저장도 하지 않고 Slack에 게시 예정 페이로드만 보여줌 |
| `PR_REVIEW_INLINE_MAX` | `4` | PR당 게시 상한. `MUST_FIX` 우선 정렬 후 절단 |
| `PR_REVIEW_SUPPRESSION_ENABLED` | `false` | 억제 게이트 (Phase 3, 표본 확보 후 켬) |

env 추가 시 4곳을 함께 갱신한다: `.env.example`, `.env`, `src/config/app.config.ts`(class-validator), README 표. (프로젝트 규칙 §2-7)

기존 env 재사용: owner 판정은 `GITHUB_WEBHOOK_OWNER_LOGIN`, Slack 알림 대상은 `AUTOPILOT_OWNER_SLACK_USER_ID`. 이름에 `WEBHOOK`이 남아 어색하지만 env 4곳 동기화 비용을 피하기 위해 재사용하고, 주석으로 용도를 적는다.

그 밖의 안전장치:

- **멱등성** — 상태가 전부 DB에 있고 지문 유일 제약이 있으므로 스윕을 몇 번 돌려도 결과가 같다. 재시작·절전 복귀에 건재하다.
- **API 절약** — 스레드·코멘트·리액션을 GraphQL 1쿼리로 가져온다. 스윕당 처리 PR 수에 상한을 둔다.
- **부분 실패 격리** — 카드 한 장의 게시 실패가 나머지를 막지 않는다. 실패는 `postMode`와 로그에 남는다.
- **LLM 호출 억제** — 해소 판정은 결정론 필터를 통과한 카드만, 배치 1회로 묶는다.

---

## 8. 단계 분할

스펙은 전체를 담고 구현 플랜은 단계별로 나눈다. 데이터가 0건이라는 사실이 순서를 정해준다 — 학습 임계치는 실데이터 없이 정할 수 없다.

### Phase 1 — 발사와 게시

여기서 처음으로 실데이터가 생긴다.

- 리뷰 출력 스키마에 `findings`(카테고리·심각도) 추가 + 하위 호환 파서 + 프롬프트 지시
- `PrReviewFinding` 스키마 + 리포지토리 + 지문 생성
- `GithubClientPort` 확장(인라인 게시, compare) + Octokit 어댑터
- diff hunk 파싱 + 줄 스냅 + 3단 폴백
- `pr-review-sweep` autopilot task (발사 + 게시 단계만)
- Slack 요약 포맷터
- env 5개 + 4곳 동기화

**완료 판정**: 연습 모드로 실제 열린 PR에 대해 스윕이 돌고, Slack 미리보기가 게시될 페이로드와 일치한다. 그다음 실게시 1건을 눈으로 확인한다.

### Phase 2 — 신호 수집과 스레드 정리

- `listReviewThreads` GraphQL + 리액션 신호 반영(owner 한정)
- 후속 커밋 해소 판정(결정론 필터 + LLM 배치 판정, `REVIEW_RESOLUTION_JUDGE` 추가)
- 스레드 자동 resolve + 종료 PR의 `STALE` 처리
- 기각 이유 회수: GitHub 답글 자동 수집 + Slack 버튼·modal
- `REJECTED` 카드 → episodic 적재

**완료 판정**: 실제 PR에서 👍 한 번으로 카드가 `ACKED→RESOLVED`까지 가고, 코드를 고친 지적이 `FIXED`로 잡힌다.

### Phase 3 — 학습

- 카테고리별 채택률 집계(순수 함수) + 조회 슬래시 또는 스윕 요약 노출
- 억제 게이트 + 면제 규칙, 임계치 확정
- `PreferenceSection`에 `'review'` + renderer
- `ReviewFindingSignalSource` 등록 → 기존 주간 학습 cron이 흡수
- `ReviewPullRequestUsecase`에 `getInjectionBlock('review')` 주입
- 채택 사례 episodic 적재(`[채택]`/`[기각]` 라벨)

**완료 판정**: 채택률 낮은 카테고리의 저위험 지적이 게시 단계에서 실제로 줄어들고, 억제 로그가 남는다. 버그·보안 지적은 억제되지 않는다(테스트로 고정).

---

## 9. 검증 전략

| 대상 | 방법 |
|---|---|
| 지문 생성, 상태 전이, 채택률 집계, 억제 판정(면제 포함), hunk 파싱·줄 스냅 | 순수 함수 단위 테스트. 로직의 핵심이 전부 여기 있고 외부 의존이 없다 |
| GitHub 어댑터(REST·GraphQL) | Octokit mock — 기존 `octokit-github.client.spec.ts` 패턴 |
| 스윕 오케스트레이션 | 포트 mock. 억제·상한·allowlist·연습 모드 분기별 |
| 하위 호환 | `findings` 없는 구버전 LLM 응답 → `UNCLASSIFIED`로 파싱되는지 |
| 게이트 | `pnpm lint:check && pnpm test && pnpm build` 3중 통과 |
| 실동작 | 연습 모드 스윕 → Slack 미리보기 대조 → 실게시 1건 확인 |

**단위 테스트로 재현되지 않는 것**을 명시한다: GitHub 인라인 코멘트의 422(줄 앵커 거부)는 실제 API 호출로만 확인된다. PAT 권한 충족 여부도 같다. 이 두 항목은 Phase 1 실게시 시점까지 "미검증"으로 남는다.

포트에 메서드를 추가하면 기존 `jest.Mocked<GithubClientPort>` mock들이 "Property missing"으로 깨진다. 단일 파일 테스트로는 안 잡히므로 전체 `pnpm test`로 확인한다.

---

## 10. 범위 밖

| 항목 | 이유 |
|---|---|
| 이대리가 지적을 스스로 고쳐서 커밋 | BE_FIX·BE 샌드박스에 별도 경로가 있다. 리뷰 루프의 책임이 아니다 |
| BE_FIX 지적의 카드 편입 | 카드에 `agentType` 자리만 만들어 두고 Phase 1에서는 `CODE_REVIEWER`만 태운다 |
| 회사 레포 기본 적용 | allowlist 방식이므로 명시적으로 넣지 않으면 가지 않는다. 팀 레포에 봇 코멘트가 갑자기 등장하는 사고를 막는다 |
| 다중 사용자 | 기존 선호 프로필과 동일하게 owner 1인 전제 |
| webhook 터널 구축 | 폴링으로 가기로 했다. 기존 webhook 코드도 제거하지 않고 그대로 둔다 |
| `PrReviewOutcome` / `/review-feedback` 정리 | 실적 0건이지만 제거는 별건 |
| 리뷰 프롬프트 자체의 품질 튜닝 | 학습 루프가 그 역할을 대신한다 |

---

## 11. 실데이터를 본 뒤 정할 항목

지금 수치를 정하면 추측이 된다. Phase 1~2 운영 데이터로 확정한다.

| 항목 | 결정 근거가 될 관측치 |
|---|---|
| `MIN_SAMPLES` (억제 최소 표본) | 카테고리별 결론 카드가 쌓이는 속도 |
| `REJECT_THRESHOLD` (억제 기준 채택률) | 실제 채택률 분포. 카테고리 간 격차가 뚜렷한지 |
| 스윕 주기 (초기 15분) | `STALE` 비율. 높으면 리뷰가 머지보다 늦다는 뜻이므로 주기를 줄인다 |
| PR당 게시 상한 (초기 4건) | 게시된 카드 중 결론이 나는 비율. 너무 많으면 사용자가 다 안 본다 |
| 줄 스냅 허용 거리 (초기 20줄) | 스냅 후 게시된 코멘트가 실제로 맞는 위치에 붙는지 |
| 채택 사례 주입 여부 | 기각 사례 주입만으로 행동이 바뀌는지 |
