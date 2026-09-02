# PR 리뷰 핑퐁 루프 Phase 2a — 구현 계약

base: `origin/main` (78aa6ba) / branch: `feat/pr-review-pingpong-phase2a`
worktree: `~/worktrees/idaeri-review-pingpong` (ASCII 경로)

## 0. 한 줄

게시된 리뷰 카드에 대한 사용자 반응(👍/👎 리액션 + GitHub 스레드 답글)을 수확해
카드 상태를 전이시키고, 기각으로 판정된 카드를 episodic memory 에 적재해
다음 리뷰 프롬프트에 되먹인다. 소비측(negative example 주입)은 이미 구현돼 있다.

## 1. 범위

포함 (2a):
- 게시 body 에 봇 표식 부착 (사람이 봇 리뷰와 owner 코멘트를 구분)
- `listReviewThreads` GraphQL — 스레드/코멘트/리액션/답글/resolve 여부 1쿼리
- 리액션 신호(owner 한정) → `ACKED` / `REJECTED`
- owner 답글 → LLM 배치 판정(신규 `REVIEW_REPLY_JUDGE`) → `ACKED` / `REJECTED` / 무변화
- 기각 이유(`rejectReason`) 수집
- 스레드 자동 resolve → `RESOLVED`
- PR 종료(closed/merged)인데 미결 카드 → `STALE`
- `REJECTED` 카드 → episodic 적재 (`kind: 'pr_review'`, `agentType: 'CODE_REVIEWER'`)
- Slack 스윕 요약에 수확 결과 1줄

제외 (2b 이후, 건드리지 말 것):
- 후속 커밋 해소 판정(`compareCommits` + hunk 겹침 + `FIXED` 전이)
- 채택률 집계 / 억제 게이트 / `PreferenceSection('review')`
- 채택 사례(positive) episodic 적재
- 이미 게시된 코멘트 4건의 표식 소급 (사용자가 명시적으로 "그대로 둠" 결정)
- Slack 버튼·modal 이유 입력 경로

## 2. 반드시 지킬 함정 두 개

### 함정 A — 저장된 `githubThreadNodeId` 는 스레드 id 가 아니다

Phase 1 의 `createReviewComment` 는 REST 응답의 `response.data.node_id` 를 저장한다
(`octokit-github.client.ts:305-307`). 이건 **코멘트**의 node id(`PRRC_...`)이고,
GraphQL `resolveReviewThread` mutation 이 요구하는 건 **스레드**의 id(`PRRT_...`)다.
실제 DB 값도 `PRRC_kwDOR9tAzs7b2qOD` 로 확인했다.

→ 저장값을 resolve 입력으로 쓰면 안 된다. `listReviewThreads` 결과에서
`thread.comments[].databaseId` 와 카드의 `githubCommentId` 를 대조해 소속 스레드를 찾고,
그 `thread.id` 로 resolve 한다. 그 김에 DB 의 `githubThreadNodeId` 를 올바른 스레드 id 로
교정 저장한다(다음 사이클부터 대조 비용 감소, 그리고 잘못된 값이 남아 있지 않게).

### 함정 B — negative example 오학습

`review-pull-request.usecase.ts:151-177` 은 `kind='pr_review'` + `agentType='CODE_REVIEWER'`
episode 를 검색해 **무조건** `[이 사용자가 과거에 무시한 리뷰 패턴 — 이런 코멘트는 피하세요]`
블록으로 주입한다. 라벨 구분이 없다.

→ **`REJECTED` 판정 카드만 적재한다.** 채택(`ACKED`)·미결(`OPEN`)·`STALE` 은 절대 적재 금지.
좋은 지적을 적재하면 다음 리뷰가 그 지적을 피하도록 역학습한다.
→ LLM 판정이 `UNCLEAR` 면 상태를 바꾸지 않고 적재도 하지 않는다. 억지 판정보다 미결이 안전하다.

## 3. 파일별 변경 명세

### 3.1 신규: `src/pr-review-loop/domain/finding-comment.body.ts`

