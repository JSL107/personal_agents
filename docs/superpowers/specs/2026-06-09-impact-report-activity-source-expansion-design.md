# impact-report `--recent` 활동 소스 확장 (머지 PR + open PR)

- 작성일: 2026-06-09
- 상태: 설계 확정 (구현 진행)

## 배경 / 허들

매일 07:00 cron(`impact-report-cron`, `--recent` 모드)이 `IMPACT_REPORT_GITHUB_AUTHOR`가 **최근 N일간 머지한 PR**만 조회한다 (`listAuthorMergedPullRequestsSince`). 머지 PR이 0건이면 `RECENT_MODE_NO_RESULTS` → cron consumer가 "🪶 skip — 머지 PR 0건" 안내만 발송 ([consumer:62-76]). 즉 **"내가 머지한 PR이 있어야만" 임팩트가 추출**되는 허들. 머지 안 한 날엔 실제 리포트가 안 나온다.

**목표:** 머지 PR이 없어도 **진행 중(open) PR**이 있으면 임팩트가 나오게 — "내가 한 활동(머지 + 진행)" 기준으로 확장.

## 설계

### 1. GitHub client (`github.type.ts` + `octokit-github.client.ts` + port)
- `GithubPullRequestSummary` 확장 (하위호환 — 기존 머지 경로는 값 채움):
  - `state: 'merged' | 'open'` 추가
  - `updatedAt: string` 추가 (open/merged 공통 정렬 키)
  - `mergedAt: string | null` (open이면 `null`)
- 신규 `listAuthorOpenPullRequests({ repo, author, sinceIsoDate, limit })`:
  - Search: `is:pr is:open author:{author}` (+ `repo:` 한정, `updated:>={sinceIsoDate}`로 stale open 컷)
  - `listAuthorMergedPullRequestsSince`와 동일 패턴 (search → `pulls.get`로 additions/deletions/changed_files/body 보강).
  - `state:'open'`, `mergedAt:null`, `updatedAt = updated_at`.
- 기존 `listAuthorMergedPullRequestsSince`: `state:'merged'`, `updatedAt = updated_at` 채움.

### 2. usecase `executeRecentMode` (`generate-impact-report.usecase.ts`)
- 머지 + open 둘 다 조회 (`Promise.all` 병렬).
- 병합 후 합산 0건일 때만 `RECENT_MODE_NO_RESULTS` (open 포함이라 거의 발생 안 함 — 발생 시 consumer가 graceful 안내).
- evidence/inputSnapshot에 `mergedCount` + `openCount` 기록.

### 3. 프롬프트 `buildRecentModePrompt`
- `[머지 완료 N건]` + `[진행 중(open) M건]` 두 섹션 구분 → LLM이 "완료 임팩트 + 진행 중 임팩트"로 종합.
- 정량 합산도 머지/진행 분리 표기. open은 `mergedAt` 대신 `updatedAt` 표시.

### 4. cron consumer 문구 (`impact-report-cron.consumer.ts`)
- 이미 `RECENT_MODE_NO_RESULTS` graceful 안내 존재 — **문구만** "머지 PR 0건" → "머지·진행 중 PR 0건"으로, "다음 주" → 주기 무관 일반화.

### 5. 테스트
- octokit: open PR search 쿼리(`is:open author:`) + state/updatedAt 매핑.
- usecase: **머지 0 + open N → 추출 성공**(허들 제거 회귀 방지), 머지·open 둘 다 prompt 반영, 둘 다 0 → `RECENT_MODE_NO_RESULTS`.
- 프롬프트 빌더: 머지/진행 섹션 구분.

### 하위 호환
- `GithubPullRequestSummary` 필드 추가는 머지 경로가 모두 채우므로 기존 동작 유지.
- slash `/impact-report --recent`도 동일하게 open 포함 (cron과 usecase 공유).

검증: `pnpm lint:check && pnpm test && pnpm build` 3중 green.
