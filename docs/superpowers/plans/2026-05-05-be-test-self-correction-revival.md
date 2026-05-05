# BE-Test Self-Correction 루프 재도입 (2026-05-05)

> **상위 plan**: [2026-04-29-v3-roadmap.md](./2026-04-29-v3-roadmap.md) #8 BE-2 AST Test Gen
> **선행 결정**: [2026-04-30-mcp-rbac-decision.md](./2026-04-30-mcp-rbac-decision.md) §5 — "BE-Test self-correction 루프는 sandbox 디자인 강화 (read-only mount + tmpfs spec) 후 재도입"
> **근거 commit**: `3e5e887 feat(be-test): /be-test 슬래시 — Tree-sitter AST 기반 spec 생성 (V3 §8 MVP)` 의 codex audit P1.1 / P1.2 로 self-correction 루프가 제거된 상태.

---

## 0. 결론 한 줄

V3 §8 MVP 에서 안전상 제거됐던 **be-test 의 spec 자체검증 + 재시도 루프** 를, sandbox 의 tmpfs spec 주입 지원을 먼저 추가한 뒤 재도입한다. 호스트 fs 에 spec 을 쓰지 않고 컨테이너 in-memory 로만 다뤄 V3 §8 MVP 시 codex 가 잡았던 위험을 피한다.

---

## 1. 배경 — 왜 제거됐고, 왜 다시 도입하나

### 1.1 제거 사유 ([generate-test.usecase.ts:26-30](../../../src/agent/be-test/application/generate-test.usecase.ts#L26))
> "LLM 이 생성한 spec 을 호스트 repo 에 작성한 뒤 sandbox 가 그걸 mount RW 로 실행하던 self-correction 루프는 호스트 파일 수정/삭제 위험과 spec path shell-interpolation 위험을 동시에 가졌다."

구체적 위험 (codex P1.1 / P1.2):
- LLM 출력 spec 을 호스트 `*.spec.ts` 로 직접 write → 다른 파일을 덮어쓸 가능성 (path traversal)
- `pnpm test <specPath>` 의 specPath 가 shell-interpolation 표면이 됨

### 1.2 차단 사유 해소 평가 (현재 sandbox MVP 기준)

