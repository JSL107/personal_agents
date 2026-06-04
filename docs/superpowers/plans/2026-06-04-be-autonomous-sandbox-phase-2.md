# BE 자율 개발 — Phase 2 Plan

작성일: 2026-06-04
저자: 이대리 (Claude Code, 사용자 위임 autonomous mode)
선행: PR #60 (Phase 1a 자연어 Y/N → PreviewGate apply)
관련: `src/sandbox/` (Docker scaffold 완료), `src/agent/be/` (텍스트 plan 출력 완료)

## 동기

사용자 피드백 — "이대리가 계속 계획만 알려주는데 자율 개발이 되길 원한다". 현재 BE 도메인 (PM/BE/BE_SCHEMA/BE_TEST/BE_FIX/BE_SRE) 은 모두 **proposal-only** — 텍스트로 plan / diff 후보 / 테스트 spec 을 출력하고 사용자가 받아 직접 적용.

## 목표 (Phase 2 완료 시 가능해지는 것)

| 사용자 입력 | 봇 동작 |
|---|---|
| "결제 검증 API 추가해줘" | BE plan 생성 → sandbox 안 codex 가 patch 작성 → `pnpm test` 통과 확인 → "PR 만들까요?" |
| "응" | 새 branch 생성 + commit + push + GitHub PR open → URL 반환 |
| "아니" | 변경 discard, 일반 dispatch 로 fall through |

## Phase 분해 (각 PR 별 1주 분량)

### Phase 2a — BE worker 출력 + sandbox 검증 (1주)

**범위**: BE worker 가 `BackendPlan` 출력하면 **사용자 ✅ 시점에 sandbox 안에서 codex 가 plan 을 patch 로 변환 + test 실행**. PR push 는 X. 사용자에게 patch + test 결과만 보고.

#### 신규 컴포넌트
- `PreviewKind.BE_SANDBOX_APPLY` enum 값
- `BeSandboxPatchApplier` (PreviewApplier) — apply 시 다음 흐름:
  1. payload 에서 `{ planText, repoFullPath, baseBranch }` 추출
  2. RunSandboxUsecase 로 codex 컨테이너 spawn — mount: host repo (`ro`) → tmp work tree (`rw`)
  3. codex 에게 plan + 시스템 prompt ("이 plan 을 unified diff 로 작성. 새 파일 만들기 + 기존 파일 수정 OK. 외부 명령 / 네트워크 호출 X.")
  4. 받은 diff 를 `git apply` 으로 work tree 에 적용
  5. `pnpm install` (필요 시 cache mount) + `pnpm test` + `pnpm build` 실행
  6. 결과 캡처 — `{ diff, testResult, buildResult }` 반환
- `BeAgentDispatcher` 갱신 — output 에 PreviewGate preview 첨부 (kind=BE_SANDBOX_APPLY, payload 위 형식)

#### 보안
- sandbox = `network: none` + `mountMode: rw on tmp` + `ro on host repo`
- codex CLI 인증은 host 에서 진행 — sandbox 안 codex 호출은 **별도 ephemeral CODEX_HOME** 또는 ChatGPT API 직접 호출 검토
- 사용자 키체인 노출 회피: sandbox 안에서 외부 API 호출 X 가 원칙. 단, codex CLI 가 호출하는 OAuth refresh 가 sandbox 안에서 가능한지 검증 필요 — 안 되면 host 에서 patch 생성 → sandbox 에서 검증만 분리

#### 테스트
- `BeSandboxPatchApplier.spec.ts` — mock RunSandboxUsecase, plan → diff 변환 + test 통과/실패 분기
- e2e (선택): 실제 sandbox + 작은 plan 으로 통합 검증

### Phase 2b — GitHub PR push (1주)

**범위**: Phase 2a 의 test 통과 결과 위에 추가 PreviewGate 단계 — 사용자 ✅ 시 GitHub branch + commit + PR.

#### 신규 컴포넌트
- `PreviewKind.BE_SANDBOX_PUSH_PR` — Phase 2a result 위에 chain
- `BeGithubPushApplier`:
  1. octokit `repos.getBranch` 로 base branch HEAD SHA 확인
  2. `git.createRef` 로 새 branch (`feat/idaeri-<slug>`)
  3. patch 의 각 파일 → `repos.createOrUpdateFileContents` (또는 `git.createTree` + `git.createCommit` + `git.updateRef` chain)
  4. `pulls.create` 로 PR open
  5. PR URL 반환
- `BeAgentDispatcher` 가 Phase 2a result 후 Phase 2b preview 자동 첨부

#### 보안
- 사용자 GITHUB_TOKEN scope 확인 — `repo` 필요
- main branch 직접 push X — 항상 새 branch + PR
- PR description 에 "이대리 자동 생성" 표시 + agentRunId footer
- bot 본인 머지 X — PR open 만, 머지는 사용자 명시

### Phase 2c — Self-correction loop (1주)

**범위**: Phase 2a 의 test 실패 시 자동 재시도 (max 3회).

#### 신규 컴포넌트
- BeSandboxPatchApplier 에 retry 루프:
  1. test 실패 → 실패 로그 + 직전 diff 를 codex 에게 다시 주고 "이 patch 가 테스트 N개 실패. 실패 로그 분석 후 fix"
  2. 새 diff → 재적용 + test
  3. max 3회까지. 마지막 시도도 실패 → 사용자에게 "3회 retry 실패, 직접 검토 요" + 가장 최근 diff
- cost cap — env `BE_SANDBOX_RETRY_BUDGET_MS` 같은 walltime 제한 추가

## 보류 — Phase 2 진행 전 사용자 확인

1. **Codex CLI in sandbox**: 가능 여부 검증 — sandbox 안 throwaway CODEX_HOME 으로 codex 실행 가능한가? 아니면 ChatGPT API key 별도 발급 후 사용?
2. **GitHub PR auto-open**: 사용자가 자동 PR 권한 부여할 의향?
3. **Budget cap**: 자동 sandbox 실행 → 비용 폭주 우려. 사용자별 일일 sandbox 호출 cap 설정 필요한지?

## 진행 순서

1. 본 plan 사용자 검토 + 의문점 보류 항목 합의
2. Phase 2a 첫 PR — design 확정 후 코드 시작
3. Phase 2b — Phase 2a 머지 후
4. Phase 2c — Phase 2b 머지 후 (선택적, cost 분석 후)

## 비고

본 plan 은 사용자 명시적 위임 (`알아서 이제부터 나한테 묻지말고 작업 진행`) 후 작성. Phase 2 자체는 multi-week scope 라 본 plan doc + scaffold 진입까지만 단일 세션에서 가능. 코드 변경은 Phase 2a 첫 PR 시점부터.
