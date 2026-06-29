# docs-sync-audit Phase 2 설계 — 확정 제안 → docs PR 자동 개설 (T1_PREVIEW)

> 상태: 설계 승인됨 (2026-06-29). 후속: writing-plans 로 구현 plan 작성.
> 선행: Phase 1 (PR #120, merged) — Layer1 결정론 + Layer2 codex 자기수정 루프 (읽기 전용 T0_AUTO).

## 1. 목표 (What)

Phase 1 이 산출한 **확정 문서 수정 제안**(`confirmed: true`)을 사람 승인 게이트를 거쳐 **docs PR 로 자동 개설**한다. 완전 자동: optimizer 가 적용 가능한 편집을 생성 → 격리 적용·검증 → PreviewGate Slack 승인 → octokit 이 docs 브랜치+커밋+PR open (main 직접 push 절대 X).

**성공 기준:** `pnpm lint:check && pnpm test && pnpm build` 3중 green + `pnpm docs:check` OK. 부팅 시 플레이북 검증 통과. 승인 없이는 어떤 외부 쓰기도 발생하지 않음(PreviewGate 게이트). `DOCS_AUDIT_PR_ENABLED` 미설정 시 Phase 1 동작(텍스트 보고만) 그대로.

## 2. 핵심 설계 결정 (승인됨)

1. **완전 자동 docs PR** — `BE_SANDBOX_PUSH_PR` 패턴 미러(octokit 브랜치+커밋+PR, main push 금지).
2. **편집 표현 = search/replace** — optimizer 가 `{ filePath, oldString, newString }` 구조화 편집을 출력. 결정론 applier 가 문서에서 `oldString` 을 **정확·유일 매칭**해 치환(Claude Edit 도구 방식). 줄번호/context drift 없음. unified diff 는 적용본에서 `git diff` 로 산출.
3. **검증 게이트는 evaluator** — `docs:check` 는 *자동 생성* 카탈로그(agent-catalog/env-catalog)만 검증하므로 hand-curated 문서(README) 편집의 옳음을 잡지 못한다. 따라서 의미 검증은 Phase 1 루프의 evaluator(`confirmed:true`)가 담당. 격리 적용은 "search/replace 정확 매칭 + 실제 diff 산출 + 생성 카탈로그 비파손 확인"에 쓴다.
4. **대상 문서 = README.md 단일(1차)** — SoT→문서 매핑은 화이트리스트 상수로 시작. 생성 카탈로그(agent-catalog/env-catalog)는 대상 제외(Layer1 담당).
5. **riskTier = T1_PREVIEW 승격** — 완전 자동이지만 매주 PR 후보가 열린다. `DOCS_AUDIT_PR_ENABLED` 로 비활성 가능.

## 3. 데이터 흐름

```
GitChangedFilesProvider (최근 변경 SoT 파일)
  → 각 SoT 에 매핑된 targetDoc(README.md) 로드
  → optimizer(search/replace 편집 제안) ↔ evaluator(채점) 루프   [Phase 1 종료조건 3종 그대로]
  → confirmed 제안 모음
  → DocsRevisionApplier (격리, 순수):
       targetDoc 사본에 각 편집의 oldString 정확·유일 매칭 → newString 치환
       매칭 0건 또는 다중매칭 → 그 편집만 reject (나머지 진행)
       성공 → git diff 로 unified diff 산출 + changedFiles 목록
       (선택) docs:check 재실행으로 생성 카탈로그 비파손 확인
  → AutopilotTaskResult.preview = {
       kind: 'DOCS_AUDIT_PR',
       payload: { diff, rationale, changedFiles, baseBranch },
       previewText
     }
  → AutopilotOrchestrator (T1_PREVIEW 분기 신설):
       CreatePreviewUsecase 로 PENDING PreviewAction 생성
       → Slack 에 previewText + ✅apply / ❌cancel 버튼 (PREVIEW_ACTION_IDS)
  → 사용자 ✅
  → DocsAuditPrApplier implements PreviewApplier (kind DOCS_AUDIT_PR):
       octokit 으로 docs 브랜치 생성 + diff 의 changedFiles 커밋 + PR open
       → ApplyResult.message (PR URL), main 직접 push X
```

## 4. 컴포넌트 (신규/수정)

### 수정
- `src/docs-audit/domain/port/docs-audit.port.ts`
  - `OptimizerOutput`: `proposedDiff: string` → `edits: DocEdit[]` (`DocEdit = { oldString, newString }`) + `rationale`.
  - `DocsRevisionProposal`: `proposedDiff` → 적용 산출물(`diff`, `changedFiles`)로 확장 (confirmed 의미 유지).
- `src/docs-audit/domain/prompt/docs-audit.prompt.ts`
  - optimizer 출력을 search/replace JSON 으로: `{"needsRevision", "edits":[{"oldString","newString"}], "rationale"}`. evaluator 는 edits 가 코드 사실과 일치하는지 채점.
- `src/docs-audit/infrastructure/codex-docs-judge.adapter.ts`
  - `optimize` 파싱을 `edits[]` 로. evaluator 입력에 edits 전달.
- `src/docs-audit/application/run-docs-audit.usecase.ts`
  - `auditOneFile`: codeContext = SoT 파일, docExcerpt = **매핑된 targetDoc**(둘이 분리 — Phase 1 의 "같은 파일 2회" 골격 해소). confirmed 제안에 DocsRevisionApplier 호출 결과(diff/changedFiles) 부착.
  - SoT→targetDoc 매핑 상수 추가(화이트리스트).
- `src/autopilot/domain/autopilot-task.port.ts`
  - `AutopilotTaskResult` 에 `preview?: AutopilotPreviewRequest` 추가(`{ kind, payload, previewText }`). 기존 `{skip, slackText}` 호환.
- `src/autopilot/application/autopilot.orchestrator.ts`
  - `riskTier === 'T1_PREVIEW'` 분기: task 결과의 `preview` 가 있으면 CreatePreviewUsecase 호출 → 각 target 에 `slackNotifier.postPreviewMessage({ target, previewText, previewId })` 로 버튼 메시지 발송. preview 없으면 기존 텍스트 경로. T0_AUTO 는 그대로.
  - 한 run 에 confirmed 제안이 여러 건이어도 **1 PR 로 집계**(모든 편집을 한 diff 로) → preview 1건. (docs-sync-audit 은 solo 그룹이라 digest 합산 충돌 없음.)
- `src/morning-briefing/domain/port/slack-notifier.port.ts`
  - `SlackNotifierPort` 에 `postPreviewMessage({ target, previewText, previewId }): Promise<void>` 추가. **SlackService 가 이미 동명 메서드를 구현**([slack.service.ts] `postPreviewMessage` + `buildPreviewBlocks`)하므로 인터페이스만 확장하면 충족(useExisting bind 그대로).
- `src/autopilot/domain/autopilot.playbook.ts`
  - docs-sync-audit entry `riskTier: 'T1_PREVIEW'` 로 승격(`DOCS_AUDIT_PR_ENABLED` 게이트와 연동).
- `src/preview-gate/domain/preview-action.type.ts`
  - `PREVIEW_KIND.DOCS_AUDIT_PR` 추가 + payload 타입 주석.
- env 4곳 동기: `DOCS_AUDIT_PR_ENABLED`, `DOCS_AUDIT_PR_BASE_BRANCH`(기본 main). repo/토큰은 기존 GITHUB_TOKEN + IMPACT_REPORT_GITHUB_REPO 류 재사용(구현 plan 에서 확정).

### 신규
- `src/docs-audit/infrastructure/docs-revision.applier.ts` — 순수 결정론. 입력 confirmed 제안(편집들) → 격리 사본 적용 + unified diff 산출. octokit 무관(테스트 용이). 정확·유일 매칭 실패 시 그 편집 reject.
- `src/docs-audit/infrastructure/docs-audit-pr.applier.ts` — `implements PreviewApplier`, kind `DOCS_AUDIT_PR`. `BeSandboxPushPrApplier` 를 거의 그대로 미러: payload `{ diff, reasoning, changedFiles, repoLabel, baseBranch }` 동일 → 기존 `applyDiffAndReadFiles`(격리 tmp diff 적용 + 새 content 회복) + `githubClient.pushBranchAndOpenPr`(octokit 브랜치+1커밋+PR) **재사용**. main 직접 push X.
- 각 `*.spec.ts`.

## 5. 안전 / 에러 처리

- **외부 쓰기 게이트:** PreviewGate 승인 전 어떤 PR/커밋도 없음. TTL 1h(기존 기본).
- **main 직접 push 금지:** applier 는 항상 새 브랜치 + PR.
- **정확·유일 매칭:** oldString 이 0건/다중이면 그 편집만 reject, 나머지 제안은 계속. 부분 적용도 PR 후보로(사용자가 PR 에서 판단).
- **쿼터 가드:** Phase 1 `MAX_FILES`/`MAX_ITERATIONS` 그대로. 쿼터 예외 시 루프 즉시 중단.
- **게이트 OFF:** `DOCS_AUDIT_PR_ENABLED` 미설정/false → preview 생략, Phase 1 텍스트 보고로 폴백(riskTier 분기에서 preview 없으면 자동).
- **applier 실패:** octokit 실패는 ApplyResult 가 throw → apply usecase 가 사용자에게 노출(기존 PreviewGate 동작).

## 6. 테스트 전략

- `docs-revision.applier.spec.ts` — 정확매칭 치환/다중매칭 reject/매칭0 reject/다중편집 일부성공 + diff 산출.
- `codex-docs-judge.adapter.spec.ts` — edits[] 파싱(신/구 형식), 안전 기본값.
- `run-docs-audit.usecase.spec.ts` — SoT≠targetDoc 분리 로드, confirmed 제안에 diff 부착, 루프 종료조건 회귀.
- `docs-audit-pr.applier.spec.ts` — octokit mock 으로 브랜치+커밋+PR 호출 검증, main push 안 함 단언.
- `autopilot.orchestrator.spec.ts` — T1_PREVIEW + preview 페이로드 → CreatePreview 호출 + 버튼 메시지. preview 없으면 텍스트 폴백. T0_AUTO 회귀.
- `docs-sync-audit.autopilot-task.spec.ts` — `DOCS_AUDIT_PR_ENABLED` 게이트 분기.
- 완료 게이트: 3중 green + docs:check + 플레이북 검증.

## 7. 범위 밖 / 후속

- 다중 대상 문서(CLAUDE.md/AGENTS.md) 확장 — 1차는 README.md 단일.
- 자동 머지/CI 연동 — PR open 까지만.
- diff 적용을 실제 git worktree 에서 빌드 검증 — 마크다운이라 컴파일 없음, 사본 매칭+카탈로그 비파손으로 충분.

## 8. 해소된 불확실성 (코드 정독 완료, 2026-06-29)

- **cron 컨텍스트 버튼 발송** — `SlackService.postPreviewMessage({ target, previewText, previewId })` 가 이미 존재(`chat.postMessage` + `buildPreviewBlocks` apply/cancel 버튼). `postProposalMessage`(subconscious Port A)가 cron 발 버튼 메시지의 검증된 전례. 버튼 핸들러 `preview-action.handler.ts`(`app.action(preview:apply/cancel)`)는 전역이라 메시지만 띄우면 클릭 동작. → `SlackNotifierPort` 에 `postPreviewMessage` 추가(SlackService 이미 구현)로 해결.
- **PR open 경로 재사용** — `applyDiffAndReadFiles` 헬퍼 + `githubClient.pushBranchAndOpenPr` 가 `BeSandboxPushPrApplier` 에서 검증됨. DOCS_AUDIT_PR applier 는 동일 payload 형태로 그대로 재사용.
- **repo/owner 해석** — payload 의 `repoLabel`(BE sandbox 와 동일) 사용. 봇 자기 repo 기본값은 기존 `BE_SANDBOX_DEFAULT_REPO_LABEL`(default "JSL107/personal_agents") 또는 신규 `DOCS_AUDIT_PR_REPO` 중 하나로 구현 plan 에서 택1(권장: 의미 분리 위해 신규 `DOCS_AUDIT_PR_REPO`, 미설정 시 BE_SANDBOX_DEFAULT 재사용).

## 9. 구현 plan 진입 시 첫 Task (Task 0 — 정독 확정)

- `apply-preview.usecase.ts` + `preview-action.handler.ts` 의 apply 흐름 정독(applier resolve → apply → ResultVerifier) 으로 DOCS_AUDIT_PR applier 등록 위치 확정.
- `githubClient.pushBranchAndOpenPr` 시그니처 + `applyDiffAndReadFiles` 입력 계약 정독 후 payload 타입 가드 작성.
