# BE-Test Self-Correction 단계 2/3 구현 결과 정정 노트 (2026-05-26)

> **상위 plan**: [2026-05-05-be-test-self-correction-revival.md](./2026-05-05-be-test-self-correction-revival.md)
> **구현 commit**: `680627d feat(be-test): self-correction 루프 재도입 — sandbox tmpfs 기반 retry (V3 §8 단계 2/3)`
>
> **목적**: 상위 plan §1 옵션 A 의 "stdin HEREDOC" 문구가 실제 코드와 불일치한 사실, 그리고 plan 작성 시점 미확정이었던 디자인 결정 (jest 옵션, retryable 분류) 의 구현 결과를 dated reference 로 정리. 상위 plan 은 dated snapshot 정책상 사후 갱신하지 않으므로 본 문서가 보강.
> **운영**: dated reference snapshot — 사후 갱신 X. 향후 self-correction 동작 변경은 새 plan 으로 분리.

---

## 0. 한 줄 요약

상위 plan 의 권장 디자인 (sandbox tmpfs 기반 self-correction 루프) 은 그대로 채택하되, **세 가지 디테일은 plan 작성 시점 이후 확정/변경됨**: (a) tmpfs 주입은 stdin 이 아닌 `command 문자열 안 HEREDOC` 으로 구현됨, (b) jest 옵션은 `--cacheDirectory=/work/.jest-cache --no-coverage` 로 확정 + `--passWithNoTests` 미채택, (c) stderr 패턴 기반 retryable 분류 (NON_RETRYABLE 조기 stop) 신규 도입.

---

## 1. plan §1 옵션 A 정정 — stdin HEREDOC 가 아닌 command-안 HEREDOC

### 1.1 plan §1 옵션 A 원문

> **구현 옵션 A — `--tmpfs /work` + stdin HEREDOC** (권장)
> 1. `docker run ... --tmpfs /work:size=16m,exec ...`
> 2. `command` 를 `/bin/sh -c` 로 받기 전, sandbox runner 가 stdin 으로 spec content 를 흘려 보낸다.
> 3. 내부 wrapper script:
> ```sh
> cat > /work/generated.spec.ts <<'__EOF__'
> {{specCode}}
> __EOF__
> pnpm jest /work/generated.spec.ts --rootDir=/repo
> ```

### 1.2 실제 구현 ([docker-sandbox-runner.ts:184-193](../../../src/sandbox/infrastructure/docker-sandbox-runner.ts#L184))

```ts
// tmpfs 파일을 HEREDOC 으로 컨테이너 안 fs 에 쓰는 prelude + 사용자 command 를 결합.
private wrapCommandWithTmpfs(files: TmpfsFile[], command: string): string {
  const lines: string[] = [];
  for (const file of files) {
    lines.push(`cat > ${file.containerPath} <<'${TMPFS_HEREDOC_MARKER}'`);
    lines.push(file.content);
    lines.push(TMPFS_HEREDOC_MARKER);
  }
  lines.push(command);
  return lines.join('\n');
}
```