| 전제 | 상태 | 위치 |
|---|---|---|
| read-only mount default (`:ro`) | ✅ 적용 | [docker-sandbox-runner.ts:146](../../../src/sandbox/infrastructure/docker-sandbox-runner.ts#L146) |
| `--network none` default | ✅ 적용 | [docker-sandbox-runner.ts:15](../../../src/sandbox/infrastructure/docker-sandbox-runner.ts#L15) |
| shell injection 차단 (`shell: false` + args 배열) | ✅ 적용 | [docker-sandbox-runner.ts:39](../../../src/sandbox/infrastructure/docker-sandbox-runner.ts#L39) |
| stdout/stderr cap (256KB) | ✅ 적용 | [docker-sandbox-runner.ts:17](../../../src/sandbox/infrastructure/docker-sandbox-runner.ts#L17) |
| timeout (60s default) | ✅ 적용 | [docker-sandbox-runner.ts:14](../../../src/sandbox/infrastructure/docker-sandbox-runner.ts#L14) |
| mount path validation (메타문자 차단) | ✅ 적용 | [docker-sandbox-runner.ts:22](../../../src/sandbox/infrastructure/docker-sandbox-runner.ts#L22) |
| **tmpfs spec mount (LLM spec 을 호스트 fs 안 거치고 컨테이너에 주입)** | ❌ **미충족** | — |

→ 마지막 1건 (tmpfs spec) 만 추가하면 self-correction 루프 재도입의 디자인 전제 충족.

### 1.3 가치 — 재도입 시 효과
- LLM 1회 생성 spec 의 **type/lint 에러 자동 회복** (현재는 사용자가 수동 검증).
- `GeneratedTest.validated` 가 진짜로 검증된 의미를 갖게 됨 (현재 항상 `false`).
- be-test 가치 상승 — 사용자 수동 검증 부담 감소.

---

## 2. 단계별 plan

### 단계 1 — Sandbox tmpfs file 주입 지원 (1~2 commit)

**Files**:
- Modify: `src/sandbox/domain/port/sandbox-runner.port.ts` — `tmpfsFiles?: TmpfsFile[]` 추가
- Modify: `src/sandbox/infrastructure/docker-sandbox-runner.ts` — `--tmpfs /work` + stdin 으로 파일 주입
- Modify: `src/sandbox/infrastructure/docker-sandbox-runner.spec.ts` — tmpfs 케이스 추가

**디자인**:
```ts
// SandboxRunRequest 에 추가:
tmpfsFiles?: { containerPath: string; content: string }[];
```

**구현 옵션 A — `--tmpfs /work` + stdin HEREDOC** (권장)
1. `docker run ... --tmpfs /work:size=16m,exec ...`
2. `command` 를 `/bin/sh -c` 로 받기 전, sandbox runner 가 stdin 으로 spec content 를 흘려 보낸다.
3. 내부 wrapper script:
   ```sh
   cat > /work/generated.spec.ts <<'__EOF__'
   {{specCode}}
   __EOF__
   pnpm jest /work/generated.spec.ts --rootDir=/repo
   ```
4. content 안의 `__EOF__` 출현은 sandbox runner 에서 검증 / reject (충돌 회피).

**구현 옵션 B — 호스트 임시 파일 + ro mount**
1. `mkdtemp` 로 호스트에 격리 디렉터리 생성
2. spec content 를 거기 write 한 뒤 `:ro` 로 mount
3. **단점**: 호스트 fs 에 잠시 쓰여짐 → 원래 위험 일부 잔존. 옵션 A 가 더 깨끗.

**검증**:
- spec: `tmpfsFiles` 가 제공된 경우 컨테이너 안에서 해당 path 가 읽힘 (mock spawn 로 명령행 검증)
- spec: `__EOF__` heredoc 충돌 시 SandboxException(`UNSAFE_TMPFS_CONTENT`)
- spec: `mountMode: 'ro'` default 유지 + tmpfs 는 별개 path

**3중 green + `/codex:review` → commit**

---

### 단계 2 — BE-Test self-correction 루프 (1~2 commit)

**Files**:
- Modify: `src/agent/be-test/application/generate-test.usecase.ts` — sandbox 검증 + retry 루프
- Modify: `src/agent/be-test/be-test.module.ts` — SandboxModule import
- Modify: `src/agent/be-test/domain/be-test.type.ts` — `validated: true` 진짜 활성화 + retry 메타
- Modify: `src/agent/be-test/application/generate-test.usecase.spec.ts` — retry 시나리오

**루프 디자인**:
```
1. LLM 1차 spec 생성
2. SandboxRunner.run({
     tmpfsFiles: [{ containerPath: '/work/generated.spec.ts', content: specCode }],
     command: 'pnpm jest /work/generated.spec.ts --rootDir=/repo --passWithNoTests',
     hostMountPath: repoRoot, mountMode: 'ro', networkMode: 'none',
     timeoutMs: 60_000,
   })
3. exitCode === 0 → return { specCode, validated: true, attempts: N }
4. exitCode !== 0 → stderr 첨부 → LLM 에 fix prompt → 재생성 → 단계 2 재진입
5. 누적 시도 ≥ MAX_ATTEMPTS (3) 에서 stop → validated: false + 마지막 stderr 보존
```

**MAX_ATTEMPTS = 3** (codex audit 정신 — 무한 루프 차단).

**관측성**:
- `inputSnapshot` 에 `selfCorrectionAttempts: number` + `selfCorrectionStderrTail?: string` (마지막 1KB) 추가.
- formatter ([be-test.formatter.ts]) 에 `validated` true/false 와 attempts 노출.

**검증**:
- spec: 1차 통과 → 1회만 sandbox 호출, validated true, attempts 1
- spec: 1차 실패 → 2차 통과 → sandbox 2회, attempts 2
- spec: 3차까지 모두 실패 → validated false, attempts 3, stderrTail 보존
- spec: sandbox 자체 에러 (timeout / docker spawn fail) → 재시도 X, AgentRun FAILED 처리

**3중 green + `/codex:review` → commit**

---

### 단계 3 — Slack 응답 + observability (1 commit)

**Files**:
- Modify: `src/slack/format/be-test.formatter.ts` — `validated` true 시 ✅ 배지, false 시 ⚠️ + attempts 노출
- Modify: `src/agent-run` 메트릭 (필요 시) — be-test 에 한해 attempts 분포 카운트

**검증**:
- spec: validated true / false 양쪽 formatter 텍스트 분기 검증
- 수동: `/be-test src/foo/foo.ts` 실행 시 validated 배지 노출

**3중 green + `/codex:review` → commit**

---

## 3. 위험 / 한계

### 3.1 알려진 제약
- **Docker 미설치 환경**: sandbox 호출 자체가 실패. 단계 2 의 retry 루프는 sandbox 자체 에러 시 retry X — `GenerateTestUsecase` 가 fallback 으로 validated false + stderr 노출 후 종료.
- **tmpfs 크기**: `--tmpfs /work:size=16m` 권장. spec 1개당 보통 < 100KB 라 충분.
- **jest 의 `--rootDir=/repo`**: rootDir 가 `:ro` 라 jest cache write 시도 시 실패할 수 있다 — 단계 1 검증에서 `--cache=false` 또는 `--cacheDirectory=/work/.jest-cache` 로 회피.

### 3.2 의도적 미포함
- LLM 의 fix prompt 안에 patch diff 형태 (codex audit 가 우려한 "spec 자체 mutation" 을 피하기 위해 spec 전체 재생성 방식만 사용).
- 호스트 spec 파일 자동 작성 — Stage 4 별도 plan 으로 (사용자 ✅ 클릭 후 호스트 write, PreviewGate 동일 패턴).

### 3.3 보안 회귀 차단 체크
- spec 의 어떤 시점에도 호스트 fs write 발생 안 함 (단계 1 옵션 A 채택 시).
- specPath 가 shell args 에 포함되지 않음 (tmpfs 안 fixed path `/work/generated.spec.ts` 만 사용).
- specCode 안의 `__EOF__` 충돌 검증 (단계 1 검증 항목).

---

## 4. 예상 commit 수

| 단계 | commit | 누적 |
|---|---|---|
| 1. Sandbox tmpfs file 주입 | 1~2 | 1~2 |
| 2. BE-Test self-correction 루프 | 1~2 | 2~4 |
| 3. Slack formatter + observability | 1 | 3~5 |

**총 3~5 commit, 1주 이내 작업**.

---

## 5. 검증 (전체 단계 후)

- [ ] `pnpm lint:check` exit 0
- [ ] `pnpm test` exit 0 (sandbox spec + be-test spec 둘 다)
- [ ] `pnpm build` exit 0
- [ ] `/be-test src/agent/pm/application/daily-plan-prompt.builder.ts` 실행 시 validated true 로 응답
- [ ] 의도적으로 LLM 이 잘못 만들도록 prompt 변조 → attempts 증가 + 최종 validated false
- [ ] sandbox 안에서 spec 실행 중 호스트 fs `*.spec.ts` 에 writethrough 발생 X (lsof 또는 fs.watch)
- [ ] 호스트 docker stop 등 외부 사고에 sandbox runner 가 graceful 처리

---

## 6. 의사결정 질문 (사용자에게)

1. **단계 1 옵션 A (`--tmpfs` + stdin HEREDOC)** 가 권장. 옵션 B (호스트 mkdtemp + ro mount) 도 검토 가치 있음 — 어느쪽?
2. **MAX_ATTEMPTS = 3** OK? (codex 의 "무한 루프 차단" 정신 + 실용 절충)
3. **이 plan 의 단계 1 부터 진행** OK? 또는 다른 V3 항목 (#7 BE-1 Step 2 / #9 BE-4 Step 2) 우선?
4. **Sandbox tmpfs 지원 자체** 가 다른 에이전트 (BE-1 의 stack trace 재현, BE-4 의 fix patch 검증) 에도 즉시 쓰일 surface — 단계 1 만 먼저 분리 commit 하고 단계 2 는 별도 사이클로 갈지?

---

## 7. 본 plan 의 한계

- Tree-sitter AST 기반 spec 의 LLM 출력 정확도가 retry 로 회복 가능한지는 실측 필요 — 만약 1회 실패면 3회도 실패하는 패턴이면 retry 가치 없음. 단계 2 후 N=10 시도 측정 권장.
- jest cache 의 read-only mount 호환성 (단계 3.1 §3.1) 은 단계 1 PoC 에서 실증 필요.

— 작성: Claude (Opus 4.7), 2026-05-05
— 상태: **사용자 검토 대기** (코드 변경 없음)