```ts
export interface BuildFindingCommentBodyInput {
  category: FindingCategory;
  severity: FindingSeverity;
  body: string;
}
export function buildFindingCommentBody(input: BuildFindingCommentBodyInput): string;
```

출력 형식(정확히 이대로):
```
🤖 **이대리 자동 리뷰** · {category} / {severity}

{body}
```
- 상수 `IDAERI_REVIEW_MARKER = '🤖 **이대리 자동 리뷰**'` 를 export 한다.
- `body` 는 그대로 둔다(trim 만). 변형·요약 금지.

`publish-findings.service.ts` 의 두 게시 경로가 이 함수를 쓴다:
- `postWithFallback` 의 `createReviewComment({ body: ... })` — 현재 `finding.body` 직접 전달
- `postGroupedComment` 의 헤더 — 현재 `'이대리 리뷰 — 줄 앵커를 찾지 못해 묶어서 남깁니다.'`
  → `${IDAERI_REVIEW_MARKER} — 줄 앵커를 찾지 못해 묶어서 남깁니다.` 로 통일

**DB `body` 컬럼은 표식 없는 원문을 유지한다.** 지문(fingerprint)이 body 기반이라
표식을 포함시키면 기존 카드와 지문이 갈린다. 표식은 게시 직전에만 씌운다.

### 3.2 GitHub 포트 확장 — `src/github/domain/port/github-client.port.ts`

```ts
export interface ReviewThreadComment {
  databaseId: number;      // REST comment id — 카드의 githubCommentId 와 대조
  authorLogin: string | null;
  body: string;
  createdAt: string;       // ISO
  reactions: ReviewThreadReaction[];
}
export interface ReviewThreadReaction {
  content: string;         // 'THUMBS_UP' | 'THUMBS_DOWN' | 그 외
  userLogin: string | null;
  createdAt: string;
}
export interface ReviewThread {
  threadId: string;        // PRRT_... — resolve 대상
  isResolved: boolean;
  comments: ReviewThreadComment[];  // 시간순
}
export interface ListReviewThreadsResult {
  threads: ReviewThread[];
  pullRequestState: 'OPEN' | 'CLOSED' | 'MERGED';
}

listReviewThreads(ref: PullRequestRef): Promise<ListReviewThreadsResult>;
resolveReviewThread(threadId: string): Promise<void>;
```

### 3.3 Octokit 어댑터 — `src/github/infrastructure/octokit-github.client.ts`

이 레포 첫 GraphQL 사용. `this.octokit!.graphql(query, vars)` 를 쓴다.
`assertOctokitConfigured()` 선행, 실패는 기존 `wrapRequestFailed` 로 감싼다.

```graphql
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      state
      merged
      reviewThreads(first:50) {
        nodes {
          id
          isResolved
          comments(first:20) {
            nodes {
              databaseId
              body
              createdAt
              author { login }
              reactions(first:20) {
                nodes { content createdAt user { login } }
              }
            }
          }
        }
      }
    }
  }
}
```
- `pullRequestState`: `merged === true` → `'MERGED'`, 아니면 `state` 그대로.
- 페이지네이션은 하지 않는다(first:50 / first:20 상한). 상한 초과분은 다음 사이클에도
  안 잡히므로, **초과 시 `logger.warn` 으로 남긴다** — 조용한 누락 금지.

resolve mutation:
```graphql
mutation($threadId:ID!) { resolveReviewThread(input:{threadId:$threadId}) { thread { id } } }
```

### 3.4 신규 순수 함수: `src/pr-review-loop/domain/harvest-signal.ts`

외부 의존 0. 단위 테스트 대상.

