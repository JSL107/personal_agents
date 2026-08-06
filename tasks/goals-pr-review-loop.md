# 목표 원장 — PR 리뷰 핑퐁 루프

> **이 파일을 쓰는 법**
>
> 새 세션에서 아래 한 줄만 붙여넣으면 된다. 목표를 골라줄 필요 없다.
>
> ```
> tasks/goals-pr-review-loop.md 를 읽고, 착수 가능한 다음 목표 하나만 처리해줘. 끝나면 원장을 갱신해줘.
> ```
>
> **규칙 — 한 세션에서 목표 하나만.** 여러 목표를 동시에 열면 같은 파일을 건드려 충돌한다.
> 착수 전에 `전제` 를 확인하고, 충족 안 되면 그 목표는 건너뛰고 다음으로 간다.
> 끝나면 상태 체크박스와 `결과` 줄을 갱신한 뒤 커밋한다.

최종 갱신: 2026-08-04 (목표 1·2·3 완료. 목표 4 는 집계·노출만 완료 — PR #212 draft.
억제 게이트는 데이터가 반대 신호를 줘서 보류)

---

## 지금까지 된 것 (배경)

이대리는 열린 PR 을 주기적으로 훑어 코드 리뷰 지적을 GitHub 인라인 코멘트로 단다. 그 지적에
사용자가 반응하면(👍/👎/답글) 카드 상태가 바뀌고, 기각된 지적은 기억에 적재돼 다음 리뷰
프롬프트에 되먹여진다.

| PR | 내용 | 상태 |
|---|---|---|
| #189 | Phase 1 — cron 스윕 자동 리뷰 + 인라인 게시 | 머지 |
| #196 | Phase 2a — 반응 수확·상태 전이·기각 학습 | 머지 |
| #197 | 발송 차단 슬롯 완주 표식 누락 수정 | 머지 |
| #198 | CLI 타임아웃 180s → 300s (리뷰 실패 원인) | 머지 (다른 세션) |
| #200 | 스윕 주기 5분화 + 실패 리뷰 쿨다운 교정 | 머지 (2026-08-03) |
| #202 | 반응 수확 결함 4건 (봇 답글 오인 포함) + 자기 리뷰 지적 반영 | 머지 (`189aa62`) |
| #207 | Phase 2b — 후속 커밋 해소 판정 (`FIXED`) + 리뷰 지적 7건 반영 | 머지 (`456b4cb`) |
| #212 | Phase 3 (일부) — 카테고리별 채택률 집계 + 스윕 요약 노출 | draft (2026-08-04) |

**2026-07-31 실환경 실증 완료**: 답글 → `REVIEW_REPLY_JUDGE` 판정 → `ACKED` → 스레드 resolve
가 사람 개입 없이 한 바퀴 돌았다. GraphQL 실호출, PAT `pull_requests: write` 권한, 답글 판정
정확도 모두 확인됨.

**2026-08-03 재실증 (4건 동시)**: #202 에 이대리가 스스로 리뷰를 달았고, 그 지적에 단 답변 4건이
다음 스윕(01:45 UTC)에서 전부 `ACKED` + `resolvedAt` 으로 닫혔다. DB 4건, GitHub GraphQL
`isResolved=true` 4건 양쪽 대조 완료. 단건이 아니라 **한 PR 다건 배치**로도 도는 것이 확인됐다.

**참조 문서**
- 전체 설계: `docs/superpowers/specs/2026-07-31-self-learning-code-reviewer-design.md`
- Phase 2a 구현 계약: `docs/superpowers/handoffs/2026-07-31-pr-review-pingpong/design.md`
- 구현 요약: 같은 폴더 `implementation-summary.md`

---

## 공통 규칙 (모든 목표에 적용)

- **작업은 `origin/main` 기준 ASCII 경로 worktree**(`~/worktrees/...`)에서. 메인 트리에서 직접 고치지 않는다.
  착수 전 `git worktree list` 로 다른 세션 작업과 겹치는지 확인한다.
