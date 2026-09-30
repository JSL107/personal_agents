# 판단 보류 상태 설계 (R3)

- 작성일: 2026-09-30
- 브랜치: `feat/undecided-verdict`
- 상태: 설계안 — 구현 전 사용자 승인 필요

## 한 줄 요약

세 곳에서 "판단할 수 없다"는 결론이 제대로 저장되지 않는다. PR 답글 판정은 보류를 프로세스 메모리에만 두어 재시작할 때마다 같은 답글을 다시 묻고, 모델이 한 번이라도 다른 답을 내면 그 답으로 확정한다. 코드리뷰 결과에는 보류 값이 없어서 모델이 스스로 "판단 보류"라고 쓰고도 위험도·승인 권고를 억지로 채운다. 잠재의식 제안은 사용자 거절, 24시간 만료, 스윕이 대신 처리한 경우를 모두 `DISMISSED` 하나로 기록한다. 이 문서는 세 곳에 보류를 명시적인 상태로 두고, 같은 입력을 다시 묻지 않도록 하는 규칙을 정한다.

---

## 1. 무엇이 확인됐나

### 1-1. PR 답글 판정(REVIEW_REPLY_JUDGE) — 같은 입력을 다시 물어 결론이 뒤집힌다

| 지적 | 판정 호출 | 결과 | 확정 |
|---|---|---|---|
| #1118 (`JSL107/personal_agents#613`) | run 4602~4877, 14회 (09-22 09:12 ~ 09-23 14:39 KST) | ACCEPTED 13회 → 마지막 1회 REJECTED | REJECTED, `decided_at` 09-23 14:39:11 |
| #860 (`JSL107/personal_agents#543`) | run 3040~3200, 8회 (09-10 09:30 ~ 09-11 09:06 KST) | ACCEPTED 7회 → 마지막 1회 REJECTED | REJECTED, `decided_at` 09-11 09:06:09 |

- 14회 모두 `input_snapshot` 지문이 같다. 전체 75회 가운데 입력이 겹친 것은 이 두 건뿐이다(55종 입력 중 53종은 1회).
- #1118 스레드에는 owner 답글이 하나(`2026-09-22T00:02:40Z`, 수정 이력 없음)뿐이고, 18초 뒤 👎가 달렸다(GitHub API 조회). 마지막 두 호출(14:36, 14:39) 사이에 답글은 바뀌지 않았다. 같은 모델(`codex-cli`)에 같은 입력을 넣었는데 결과가 뒤집힌 것은 표본 편차다.
- 왜 다시 물었나: 👎와 "수용" 판정이 어긋나면 카드를 OPEN으로 두고 `contradictionCheckpoints`에 답글을 적어 다음 회차 재판정을 막는다(`harvest-review-signals.usecase.ts:120-124`, `:344-349`, `:643-652`). 그런데 이 기록은 프로세스 메모리(`Map`)라 재시작하면 사라진다. 답글 본문 조립은 결정적이고(`harvest-signal.ts:91`), usecase는 싱글턴이다(`pr-review-loop.module.ts:24`). 그래서 같은 답글이 다시 판정되는 경로는 재시작 말고는 없다.
  - #860의 REJECTED 판정(09-11 09:06:00)은 `logs/server.log`에 남은 부팅(09:05:25) 35초 뒤다.
  - #1118 쪽은 부팅 로그가 남아 있지 않아 재시작 시각을 직접 대조하지 못했다. 원인은 소거법으로 추정했다.