```ts
export type HarvestSignal =
  | { kind: 'ACKED'; source: 'REACTION' }
  | { kind: 'REJECTED'; source: 'REACTION' }
  | { kind: 'NEEDS_JUDGE'; replyBody: string }   // owner 답글 있음, 리액션 없음
  | { kind: 'STALE' }
  | { kind: 'NONE' };

export interface ResolveHarvestSignalInput {
  card: { githubCommentId: string | null };
  thread: ReviewThread | null;    // 카드가 속한 스레드 (없으면 null)
  ownerLogin: string;
  pullRequestState: 'OPEN' | 'CLOSED' | 'MERGED';
}
export function resolveHarvestSignal(input: ResolveHarvestSignalInput): HarvestSignal;

// 카드 → 스레드 매핑
export function findThreadForComment(
  threads: ReviewThread[],
  githubCommentId: string,
): ReviewThread | null;
```

판정 규칙(우선순위 순):

| 조건 | 결과 |
|---|---|
| owner 의 `THUMBS_UP` / `THUMBS_DOWN` 리액션이 **봇 코멘트**에 있음 | 둘 다면 `createdAt` 이 늦은 것. UP→`ACKED`, DOWN→`REJECTED` (source: REACTION) |
| 리액션 없음 + 봇 코멘트 **이후**에 owner 가 쓴 코멘트 있음 | `NEEDS_JUDGE` (replyBody = owner 답글들을 `\n` 으로 결합) |
| 위 둘 다 없음 + `pullRequestState !== 'OPEN'` | `STALE` |
| 그 외 | `NONE` |

- owner 판정은 `authorLogin === ownerLogin` **정확 일치**. 봇·타인 리액션/답글은 무시한다.
- 봇 코멘트 = `comment.databaseId === Number(card.githubCommentId)`.
- 스레드를 못 찾은 카드(`thread === null`)는 PR 이 종료됐으면 `STALE`, 아니면 `NONE`.
  (코멘트가 삭제됐거나 상한 밖인 경우 — 조용히 채택/기각으로 몰지 않는다.)

### 3.5 신규 판정 에이전트: `src/agent/review-reply-judge/`

`src/agent/contradiction-judge/` 를 **그대로 본뜬다** (구조·에러 처리·쿼터 예외 전파).

- `domain/review-reply-judge.type.ts` — `ReplyVerdict = 'ACCEPTED' | 'REJECTED' | 'UNCLEAR'`,
  배치 입출력 타입
- `application/judge-review-reply.usecase.ts` — `ModelRouterUsecase.route({ agentType: AgentType.REVIEW_REPLY_JUDGE, ... })`
- `review-reply-judge.module.ts`

**PR 단위 배치 1회 호출**. 카드 N건을 한 프롬프트에 담는다(카드당 호출 금지).

프롬프트 계약:
```
당신은 코드 리뷰 지적에 대한 작성자의 답변이 그 지적을 수용했는지 판정한다.
각 항목에 대해 verdict 를 고른다.
- ACCEPTED: 지적을 인정했거나 고쳤다고 답함
- REJECTED: 지적이 틀렸거나 불필요하다고 답함
- UNCLEAR: 질문·보류·판단 불가

JSON 배열만 출력: [{"id": <카드 id>, "verdict": "...", "reason": "<20자 이내 근거>"}]

[항목]
1) id=<id>
   지적: <카드 body>
   작성자 답변: <replyBody>
...
```

파서: `contradiction-judge` 와 같이 첫 `[...]` 블록을 정규식으로 추출 → `JSON.parse`.
- 파싱 실패 / 항목 누락 / 알 수 없는 verdict → 그 카드는 `UNCLEAR` 로 간주(무변화).
- LLM 호출 실패(쿼터 포함)는 **수확 전체를 죽이지 않는다** — 리액션 신호는 이미 반영된 뒤이므로
  판정 단계만 건너뛰고 `logger.warn`.

딸림 갱신 (누락 시 CI 실패):
- `src/model-router/domain/model-router.type.ts` — `AgentType.REVIEW_REPLY_JUDGE`
- `src/model-router/application/model-router.usecase.ts` — `AGENT_TO_PROVIDER` 에 `CHATGPT`
- `src/agent-registry/agent-registry.ts` — 엔트리 추가
  (`slashCommands: []`, `usecasePath: 'src/agent/review-reply-judge/application/judge-review-reply.usecase.ts'`,
   `description: 'PR 리뷰 답변 수용 여부 판정'`)