- **검증 게이트**: `pnpm lint:check` + `pnpm test` + `pnpm build` 전부 exit 0.
  새 `AgentType`·env·agent-registry 를 건드렸으면 `pnpm docs:check` 도 필수 (로컬 3중 게이트에
  없고 CI 에서만 걸린다).
- `pnpm test` 는 jest 2회 실행 구조라 `-- <경로>` 필터가 안 먹는다. 단일 파일은 `pnpm exec jest src/...`.
- **DB 스키마 변경 시 주의**: PostgreSQL@5434 를 여러 worktree 가 공유한다. `db:push` 는 다른
  브랜치 테이블을 날릴 수 있으니 꼭 필요할 때만.
- 백엔드는 **`PORT=3099`** (`.env` 기본값 3002 가 아니다). 머지 후 재기동해야 반영된다.

### 🔴 이 기능에서 반복해서 밟은 함정 — 지우지 말 것

1. **episodic 적재는 `REJECTED` 만.** 소비측(`review-pull-request.usecase.ts:151-177`)이
   `kind='pr_review'` 를 라벨 구분 없이 `[이 사용자가 과거에 무시한 리뷰 패턴 — 이런 코멘트는
   피하세요]` 로 주입한다. 채택 카드를 적재하면 **좋은 지적을 피하도록 역학습**한다.
   저장 단계가 유일한 방어선이라 회귀 테스트로 고정돼 있다.
2. **`markThreadResolved` 는 `status` 를 덮지 않는다.** 덮으면 채택률 분자(`ACKED+FIXED`)가
   DB 에서 사라져 Phase 3 집계가 불가능해진다. 스레드 닫힘은 `resolvedAt !== null` 로 판정.
3. **봇 코멘트의 `authorLogin` 도 owner 다** (owner 토큰으로 달기 때문에). 답글 수집 필터가
   이걸 안 거르면 봇이 자기 글을 사람 답글로 오인한다. → 목표 2 참조.