- 어긋남이 풀리는 방식: 모델이 ACCEPTED 말고 다른 답을 내면 그 회차에 리액션대로 확정한다(`:653-666`). 결국 "모델이 리액션에 동의할 때까지 다시 굴리기"다. 결론은 재시작 횟수와 운으로 정해진다.
- 두 건 모두 확정된 쪽(REJECTED)이 사람의 뜻과 맞았다. owner 답글이 "확인했고, 지적하신 실패 방식은 성립하지 않습니다"(#1118), "지적의 취지(동작 검증 부재)는 맞지만 … 기각합니다"(#860)로, 앞머리는 인정하고 본문은 반박하는 형태다. 판정기가 앞머리를 수용으로 읽은 것으로 보인다. 판정 프롬프트 품질은 이 설계의 범위 밖이다(§7).
- 9/8 설계(`2026-09-08-pr-review-depth-and-learning-design.md:121`)는 어긋남을 "보류하고 Slack으로 한 건 알린다"고 정했다. 현재 Slack에는 "보류 N" 건수만 나가고(`pr-review-sweep.formatter.ts:92`, `pr-review-sweep.autopilot-task.ts:140`), 어느 카드인지와 사람이 어떻게 결론을 내는지는 없다. 같은 문서의 열린 질문 4(보류 카드의 처리 주체)도 아직 답이 없다.

### 1-2. 코드리뷰(CODE_REVIEWER) — "판단 불가"를 표현할 값이 없다

- 결과 타입은 `riskLevel: 'low'|'medium'|'high'`, `approvalRecommendation: 'approve'|'request_changes'|'comment'`뿐이다(`code-reviewer.type.ts:8,10`). 파서는 이 집합 밖의 값을 거부한다(`pr-review.parser.ts:16-20, 82-90`).
- 프롬프트에서 `comment`는 "niceToHave만 있을 때"다(`code-reviewer-system.prompt.ts:31-34`). 지적이 0건인데 승인할 근거도 없으면 맞는 선택지가 없다.
- 요약에 모델 스스로 보류를 적고, 지적은 0건이며, 등급만 채워진 run이 7건이다. 7건 모두 `medium`/`comment`다.

| run | 원인 | 요약 발췌 |
|---|---|---|
| 1421 | diff 잘림 | "실제 구현·테스트 파일 내용은 미확인" |
| 1970 | 요청 대상 불일치 | "리뷰 보류. 요청 대상은 DDD_BE#87이지만 제공된 diff는 DDD-13-WEBBB_BE#79" |
| 5320 | diff 잘림 | "전체 diff 확인 전에는 승인 근거가 부족합니다" |
| 5331 | diff 잘림 (686KB 중 50KB) | "전체 머지 가부는 보류 의견입니다" |
| 5478 | 핵심 파일 누락 | "전체 핵심 diff 확인 전 승인은 보류합니다" |
| 5515 | diff 잘림 | "전체 diff 확인 전에는 머지 승인을 보류한다" |
| 5599 | diff 잘림 (50,000바이트) | "전체 변경 확인 전 승인 판단은 보류합니다" |

(집계 조건: `CODE_REVIEWER`·`SUCCEEDED`·`findings` 0건·요약에 `보류|판단할 수 없|승인 근거가 부족` 포함. 걸린 8건 중 run 5867은 PR 내용 속 "보류"라는 단어에 걸린 오탐이라 뺐다. 핸드오프가 후보로 든 run 2963은 "잘렸다"는 단서만 있고 보류 선언은 없어 이 목록에 넣지 않았다.)

- 대상 PR이 반복 리뷰되지는 않는다. 스윕은 PR당 1회(쿨다운 재시도)만 리뷰한다(`sweep-pr-reviews.usecase.ts:232`, `findLatestSweepReview`). 여기서는 "같은 입력 재호출"이 아니라 "억지로 채운 등급"만 문제다.

### 1-3. 잠재의식 제안(SUBCONSCIOUS) — 거절·만료·대체가 한 값이다

- `ProposalStatus = 'PENDING'|'DISPATCHED'|'DISMISSED'`(`subconscious-proposal.repository.port.ts:5`). `DISMISSED`로 가는 경로는 셋이다.
  1. 사용자가 ❌를 누름 — `subconscious-proposal.service.ts:377`
  2. 24시간 TTL 만료 — `subconscious-proposal.prisma.repository.ts:76` (`expirePendingOlderThan`)
  3. 스윕이 같은 PR을 이미 리뷰함 — `subconscious-proposal.service.ts:158`
- DB 실측: 전체 76건 = DISMISSED 62 · DISPATCHED 11 · PENDING 3. DISMISSED 62건 중 생성 후 1430분 이상 지나 닫힌 것이 53건, 30분~TTL 사이가 7건, 30분 미만이 2건이다.
- DISMISSED의 해소 소요 중앙값은 6,540분(약 4.5일)이다. 핸드오프 문서의 "~1459분"과 다른 이유는, 만료 일괄 종료가 처음 들어간 09-10에 쌓여 있던 38건이 한꺼번에 닫혔기 때문이다.
- `status` 컬럼은 `String`이다(`schema.prisma:305`). DB enum이 아니므로 새 값을 추가해도 스키마를 바꿀 필요가 없다.
- 현재 `DISMISSED`를 구분해서 읽는 소비자는 없다. `hasProposedSince`는 상태를 가리지 않고, `listPending`은 PENDING만 본다. 그래서 지금 드러난 문제는 관측 불가에 그친다. 다만 제안 채택률이나 게이트 학습을 붙이는 순간, 만료가 거절로 세어진다.

---

## 2. 설계 원칙

1. **보류는 값으로 저장한다.** 메모리·로그에만 두면 재시작하거나 로그가 돌 때 사라지고, 사라진 보류는 재호출로 이어진다.
2. **같은 입력은 다시 묻지 않는다.** 판정 입력의 지문이 같으면 저장된 결론(보류 포함)을 재사용한다. 입력이 바뀔 때만 다시 판정한다.
3. **모델 판정을 여러 번 모아 다수결하지 않는다.** 입력 하나에 판정 하나다. 뒤집힘을 다수결로 누르는 대신, 뒤집힐 기회 자체를 없앤다.
4. **보류는 사람이 결론을 낼 길과 기한을 함께 가진다.** 그렇지 않으면 보류는 조용한 영구 미결이 된다.
5. **판단 불가 결과는 등급 칸을 비운다.** 코드가 강제하고, 프롬프트 설명만으로 끝내지 않는다.

---

## 3. 대상별 설계

### 3-1. PR 답글 판정의 모순 보류 — DB에 저장한다

**표현**: `pr_review_finding`에 nullable 컬럼 두 개를 더한다. 카드 상태(`status`)는 OPEN 그대로 둔다. 새 상태값을 만들면 OPEN 전용 조회(`findOpenPostedCards`)에서 빠져서, 사람이 답글을 고쳐도 다시 수확되지 않는다.

| 컬럼 | 타입 | 뜻 |
|---|---|---|
| `held_reply_hash` | `text?` | 모순 보류를 건 답글 본문의 sha256 (`replyFingerprint` 재사용) |
| `held_at` | `timestamp?` | 보류가 처음 걸린 시각 — 기한 계산용 |

**수렴 규칙**

| 상황 | 동작 | 모델 호출 |
|---|---|---|
| 👎 + owner 답글, `held_reply_hash`가 비었거나 현재 답글 지문과 다름 | 판정기 호출. ACCEPTED면 두 컬럼 기록 후 OPEN 유지, 그 밖이면 종전대로 REJECTED 확정 | 1회 |
| 👎 + owner 답글, 지문이 `held_reply_hash`와 같음, 기한 전 | 건너뜀 (`contradicted += 1`) | 0회 |
| 위와 같고 기한(`held_at` + 72시간) 경과 | **결정 요청 A** — 권고안은 리액션대로 REJECTED 확정, `rejectReason`은 owner 답글 원문 | 0회 |
| 👎가 사라짐 (사람이 리액션 제거) | 두 컬럼을 지우고 일반 답글 판정 경로로 | 1회 |
| 답글이 바뀜 (사람이 정정·추가) | 지문이 달라졌으니 재판정 | 1회 |
| 재시작 | 컬럼이 남아 있어 위 규칙 그대로 | 0회 |

- 결과: 같은 (카드, 답글) 쌍에 대한 모델 호출은 평생 1회다. 재시작해도 늘지 않는다.
- 메모리 `contradictionCheckpoints`는 없앤다. 컬럼이 같은 역할을 하고, 둘이 공존하면 어느 쪽이 정본인지 갈린다.
- `replyJudgmentCheckpoints`(UNCLEAR 재판정 방지)와 `resolutionCheckpoints`(해소 판정)는 이번에 옮기지 않는다. 같은 메모리 구조지만, 원장 75회 중 반복 호출은 모두 모순 경로에서만 나왔다(§1-1). 실제 피해가 확인된 것만 옮긴다. 옮길 때도 같은 컬럼 패턴을 쓰면 된다.

**사람에게 넘기는 방식**

- 보류가 새로 걸린 회차의 Slack 스윕 요약에 카드 id와 GitHub 코멘트 링크를 한 줄씩 붙인다. 지금은 건수만 나간다.
- 안내 문구: "👎가 맞으면 두면 된다 — 72시간 뒤 기각 확정. 수용이면 👎를 지운다."
- 이미 알린 보류는 다시 알리지 않는다(`held_at`이 이번 회차보다 이전이면 생략).

### 3-2. 코드리뷰의 판단 불가 — 새 enum 값 + 이유 필드

**표현** (별도 필드 대신 enum 확장을 택한 이유: 소비자가 전부 `Record<Union, string>`이라 값을 추가하면 컴파일러가 빠진 곳을 전부 찾아 준다)

```ts
export type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';
export type ApprovalRecommendation =
  | 'approve' | 'request_changes' | 'comment' | 'undetermined';

export interface PullRequestReview {
  // ...기존 필드
  // approvalRecommendation === 'undetermined' 일 때만 채운다. 사람이 읽을 한 문장.
  undeterminedReason?: string;
}
```

**코드가 강제하는 규칙** (`pr-review.parser.ts`)

짝이 틀린 응답은 예외로 끊지 않고 보정한다. 끊으면 같은 응답의 지적까지 통째로 잃는데, 새 값을 들인 직후에는 모델이 짝을 틀리는 회차가 나올 수 있다. 보정한 사실은 호출부가 경고 로그로 남긴다.

- `undetermined`이면 `riskLevel`을 코드가 `'unknown'`으로 덮어쓴다. 모델이 `medium`을 적어도 저장되지 않는다.
- `undetermined`인데 `undeterminedReason`이 비었으면 "사유 미기재(모델 응답에 없음)"로 채우고 보류를 유지한다.
- `riskLevel === 'unknown'`인데 `undetermined`가 아니면 `undetermined`로 올리고 이유를 "등급을 정하지 못함(모델 응답)"으로 채운다.
- 위 어느 경우든 `mustFix`(또는 `MUST_FIX` 지적)가 1건 이상이면 `request_changes`·`high`로 올린다. 막을 결함을 찾았다면 그것이 결론이다.
- 보류가 아닌 리뷰에 붙은 `undeterminedReason`은 버린다.
- `undeterminedReason`이 문자열이 아닌 경우만 다른 필드와 같이 형식 위반(`INVALID_MODEL_OUTPUT`)이다.

**프롬프트** (`code-reviewer-system.prompt.ts:27-34` 치환, 덧붙이지 않는다)

- `"undetermined"` — diff 잘림, 요청 대상 불일치, 핵심 파일 누락 때문에 머지 가부를 판단할 근거가 없을 때. `riskLevel`은 `"unknown"`, `undeterminedReason`에 무엇을 못 봤는지 한 문장.
- `"comment"` 정의를 "niceToHave만 있을 때"에서 "막을 결함은 없지만 남길 의견이 있을 때"로 바꿔 억지 선택을 막는다.

**소비자 영향 (전수)**

| 파일 | 영향 | 조치 |
|---|---|---|
| `slack/format/pull-request-review.formatter.ts:5-18,30` | `Record` 두 개가 컴파일 에러 | `unknown: '⚪ UNKNOWN'`, `undetermined: '⏸ 판단 보류'`. 보류면 사유 한 줄 추가 |
| `slack/format/pr-review-sweep.formatter.ts:164` | `?? '⚪'` 폴백이 있어 깨지지 않음 | `RISK_ICON`에 `unknown` 명시 |
| `pr-review-loop/domain/publish-outcome.type.ts:15` | `riskLevel: string` | 없음 |
| `pr-review-loop/application/sweep-pr-reviews.usecase.ts:412-422` · `domain/finding-comment.body.ts` | findings 0건이면 PR에 "지적 사항 없음 — 머지 전에 고칠 것을 찾지 못했습니다" 코멘트를 **게시한다**. 판단 보류 리뷰도 이 경로를 탄다 | 판단 보류면 같은 마커로 시작하는 "판단 보류 — <이유>" 코멘트로 바꾼다(게시 횟수는 그대로). 설계 초안에서는 "게시하지 않는다"로 잘못 적었고 구현 중에 발견했다 |
| `agent-registry/agent-contract.ts:244` | `approvalRecommendation` 존재만 검사 | 없음. R1·R4와 겹치지 않는다 |
| `agent/code-reviewer/domain/prompt/pr-review.parser.ts` | 허용 집합·강제 규칙 | 위 규칙 구현 |
| 콘솔(Swift)·오피스 웹 | `riskLevel`/`approvalRecommendation` 참조 0건 (grep) | 없음 |
| 리뷰 재생(`review-replay.*`) | findings만 채점하고 승인 권고는 보지 않음 | 없음 (구현 때 재확인) |

**재호출**: 스윕은 PR당 1회라 새 규칙이 필요 없다. 같은 head에 대해 `undetermined`가 나와도 다시 리뷰하지 않는다. diff가 잘렸다는 사실은 같은 head에서 바뀌지 않기 때문이다.

### 3-3. 잠재의식 제안 — 상태값 둘 추가

```ts
export type ProposalStatus =
  | 'PENDING' | 'DISPATCHED'
  | 'DISMISSED'   // 사용자가 ❌ — 이 뜻으로만 쓴다
  | 'EXPIRED'     // TTL 초과로 코드가 닫음
  | 'SUPERSEDED'; // 스윕이 같은 PR 을 이미 리뷰해 코드가 닫음
```

| 경로 | 바뀌는 곳 |
|---|---|
| TTL 만료 | `subconscious-proposal.prisma.repository.ts:76` `'DISMISSED'` → `'EXPIRED'` |
| 스윕 대체 | `subconscious-proposal.service.ts:158` `'DISMISSED'` → `'SUPERSEDED'` |
| 사용자 ❌ | 그대로 |

- `hasProposedSince`는 상태를 가리지 않으므로 재제안 금지 기간 동작은 그대로다.
- `assertReadyToResolve`의 "이미 {status} 상태" 메시지에 새 값이 그대로 찍힌다. 버튼을 누른 사람에게 보이는 말이라 한국어 라벨로 바꾼다(`EXPIRED` → "만료된 제안", `SUPERSEDED` → "스윕이 이미 처리한 제안").
- 과거 62건은 소급 수정하지 않는다(범위 밖). 분석이 필요하면 `resolved_at - created_at ≥ 1430분`으로 근사 분류할 수 있다.

---

## 4. 학습 루프에 보류가 들어가는 방식

- 규약 재료는 `status='REJECTED' AND rejectReason IS NOT NULL`만 읽는다(`pr-review-finding.prisma.repository.ts:215-217`). 보류 카드는 OPEN이라 재료가 되지 않는다. 지금도 그렇고 설계 후에도 같다.
- "소수 1회가 다수를 덮는" 현상은 재호출이 있어서 생긴다. 입력 하나에 판정 하나로 묶으면 다수·소수가 생기지 않는다. 이번 두 건처럼 모델이 계속 틀리는 경우에는 기한 규칙(결정 요청 A)이 사람의 명시적 신호(👎 + 반박 답글)로 결론을 낸다.
- UNCLEAR·결과 누락은 종전대로 규약 재료에서 뺀다(`harvest-review-signals.usecase.ts:653-666` 주석의 판단 유지).
- 코드리뷰 `undetermined`는 지적 카드를 만들지 않으므로(findings 0건) 채택률·억제 학습에 들어가지 않는다. 채택률 분모에서도 빠진다.

---

## 5. 스키마와 `db:push`

| 대상 | 변경 | `db:push` |
|---|---|---|
| `pr_review_finding` | 컬럼 추가 `held_reply_hash text?`, `held_at timestamp?` | **필요** — 추가만 하고 삭제는 없어 `db-push-guard`를 통과한다. 수동 인덱스 3종은 push 전후로 대조한다(CLAUDE.md §6) |
| `agent_run.output` (코드리뷰) | JSON 안의 값만 늘어남 | 불필요 |
| `subconscious_proposal.status` | `String` 컬럼에 새 값 | 불필요 |

**머지 전제 조건 — `db:push` 먼저, 배포 나중.** 수확 경로는 카드를 읽을 때 새 컬럼을 조회하고, 모순 보류가 생기면 `markContradictionHeld`를 `await`로 기록한다. 컬럼이 없는 DB에 이 코드가 배포되면 조회가 실패하고, 보류가 생기는 순간 스윕 회차가 예외로 끊긴다. PR 본문에도 이 순서를 명시한다.

`db:push`는 공용 DB 규칙에 따라 메인 세션에 먼저 알리고 답을 받은 뒤, 최신 `origin/main` 위에서 한다. `investor-flow` worktree에 미커밋 스키마 변경이 있으니 순서를 조율한다.

---

## 6. 검증 계획 (구현 단계)

각 테스트는 가드를 빼면 실패해야 한다. 통과만 확인하면 그 테스트가 가드를 지키는지 알 수 없다.

1. **재시작 후 재호출 0**: 모순 보류 카드 픽스처로 `HarvestReviewSignalsUsecase` 인스턴스를 **새로 만들어**(재시작 모사) 두 회차 연속 실행 → 판정기 mock 호출 수 1. 컬럼 조회를 빼면 2가 되어 실패.
2. **기한 경과**: `held_at`을 73시간 전으로 둔 픽스처 → 판정기 호출 0, REJECTED 확정, `rejectReason` = owner 답글 원문.
3. **입력 변화**: 답글 지문이 바뀐 픽스처 → 재판정 1회.
4. **코드리뷰 파서**: `undetermined` + `medium` 입력 → 저장값 `unknown`. `undetermined` + 빈 사유 → 사유 미기재로 보정. `unknown` + `comment` → `undetermined`로 보정(지적은 유지). `undetermined` + mustFix 1건 → `request_changes`. 보정 경로마다 알림 1회, 짝이 맞으면 0회.
5. **포매터**: `undetermined` 결과가 "⏸ 판단 보류"와 사유로 렌더되는지.
6. **잠재의식**: 만료 → `EXPIRED`, 스윕 대체 → `SUPERSEDED`, ❌ → `DISMISSED`로 서로 다른 값이 남는지.
7. 게이트: `pnpm lint:check && pnpm test && pnpm build`.

앱을 띄워야만 확인되는 것(실제 스윕 회차에서 Slack 요약 문구)은 미검증으로 남기고 메인 세션에 요청한다.

---

## 7. 결정 요청

- **A. 모순 보류의 기한 처리** — 권고: 72시간 뒤 리액션대로 REJECTED 확정 + owner 답글을 기각 사유로 저장. 근거: 확인된 두 건 모두 👎 쪽이 사람의 뜻과 맞았고, 반대 사례(카드 57, 👎 오조작)는 사람이 72시간 안에 👎를 지우면 막힌다. 대안은 기한 없이 사람 결정만 기다리는 것인데, 결정 수단(CLI 등)을 새로 만들어야 하고 그 사이 PR이 닫히면 STALE로 끝나 기각 사실이 사라진다.
- **B. 기한 길이** — 72시간을 권고. 주말을 넘길 수 있는 최소값으로 잡았다.
- **C. 체크포인트 이관 범위** — 권고: 모순 보류만 DB로 옮긴다. 답글 UNCLEAR·해소 판정 체크포인트는 반복 피해가 확인될 때 같은 패턴으로 옮긴다.

## 8. 범위 밖 · 인접 발견 (보고만)

- **판정기 프롬프트 오독**: "확인했고/취지는 맞지만"으로 시작하는 반박을 수용으로 읽는다(#1118 13회, #860 7회). 판정 프롬프트 품질 문제라 이 설계에서는 다루지 않는다. 이 설계가 들어가면 오독은 "1회 오독 후 72시간 보류"로 줄어들 뿐 없어지지는 않는다.
- **run 1970의 대상 불일치**: 콘솔 원격 경로(`REMOTE_CONSOLE_CODE_REVIEWER`)의 `prRef`는 `DDD-13-WEBBB_BE#79`였는데, 모델은 입력 어딘가에서 `DDD_BE#87`을 요청 대상으로 읽었다. 같은 PR로 run 1968도 있었고, 6분 뒤 사용자가 Slack 멘션으로 `DDD_BE#87`을 다시 요청했다(run 1972). 콘솔이 지시문과 다른 PR을 골라 넘긴 라우팅 문제로 보이며, 원인은 확인하지 못했다. 이 설계는 그런 결과가 등급을 억지로 채우지 않게 할 뿐이고, 잘못 고른 PR 자체는 고치지 않는다.
- **diff 50KB 잘림 자체**: 9/8 문서 2·3단계에서 별도로 진행 중이다.
- **과거 판정 소급 수정**: 하지 않는다.
- **메인 트리 미커밋 변경과 겹침**: `pr-review.parser.ts`에 소유 미확정인 미커밋 변경(JSON 추출 유틸 교체)이 있다. 3-2 구현이 같은 파일의 다른 부분(허용 집합·검증)을 건드리므로, 그 변경이 먼저 머지되면 그 위에 얹는다.