- **`pnpm docs:check` 를 반드시 돌린다** — 로컬 3중 게이트에 없고 CI 에서만 걸린다.
  `pnpm docs:sync` 로 생성물 갱신 후 커밋에 포함.
- `/retry-run` 분기는 대상 아님(슬래시 없는 내부 판정용).

### 3.6 리포지토리 확장

`src/pr-review-loop/domain/port/pr-review-finding.repository.port.ts`:
```ts
// 수확 대상 — 게시됐고 아직 결론 없는 카드.
findOpenPostedCards(): Promise<PrReviewFindingRecord[]>;

markDecided(input: {
  id: number;
  status: Extract<FindingStatus, 'ACKED' | 'REJECTED' | 'STALE'>;
  rejectReason: string | null;
  githubThreadNodeId: string | null;   // 교정 저장 (함정 A)
}): Promise<void>;

markResolved(id: number): Promise<void>;   // status='RESOLVED', resolvedAt=now
```

- `findOpenPostedCards`: `where { status: 'OPEN', githubCommentId: { not: null } }`,
  `orderBy: { createdAt: 'asc' }`, **`take: 200` 상한**(폭주 방지, 초과 시 warn).
- `markDecided`: `decidedAt = new Date()`. `rejectReason` 은 `REJECTED` 일 때만 채운다.
- `PrReviewFindingRecord` 에 `githubThreadNodeId: string | null` 필드를 추가하고
  `toRecord` 의 row 타입·매핑에도 반영한다(현재 누락돼 있다).
- Prisma 스키마 변경 **없음** — 컬럼은 Phase 1 에 이미 다 있다. `db:push` 불필요.

### 3.7 신규 usecase: `src/pr-review-loop/application/harvest-review-signals.usecase.ts`

```ts
async execute(): Promise<HarvestOutcome>
// HarvestOutcome { acked, rejected, stale, resolved, judged, skipped }
```

흐름:
1. `PR_REVIEW_HARVEST_ENABLED !== 'true'` → 빈 결과 즉시 반환
2. `GITHUB_WEBHOOK_OWNER_LOGIN` 없으면 warn + 빈 결과
3. `findOpenPostedCards()` → `${repo}#${pullNumber}` 로 그룹
4. PR 그룹마다 (한 PR 실패가 전체를 죽이지 않게 try/catch 격리):
   - `listReviewThreads`
   - 카드마다 `findThreadForComment` → `resolveHarvestSignal`
   - `NEEDS_JUDGE` 카드를 모아 **1회** 배치 판정 → verdict 매핑
     (`ACCEPTED`→ACKED, `REJECTED`→REJECTED, `UNCLEAR`→무변화)
   - 전이 적용:
     - `ACKED`: `markDecided` → `resolveReviewThread`(이미 resolved 면 skip) → 성공 시 `markResolved`
     - `REJECTED`: `markDecided(rejectReason)` → **episodic 적재** → resolve → `markResolved`
     - `STALE`: `markDecided`, resolve 안 함
   - resolve 실패는 warn 만 — 상태 전이는 이미 성공했으므로 되돌리지 않는다
5. episodic 적재 (`@Optional()` 주입, 미주입이면 skip):
   ```ts
   this.episodicMemory.record({
     kind: 'pr_review',
     agentType: 'CODE_REVIEWER',
     agentRunId: card.agentRunId,
     content: `${card.body}\n(기각 이유: ${reason})`,   // reason 없으면 body 만
     occurredAt: new Date(),
   })
   ```
   fire-and-forget + `.catch(warn)` — 본 흐름 비차단 (`save-review-outcome.usecase.ts` 와 동일 정책).

### 3.8 autopilot task 배선

`src/autopilot/infrastructure/tasks/pr-review-sweep.autopilot-task.ts`:
- `harvestUsecase.execute()` 를 **리뷰 스윕보다 먼저** 실행한다
  (이번 사이클에 기각으로 판정된 카드가 같은 사이클의 리뷰 프롬프트에 바로 반영됨).