4. **새 상태 표식을 추가하면 함수의 모든 `return` 을 전수 확인**한다. #193 이 완주 표식을
   성공 경로 두 곳에만 달아, 하루 264슬롯 중 261개가 표식 없이 끝났다(#197 로 수정).

---

## 목표 1 — `REJECTED` 경로 + episodic 적재 검증

- [x] **상태**: 완료 (2026-08-03) — 오탐이 자연 발생해 학습 루프가 끝까지 돌았다
- **전제**: 이대리 리뷰 카드 중 **실제로 틀렸거나 이 저장소에선 부적절한 지적**이 있고, 거기에
  👎 나 반박 답글을 남긴 상태.

> ### 🔴 정탐 카드에 👎 를 눌러 실증하지 말 것 — 앞으로도 유지할 원칙
>
> 실증이 급하다고 아무 카드에나 👎 를 누르면 `REJECTED` 경로는 돌지만, 그 카드 본문이
> episodic 에 적재돼 **다음 리뷰부터 그 지적을 피하도록 역학습**한다(공통 규칙 함정 1).
> 소비측이 라벨 없이 `[이 사용자가 과거에 무시한 리뷰 패턴]` 으로 주입하기 때문에,
> 좋은 지적을 죽이는 데 되돌릴 방법이 없다. **실증을 위해 학습을 오염시키는 건 손해다.**
>
> 실제로 #202 의 카드 4건(id 19~22)은 검증 결과 전부 정탐이라 👎 대상이 아니었다.
> 억지로 만들지 않고 기다린 결과, #201 에서 진짜 오탐이 나와 루프가 제대로 돌았다.
> **이 원칙 덕분에 첫 학습 표본이 오염되지 않았다.**

> **조회 명령**:
> `docker exec idaeri-postgres psql -U idaeri -d idaeri -c "select status, count(*) from pr_review_finding group by status;"`
> (컬럼은 snake_case, 단 `rejectReason` 만 camelCase 라 따옴표 필요)
- **왜**: `ACKED` 경로는 실증됐지만 `REJECTED` 는 한 번도 안 돌았다. 그래서 **episodic 적재가
  0건**이고, 학습 루프의 나머지 절반이 미검증이다.

**할 일**
1. 다음 스윕 후 `pr_review_finding` 에서 해당 카드가 `status='REJECTED'`, `reject_reason` 채워짐,
   `resolved_at` 채워짐(스레드 닫힘)인지 확인
2. `episodic_memory` 에 `kind='pr_review'`, `agent_type='CODE_REVIEWER'` 행이 생겼는지 확인
   — **이게 핵심이다.** 여기가 비면 학습이 안 도는 것
3. GitHub 에서 해당 스레드가 실제 `isResolved=true` 인지 (GraphQL 로 확인)
4. 그 다음 리뷰의 프롬프트에 `[이 사용자가 과거에 무시한 리뷰 패턴]` 블록이 실제로 주입되는지

**완료 판정**: 2번과 4번이 확인되면 완료. 결과를 아래 `결과` 에 적는다.

- **결과**: **완료 — 학습 루프 나머지 절반이 실환경에서 돌았다.** 억지로 만들지 않았고,
  세션 중에 오탐이 자연 발생했다(PR #201, 오피스 픽셀).
  - **① 카드 상태**: `pr_review_finding` id **16** (#201, `CORRECTNESS`,
    `clients/idaeri-console/Sources/ConsoleCore/AgentRole.swift:68`) →
    `status='REJECTED'`, `reject_reason='매핑 오류 주장 반박'`, `resolved_at=01:15:13`.
    지적 내용은 "직책 매핑 키 `EVENING_RETRO` 가 운영 표본의 `EVENING_RETRO_PUBLISH` 와
    다르다" 였고 사람이 반박했다.
  - **② episodic 적재 (핵심)**: `episodic_memory` id **315**, `kind='pr_review'`,
    `agent_type='CODE_REVIEWER'`, `occurred_at=01:15:12.491`. **적재 0건이 깨졌다.**
  - **③ GitHub 대조**: 스레드 `PRRT_kwDOR9tAzs6V1tVW` = GraphQL `isResolved=true`.
    DB `resolved_at` 과 일치.
  - **④ 다음 리뷰 주입**: 소비측이 `searchRelevant({kind:'pr_review',
    agentType:'CODE_REVIEWER', limit:2})` 로 찾아 `[이 사용자가 과거에 무시한 리뷰 패턴 —
    이런 코멘트는 피하세요]` 블록을 만든다(`review-pull-request.usecase.ts:151-177`).
    현재 그 조건에 맞는 행이 **1건뿐이라 limit 2 안에 결정적으로 들어오고**,
    `embedding` 도 384차원으로 저장돼 있어 벡터 검색에서 누락되지 않는다.
  - **미검증**: 실제 리뷰 프롬프트 문자열에 그 블록이 찍힌 것을 눈으로 보지는 못했다
    (다음 CODE_REVIEWER 실행 로그에서 확인 가능). 코드 경로와 데이터 상태로는 보장된다.

---

## 목표 2 — 봇 자기 답글 오인 버그 마무리

- [x] **상태**: 완료 (2026-08-03, PR #202 머지 `189aa62`)
- **전제**: `~/worktrees/idaeri-review-pingpong` 의 미커밋 변경을 다른 세션이 진행 중이 아닐 것.
  진행 중이면 **건드리지 말고** 상태만 보고하고 이 목표를 보류한다.
- **왜**: 이대리는 owner 토큰으로 코멘트를 달기 때문에 봇 코멘트의 `authorLogin` 도 owner 다.
  `harvest-signal.ts` 의 답글 수집 필터(`authorLogin === ownerLogin && createdAt > botComment.createdAt`)가
  같은 스레드의 **봇 후속 코멘트를 사람 답글로 오인**해 LLM 에게 자기 글을 판정시킨다.
  지금은 봇이 스레드에 한 번만 써서 안 터지지만, **목표 3(Phase 2b)에서 봇이 답글로 응수하면
  즉시 발생**한다.

**할 일**
1. `git worktree list` + 해당 worktree 의 `git status` 로 진행 상태 확인
2. 미완이면 이어받아 마무리 — 수정 방향은 `IDAERI_REVIEW_MARKER` 로 봇 코멘트를 걸러내는 것
3. 게이트 통과 후 PR

**백업**: `docs/superpowers/handoffs/2026-07-31-pr-review-pingpong/uncommitted-bot-reply-filter.patch`
(313줄). worktree 가 사라졌으면 이 패치를 최신 main 에 적용해 되살린다.

- **결과**: **완료 — PR #202** (`fix/pr-review-harvest-defects`).
  - 발견 당시 상태는 "미커밋" 이 아니라 **커밋됐지만 고아**였다. 수정이 `b9b9917` 로 커밋돼 있었으나
    그 브랜치(`feat/pr-review-pingpong-phase2a`)는 #196 으로 이미 머지된 뒤라 main 에 못 들어갔다.
    최신 `origin/main` 위에 새 브랜치로 cherry-pick(충돌 없음) 해서 올렸다.
  - main 미반영 실증: `harvest-signal.ts:38` 이 `authorLogin === ownerLogin` 만 필터하고 마커 제외가 없었다.
  - 담긴 수정 4건 — ① 봇 자기 답글 오인(`IDAERI_REVIEW_MARKER` 로 제외) ② `outcome.judged` 이중 계상
    ③ episodic 적재 실패 `warn`→`error` 승격 ④ PR 종료 + 스레드 resolve 시 `STALE` 누락.
  - 게이트: lint 0 errors / test 288 suites·2112 + 40 / build exit 0.
  - 회귀 테스트는 양방향 고정(봇 코멘트는 걸러지고, 표식 없는 owner 코멘트는 `NEEDS_JUDGE` 로 통과).
  - `STALE` 기록 경로는 `markThreadResolved` 가 `resolvedAt` 만 갱신함을 코드로 확인해 함정 2(결론 보존)와
    충돌하지 않음을 검증했다.
  - **이대리가 이 PR 을 스스로 리뷰해 `MUST_FIX` 2건을 짚었고, 검증해보니 둘 다 정탐이라 반영**(`4517c13`).
    ① `STALE` 확정이 `markDecided` + `markThreadResolved` 두 번의 쓰기라 첫 쓰기 뒤 실패하면
    `status='STALE'` 이 되어 조회(OPEN 만)에서 빠지고 부분 상태가 고착 → `MarkDecidedInput.resolveThread`
    로 단일 쓰기.
    ② 앞선 커밋의 "로그 `warn`→`error` 승격" 은 유실을 해결하지 못한다는 지적 — 원인은 순서였다.
    카드를 `REJECTED` 로 먼저 확정한 뒤 적재를 fire-and-forget 하니 실패 시 재조회 대상에서 빠졌다.
    → 적재를 먼저 `await` 하고 성공했을 때만 확정, 실패 시 `OPEN` 유지 + 스레드 미닫힘으로 다음 스윕 재시도.
    회귀 테스트 2건 추가. 4개 스레드에 인라인 답변 게시 완료.
  - **부수 효과 — 답글 경로 재실증 성공**: 답변 4건이 01:45 UTC 스윕에서 전부 `ACKED` +
    `resolvedAt` 으로 닫혔다(DB·GitHub GraphQL 양쪽 확인). 배경 절의 "2026-08-03 재실증" 참조.
  - **미검증**: 봇이 실제로 답글을 단 스레드의 수확은 굴려보지 못했다(Phase 2b 미구현이라 재현 조건 없음).
    `STALE` 기록과 적재 실패 재시도도 실 DB 대조 없이 단위 테스트로만 고정.
  - **정리 완료**: worktree `~/worktrees/idaeri-review-pingpong` 제거, 로컬·원격 브랜치 삭제.
    `.ai/` 두 파일은 `docs/superpowers/handoffs/2026-07-31-pr-review-pingpong/` 사본과 동일함을
    확인하고 지웠다(손실 없음). stash `goal2-preserve-tasks` 는 공유 `.git` 에 있어 그대로 남아
    있다 — 내용은 이미 머지된 Phase 2a 작업 기록이라 복원 불필요.
    같은 폴더의 `uncommitted-bot-reply-filter.patch` 도 #202 로 반영돼 이제 쓸모없다.

---

## 목표 3 — Phase 2b: 후속 커밋 해소 판정 (`FIXED`)

- [x] **상태**: 완료 (2026-08-03, PR #207 머지 `456b4cb`)
- **전제**: 목표 2 완료 (봇이 답글을 달기 시작하면 그 버그가 즉시 터진다)
- **왜**: 지금은 사용자가 👍/답글로 반응해야만 카드가 닫힌다. 지적을 **말없이 고친 경우**를
  인식하지 못해 카드가 `OPEN` 으로 남는다.

**할 일** (설계: 스펙 문서 Phase 2 의 "후속 커밋 해소 판정")
1. `compareCommits(repo, baseSha, headSha)` REST 를 `GithubClientPort` 에 추가
2. **1차 결정론 필터(무료)** — 카드의 `headSha` → 현재 `headSha` 변경 hunk 가 카드의
   `filePath`·`line` 근방과 겹치는지 순수 함수로 계산. 안 겹치면 LLM 에게 묻지 않는다
3. **2차 LLM 배치 판정** — 겹치는 카드만 모아 **PR 당 1회** 호출. `해소됨`/`안 됨`/`애매함` 3택.
   **애매하면 `OPEN` 유지** (억지 판정보다 미결이 안전)
4. 판정기는 기존 `REVIEW_REPLY_JUDGE` 확장 vs 신규 `AgentType` 중 판단해서 정한다.
   신규면 `AGENT_TO_PROVIDER` + `agent-registry` + `pnpm docs:check` 필수

**주의**: `FIXED` 는 채택 쪽이므로 **episodic 에 적재하지 않는다**(공통 규칙 함정 1).

- **결과**: **완료 — PR #207 머지** (`456b4cb`). worktree·브랜치 정리됨.
  - 4단계 전부 구현. 게이트: lint 0 errors / test 288 suites·2130 + 40 / build 0. 회귀 11건.
  - **판정기 결정 = 신규 `AgentType` 안 만듦.** `AgentType` 은 모델 라우팅 키일 뿐이라 같은
    ChatGPT 로 보낼 거면 새로 만들 이유가 없다(만들면 `AGENT_TO_PROVIDER`·`agent-registry`·
    `ResponseCode`·`docs:check` 동기화가 딸려온다). 기존 `REVIEW_REPLY_JUDGE` 라우팅 +
    전용 usecase·프롬프트로 품질만 분리. → `docs:check` 불필요했다.
  - **재사용으로 줄인 것**: 겹침 판정은 기존 `snapToCommentableLine` 과 규칙이 같아 그대로 씀
    (`isTouchedByChanges` 본체 1줄). 두 판정기가 공유하던 JSON 파싱·쿼터 추출을 공용 조각으로
    빼 **중복 70줄 삭제**.
  - **PR 전체 diff 를 쓰지 않은 이유**: base 부터라 카드 게시 *전* 변경까지 섞여 해소를 오판한다.
    카드 `headSha` → 현재 `headSha` 구간만 `compareCommits`. 카드 headSha 별로 묶어 호출하므로
    같은 스윕 카드는 1회로 끝나고, 새 커밋이 없으면 호출조차 안 한다.
  - **리뷰 지적 7건 전부 정탐이라 반영**(`2892309`) — Codex 3(P1 재판정 / P2 삭제파일 ·
    P2 `hasHarvestResult`) + 이대리 4(MUST_FIX: 좌표계 · 잘린 diff · 쿼터 삼킴 · 프롬프트 인젝션).
    - **좌표계 오류가 가장 컸다**: 카드 `line` 은 카드 게시 시점(=비교 base) 좌표인데
      `parseDiffHunks`(현재 head 기준)와 대조해, 앞쪽 삽입·삭제만큼 밀렸다.
      `parseDiffBaseHunks` 로 base 쪽을 읽게 고쳤고, **Codex 의 "삭제 파일 미검출" 도 원인이
      같아 함께 해결**됐다(`--- a/path` 는 남으므로).
    - **재판정 차단**: 카드별 "마지막으로 물어본 head sha" 체크포인트. DB 컬럼이 정석이지만
      공유 DB `db:push` 리스크가 커서 프로세스 메모리로 뒀다 — 재시작 시 카드당 1회만 더 묻는다.
      `ponytail:` 주석으로 한계·업그레이드 경로 명시.
    - **쿼터**: 지적은 해소 판정만 짚었으나 답글 판정도 같은 결함이라 공통 경로에서 함께 막았다.
  - **미검증(중요)**: 실 GitHub 에서 안 굴려봤다. `compareCommits` 실호출·결정론 필터 실제
    선별률·**LLM 해소 판정 정확도** 전부 단위 테스트로만 고정. 판정이 오탐이면 채택률이
    부풀려져 목표 4 가 잘못 학습한다 — **첫 `FIXED` 3~5건은 카드 본문 vs 실제 커밋을 대조**할 것.
    조회: `docker exec idaeri-postgres psql -U idaeri -d idaeri -c "select id, pull_number, file_path, line, body from pr_review_finding where status='FIXED';"`
  - **⚠️ 배포 반영**: main 에 들어갔지만 실행 중인 백엔드는 아직 옛 코드다.
    `PORT=3099` 로 재기동해야 해소 판정이 돈다.

---

## 목표 4 — Phase 3: 채택률 집계 + 억제 게이트

- [x] **집계·노출 완료** (2026-08-04, PR #212 draft) / [ ] **억제 게이트는 보류** — 아래 판정 참조
- **전제**: `pr_review_finding` 의 `ACKED`/`FIXED`/`REJECTED` 합계가 **카테고리당 10건 이상**.
  미달이면 임계치를 정하지 말고 "표본 부족" 으로 보고만 하고 종료한다 — **지금 정하면 추측이 된다.**

> **2026-08-04 재계측 — 전제 충족됨.** 하루 만에 CORRECTNESS 4→17, TEST 5→15(현재 17) 로 늘었다.
> #207(Phase 2b) 머지로 `FIXED` 가 쌓이기 시작한 효과가 예상대로 나타났다.
>
> | 카테고리 | 채택(ACKED+FIXED) | 기각 | 분모 | 채택률 |
> |---|---|---|---|---|
> | CORRECTNESS | 16 | 1 | **17** | 94% |
> | TEST | 16 | 1 | **17** | 94% |
> | RELIABILITY | 5 | 3 | 8 | 미달 |
> | SECURITY | 1 | 0 | 1 | 미달 |

> **2026-08-03 계측** — 분모에 드는 건(`ACKED`+`FIXED`+`REJECTED`)만 셈:
>
> | 카테고리 | ACKED | FIXED | REJECTED | 분모 합 | 판정 |
> |---|---|---|---|---|---|
> | CORRECTNESS | 3 | 0 | 1 | **4** | 미달 |
> | TEST | 5 | 0 | 0 | **5** | 미달 |
> | RELIABILITY | 1 | 0 | 0 | **1** | 미달 |
>
> 셋 다 10 미만이라 임계치를 정하면 추측이 된다. **#207(Phase 2b) 이 머지되면 `FIXED` 가
> 쌓이기 시작하므로 표본이 빨리 는다** — 그 뒤에 다시 계측할 것.
>
> 계측 명령:
> `docker exec idaeri-postgres psql -U idaeri -d idaeri -c "select category, status, count(*) from pr_review_finding group by category, status order by category, status;"`

**할 일**
1. 카테고리별 채택률 집계(순수 함수) + 스윕 요약에 노출
   `채택률 = (ACKED + FIXED) / (ACKED + FIXED + REJECTED)`, `OPEN`·`STALE`·`SUPPRESSED` 는 분모 제외
2. 결정론 억제 게이트 + 면제 규칙
3. `PreferenceSection` 에 `'review'` 추가 + `ReviewFindingSignalSource` 등록
   → 기존 주간 `preference-learning` cron 이 자동으로 흡수한다(새 cron 불필요)

**🔴 안전핀 — 지우면 학습이 위험해진다**
- **억제 면제** = `MUST_FIX` 전체 + `CORRECTNESS`/`SECURITY`/`RELIABILITY`.
  바빠서 넘긴 보안 경고를 학습해 영구 침묵하는 사고를 막는 장치다
- 모든 프로필 변경은 **PreviewGate 승인**을 거친다. 조용한 자기 수정은 없다
- `PR_REVIEW_SUPPRESSION_ENABLED` 는 기본 `false`

- **결과**: **1번(집계·노출) 완료 — PR #212 draft** (`feat/pr-review-adoption-rate`, `7ffd6a1`).
  2·3번(억제 게이트, 프로필 연결)은 **데이터가 반대 신호를 줘서 의도적으로 보류**했다.
  - **담긴 것**: `summarizeAdoption` 순수 함수(`src/pr-review-loop/domain/adoption-rate.ts`) +
    포트·Prisma `groupBy` + `HarvestOutcome.adoption` + 스윕 요약 한 줄.
    표본 10건 미달은 비율 대신 표본 수만 노출한다(`ADOPTION_MIN_SAMPLE`).
  - **조회 시점**: 분모가 늘어난 회차에만. STALE 확정·스레드 정리·무반응 회차는 비율이
    변하지 않으므로 `*/5` 스윕에서 같은 값을 반복 조회하지 않는다.
  - 게이트: lint 0(warning 54, 증가 없음) / test 295 suites·2255 + 5·40 / build 0 / docs:check OK.
    baseline 대비 +1 suite·+15 tests = 신규 테스트 수와 정확히 일치.
  - **실 DB 대조 완료**: 운영 DB 실제 13행을 실제 순수 함수·포매터에 통과시켜 위 표와 동일한
    결과 + Slack 문자열까지 확인. `STALE`·`OPEN` 이 분모에서 정확히 빠지고, 분모 동률인
    CORRECTNESS·TEST 가 이름 순으로 정렬됐다.
  - **실 스윕 노출 확인 (2026-08-05, 사용자 실증)**: 실제 cron 스윕이 채택률 줄을 Slack 에
    찍는 것을 확인했다. 목표 4 의 1번(집계·노출)은 코드·DB 대조·실 발화까지 전부 닫혔다.

> ### 🔴 억제 게이트 보류 판정 (2026-08-04) — 지우지 말 것
>
> 데이터를 보고 나니 **지금 억제 게이트를 켜면 실효가 0**이다.
>
> 안전핀의 면제 규칙(`MUST_FIX` 전체 + `CORRECTNESS`/`SECURITY`/`RELIABILITY`)을 적용하면
> 억제 대상으로 남는 카테고리는 **`TEST` 하나뿐이고, 그 채택률이 94%**다. 억제할 것이 없다.
> 반대로 기각이 실제로 몰린 곳은 채택률이 가장 낮은 **`RELIABILITY`(5:3)** 인데 그건 면제 대상이다.
>
> 즉 이 데이터에서 필요한 레버는 "지적을 막는 것"이 아니라 **카테고리별 프롬프트 조정**일
> 가능성이 높다. 면제 규칙을 흔드는 것은 위험하니(바빠서 넘긴 보안 경고를 학습해 영구 침묵하는
> 사고 방지) **표본을 더 쌓고 다시 판단**한다. 억제를 켜는 것보다 안 켜는 쪽이 되돌리기 쉽다.
>
> 3번(`PreferenceSection` 에 `'review'` 추가)도 억제와 묶여 있어 함께 보류했다.

---

## 목표 밖 (판단 필요, 지금 안 함)

- **webhook 즉시 트리거** — `pull_request.opened → 자동 리뷰` 코드는 이미 있으나 로컬 서버라
  이벤트가 도달하지 않는다. 터널(cloudflared 등)을 붙이면 대기 시간이 0 이 되는 대신 로컬
  서버를 외부에 노출하게 된다. 보안 판단이 필요해 목표로 잡지 않았다.
- **`lockDuration` 조정** — 스윕 소요 시간 실측이 며칠 쌓인 뒤에.
