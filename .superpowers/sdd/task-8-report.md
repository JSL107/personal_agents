## Task 8 보고서: orchestrator T1_PREVIEW + 등록 + env

### 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `src/autopilot/application/autopilot.orchestrator.ts` | CreatePreviewUsecase 4번째 생성자 주입 추가. `riskTier !== T0_AUTO` throw 제거. previews[] 수집 → createPreview.execute + postPreviewMessage fan-out 로직 추가. parts/previews 모두 0이면 skip. |
| `src/autopilot/application/autopilot.orchestrator.spec.ts` | 기존 T0_AUTO 테스트 9개 전부 4번째 인자(`{ execute: jest.fn() }`) 추가. `T1_PREVIEW → throw (SP4)` 테스트 삭제. T1_PREVIEW + preview 페이로드 신규 테스트 추가(createPreview.execute + postPreviewMessage 호출 검증). prettier/import-sort 자동 수정 적용. |
| `src/app.module.ts` | `PreviewGateModule.forRoot` appliers 배열에 `DocsAuditPrApplier` 추가. import 추가 후 prettier import-sort 자동 수정. |
| `src/autopilot/domain/autopilot.playbook.ts` | docs-sync-audit entry `riskTier: 'T0_AUTO'` → `'T1_PREVIEW'` 변경. 주석 갱신. |
| `src/autopilot/domain/autopilot.playbook.spec.ts` | docs-sync-audit 단언 `T0_AUTO` → `T1_PREVIEW` 갱신. |
| `src/config/app.config.ts` | `DOCS_AUDIT_PR_ENABLED`, `DOCS_AUDIT_PR_REPO`(@Matches owner/repo), `DOCS_AUDIT_PR_BASE_BRANCH` 3개 추가. prettier 자동 수정 적용. |
| `.env.example` | DOCS_AUDIT_PR_* 주석 블록 3줄 추가. |
| `docs/env-catalog.md` | `pnpm docs:sync` 재생성(신규 env 3개 반영). |

### docs-audit.module.ts / autopilot.module.ts 변경 불필요 판단 근거

- `PreviewGateModule.forRoot`가 applier 클래스를 직접 `providers`에 등록 — DocsAuditModule export 불필요.
- `PreviewGateModule`이 `@Global` — AutopilotModule에 import 없이도 `CreatePreviewUsecase` DI 자동 주입.

### 검증 결과

| 명령 | 결과 |
|---|---|
| `pnpm test -- autopilot.orchestrator autopilot.playbook --no-coverage` | Tests: 19 passed, 19 total |
| `pnpm build` | exit 0 |
| `pnpm lint:check` | 0 errors, 38 warnings (slack-inbox 기존 warnings, 우리 파일 무관) |
| `pnpm docs:check` | OK — 생성 문서가 코드와 동기 상태입니다 |

### .env 권한

`.env` 파일이 worktree에 존재하지 않아 추가 불가(비차단 — check:env는 optional 미문서화를 WARN 처리).

### 커밋 SHA

(커밋 후 갱신)

### self-review

- T0_AUTO throw 제거로 riskTier 불일치가 silent fallback되는 것이 의도적 설계(preview 없으면 텍스트 경로로 자연 처리).
- `as any` warnings는 spec 테스트 mock의 never/any 타입 캐스팅으로 기존 패턴 동일, errors 아님.
- DocsAuditPrApplier는 GithubClientPort 의존 — forRoot imports에 GithubModule이 이미 있어 DI 정상.