- 수확 결과가 전부 0 이고 리뷰 결과도 없으면 기존대로 `{ skip: true }` — 빈 알림 금지.
- 수확 실패는 리뷰를 막지 않는다(try/catch, warn).

`src/slack/format/pr-review-sweep.formatter.ts`:
- 수확 요약 1줄 추가. 예: `👍 2 · 👎 1 · 종료 3 · 스레드 정리 3`
- 0 인 항목은 빼고, 전부 0 이면 줄 자체를 생략.

### 3.9 env — 4곳 동기 갱신 필수

신규 1개: `PR_REVIEW_HARVEST_ENABLED` (기본 `false`)
- `.env.example` (기존 `PR_REVIEW_*` 블록 아래, 주석 포함)
- `.env` (로컬, `false`)
- `src/config/app.config.ts` (`@IsOptional() @IsString()`, 기존 `PR_REVIEW_*` 와 같은 형식)
- `README.md` env 표

자율 기능 기본 OFF 규칙(`scripts/check-invariants.cjs`)을 지킨다.

## 4. 테스트 요구

신규 spec (최소):
- `harvest-signal.spec.ts` — 판정 표 6케이스 + owner 아닌 사람 리액션 무시 + 👍👎 공존 시 늦은 것
  + 스레드 못 찾음 × PR OPEN/CLOSED
- `finding-comment.body.spec.ts` — 표식 형식, 원문 보존
- `harvest-review-signals.usecase.spec.ts` — ACKED/REJECTED/STALE 전이, **`ACKED` 는 episodic
  적재 안 함**(함정 B 회귀 고정), resolve 실패해도 상태 유지, LLM 실패 시 리액션 신호는 반영됨
- `judge-review-reply.usecase.spec.ts` — 파싱 성공/실패, 누락 항목 UNCLEAR 처리
- `octokit-github.client.spec.ts` — GraphQL mock 으로 `listReviewThreads` 매핑 + merged→'MERGED'

기존 spec 갱신:
- `publish-findings.service.spec.ts` — 게시 body 에 표식이 붙는지, **DB body 는 원문 그대로**인지
- `PrReviewFindingRepositoryPort` mock 을 쓰는 모든 spec — 신규 메서드 3개 추가
  (`jest.Mocked<Port>` 는 메서드 누락 시 "Property missing" 으로 실패한다. 전체 `pnpm test` 로 확인)

## 5. 검증 (전부 exit 0 이어야 완료)

```bash
pnpm lint:check
pnpm test
pnpm build
pnpm docs:check      # AgentType 추가 때문에 필수
```

`pnpm test` 는 jest 2회 실행 구조라 `-- <경로>` 필터가 안 먹는다. 단일 파일은
`pnpm exec jest src/pr-review-loop/...` 로 돌리되, **마지막엔 반드시 전체 `pnpm test`** 를 돌린다.

DB 스키마 변경이 없으므로 `db:push` 는 하지 않는다(공유 DB 드리프트 방지).

## 6. 코드 규칙 (CODE_RULES 빈출 위반)

- `catch (error)` — `err` 금지 / `found`·`repository`·`request` — 줄임말 금지
- `if (cond) { return; }` — 단일 라인 중괄호 생략 금지
- try-catch 안에서는 `return await`
- 인라인 반환 타입 금지 — 별도 interface 로 추출
- `process.env` 직접 참조 금지 — `ConfigService.get(...)`
- prompt 는 stdin (model-router 경유하므로 자동 준수)
- 파일명 kebab-case + role suffix

## 7. 하지 말 것

- 기존 게시 코멘트 4건 수정 (소급 금지)
- `PrReviewOutcome` / `/review-feedback` 슬래시 건드리기 (별개 경로, 그대로 둠)
- `pulls.createReview` 로 묶어 게시하도록 변경 (낱개 유지 — 부분 실패 격리)
- 봇이 자기 코멘트에 리액션 달기
- `compareCommits` · `FIXED` 전이 (2b)
- 커밋 (사용자 승인 후 메인 트리에서 대행)