그리고 [spawn 호출 (line 51)](../../../src/sandbox/infrastructure/docker-sandbox-runner.ts#L51):
```ts
child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
```

→ **stdin 은 `ignore`**. HEREDOC 은 `command` 문자열 안에 prepend 되고 `docker run ... /bin/sh -c <final>` 로 전달된다.

### 1.3 차이 의미

| 차원 | plan §1 옵션 A (stdin HEREDOC) | 실제 (command-안 HEREDOC) |
|---|---|---|
| sandbox runner 가 child 의 stdin 에 write | ✓ | ✗ (`stdio: ['ignore', ...]`) |
| sandbox runner 가 child 의 args 안에 spec content embed | ✗ | ✓ |
| spec content 의 `argv` 노출 위험 (`ps aux`) | 낮음 | **있음** — child args 에 spec 전체 포함 |
| 보안 — heredoc marker 충돌 검증 | 필요 | **이미 구현됨** ([validateTmpfsFiles:171-177](../../../src/sandbox/infrastructure/docker-sandbox-runner.ts#L171)) |

### 1.4 평가

**`ps aux` 노출은 본 환경에서 실질적 위험 X**:
- spec content 는 LLM 이 생성한 분기 커버리지 spec 일 뿐, secret/credential 포함 가능성 0 에 가까움 (BE_TEST_SYSTEM_PROMPT 가 mock 사용을 강제).
- docker spawn 의 args 는 같은 호스트의 다른 사용자/프로세스에만 보이고, 본 환경은 단일 사용자 macOS 로컬.
- stdin 방식으로 바꾸려면 추가 자식 프로세스 (e.g. `bash -c "cat | docker run ..."`) 가 필요해 shell injection 표면이 다시 열림.

→ **command-안 HEREDOC 유지**. 단 plan §1 의 "stdin" 표현은 혼동을 유발하므로 본 노트로 정정.

### 1.5 후속 (필요 시)

운영 환경이 multi-user / shared host 로 옮겨가면 (가능성 낮음) stdin write 패턴으로 전환 검토:
1. `spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })`
2. `child.stdin.write(specCode); child.stdin.end()`
3. `docker run ... /bin/sh -c "cat > /work/generated.spec.ts && jest ..."` — 단 jest 가 stdin 을 소비하면 충돌. tmpfs 파일 작성 후 stdin close 패턴 필요.

---

## 2. jest 옵션 확정

plan §3.1 미확정 항목 ("jest cache 의 read-only mount 호환성은 단계 1 PoC 에서 실증 필요") 을 구현 시점에 확정.

### 2.1 채택 ([generate-test.usecase.ts:215-216](../../../src/agent/be-test/application/generate-test.usecase.ts#L215))

```ts
command:
  `pnpm jest ${TMPFS_SPEC_PATH} --rootDir=/repo ` +
  `--cacheDirectory=/work/.jest-cache --no-coverage`,
```

- `--rootDir=/repo` — `:ro` 마운트
- `--cacheDirectory=/work/.jest-cache` — tmpfs (`/work`) 안으로 cache write 분리 → EROFS 회피
- `--no-coverage` — coverage write 도 fs 변조라 비활성화

### 2.2 미채택

- **`--passWithNoTests`** — Codex 지적 ("spec 자체가 없으면 fail 처리해야 retry 가치 있음"). 0 테스트 통과 오인 방지.

### 2.3 검증

[generate-test.usecase.spec.ts](../../../src/agent/be-test/application/generate-test.usecase.spec.ts) 의 `Sandbox 호출 contract` describe 가 jest 명령 옵션 + `--passWithNoTests` 미포함 + tmpfsFiles / mountMode / networkMode 모두 assertion.

---

## 3. Retryable / Non-retryable 분류 (plan 에 없던 신규 메커니즘)

### 3.1 배경

plan §7 의 한계 인정: *"Tree-sitter AST 기반 spec 의 LLM 출력 정확도가 retry 로 회복 가능한지는 실측 필요 — 만약 1회 실패면 3회도 실패하는 패턴이면 retry 가치 없음"*.

OMC critic 지적: 모든 실패에 균등하게 3 attempt 를 쓰면 latency 만 3 배가 되고 회복률은 안 오를 케이스가 많다. **stderr 패턴 기반 분류** 필요.

### 3.2 채택 ([generate-test.usecase.ts:302-308](../../../src/agent/be-test/application/generate-test.usecase.ts#L302))

```ts
const NON_RETRYABLE_STDERR_PATTERNS: RegExp[] = [
  /Expected:\s/,
  /Received:\s/,
  /expect\([^)]*\)\.[a-zA-Z]+\(/,
];
```

| stderr 패턴 | 분류 | 사유 |
|---|---|---|
| `TS2304:` / `Cannot find module` / `SyntaxError` | retryable | LLM 1회 더 생성으로 회복 가능 |
| `Expected: ... / Received: ...` / `expect().<matcher>(...)` | non-retryable | 로직 오해 → 동일 spec 재생성 확률 높음 |

### 3.3 로직

- 1차 attempt 가 non-retryable 패턴이어도 **한 번 더 retry** 시도 (LLM 출력 분산 가능성 보존)
- 2회 연속 non-retryable hit → `stopReason: 'NON_RETRYABLE'` 조기 stop
- TS error 가 끼면 nonRetryableHits 카운트 누적되지 않아 MAX_ATTEMPTS=3 까지 진행

검증: spec 의 `assertion fail 1회 → TS error → pass` 케이스가 attempts=3 통과를 명시.

### 3.4 후속 측정

plan §7 의 N=10 실측 권장 — 사용자 실 운영 후:
- TS error retry 회복률 (1차→2차)
- assertion fail retry 회복률 (1차→2차) vs NON_RETRYABLE stop 정확도

데이터 축적 후 패턴 set 미세조정 필요할 수 있음 (e.g. `TypeError`, `ReferenceError` 등 추가).

---

## 4. SANDBOX_UNAVAILABLE stopReason (plan 묵시)

plan §3.1 이 "sandbox 자체 에러 (timeout / docker spawn fail) → 재시도 X, AgentRun FAILED 처리" 로 명시했으나, AgentRun FAILED 보다는 **validated=false + stopReason='SANDBOX_UNAVAILABLE'** 로 분리해 user-facing formatter 가 "Docker daemon 점검 필요" 라는 actionable 안내를 노출하도록 디자인 변경.

이유: Docker 미설치 환경에서 spec 자체는 생성되었는데 sandbox 만 막힌 경우 spec 을 버리지 않는 게 사용자 가치 (수동 검증 가능).

[be-test.formatter.ts:65](../../../src/slack/format/be-test.formatter.ts#L65):
```ts
case 'SANDBOX_UNAVAILABLE':
  return `⚠️ Sandbox 사용 불가 — Docker daemon/이미지 점검 필요 (attempts=${attempts})`;
```

---

## 5. plan 단계 3 의 "attempts 분포 메트릭" — 미적용 (옵션)

plan §3 단계 3 의 옵션 항목 ("`/agent-run` 메트릭 (필요 시) — be-test 에 한해 attempts 분포 카운트"). 본 구현에서는:

- AgentRun.output 안에 `selfCorrectionAttempts` 가 이미 들어가므로 SQL 집계로 분포 산출 가능.
- 별도 메트릭 column / dashboard 는 도입 X (1인 사용 — `/quota` 의 PM 컨텍스트 패턴 정도면 충분).
- 운영 데이터 축적 후 dashboard 필요해지면 별도 plan 으로 분리.

---

## 6. 본 노트의 한계

- §3.4 의 retry 회복률 실측은 사용자 운영 시작 후에만 가능.
- §1.4 의 multi-user 환경 위험 분석은 본 환경 (single-user macOS) 가정에 의존.
- §4 의 "Docker 미설치 안내" UX 는 실제 사용자가 어떤 메시지를 받는지 슬랙 캡처로 검증되지 않음 (sandbox spec 만 검증).

— 작성: Claude (Opus 4.7), 2026-05-26
— 출처: BE-Test self-correction revival plan + omc:critic/architect/codex 리뷰 + 구현 commit `680627d` cross-check
