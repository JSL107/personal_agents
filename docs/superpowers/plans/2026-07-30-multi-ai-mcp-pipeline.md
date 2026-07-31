# 멀티 AI 오케스트레이션 파이프라인 v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude 오케스트레이터 + Codex를 MCP 도구로 승격한 자율 파이프라인(설계→구현→2층 검증→draft PR→PR 봇 루프)을 전역 지침·커맨드로 확립한다.

**Architecture:** 산출물은 코드가 아니라 **전역 지침 마크다운**이다. `/codex-flow` 슬래시 커맨드가 파이프라인의 실행 명세이고, `~/.claude/CLAUDE.md`가 상시 운영 규칙이다. codex는 `codex mcp-server`를 MCP 도구로 등록해 호출하고, 실패 시 기존 `codex exec` CLI로 폴백한다.

**Tech Stack:** Claude Code 슬래시 커맨드(markdown), codex-cli 0.145 (`codex mcp-server`, `codex review`), `claude mcp` CLI, omc 서브에이전트(code-reviewer/security-reviewer/critic), GitHub PR 봇(@gemini-code-assist, chatgpt-codex-connector).

## Global Constraints

- **대상은 전역 파일**: `~/.claude/commands/codex-flow.md`, `~/.claude/commands/codex-implement.md`, `~/.claude/commands/codex-finalize.md`, `~/.claude/CLAUDE.md`. `~/.claude`는 git repo가 아니다 → **편집 전 같은 경로에 `.bak` 백업 생성**(되돌림 보장). 커밋 단계 없음.
- **안전레일 보존 (문구 그대로 유지)**: main·공유 브랜치 직접 커밋 금지, force push 절대 금지, `--dangerously-bypass-approvals-and-sandbox` 금지, release/deploy/prod write 금지, codex 호출에 `--ask-for-approval` 금지(`codex exec`에 없는 플래그, 즉시 죽음).
- **codex 호출 규약**: MCP 도구 우선 → 실패 시 `codex exec --cd "$(pwd)" --sandbox workspace-write "..." < /dev/null` 폴백. 백그라운드 실행 시 `< /dev/null` 필수(stdin hang 방지).
- **샌드박스 경계**: `--sandbox workspace-write`의 정책 제약(localhost DB `P1001`, 레포 밖 worktree git `index.lock`)은 MCP로도 안 풀린다 → DB·설치·레포 밖 git은 메인(Claude)이 선/후처리.
- **한글 경로 OK** (codex 0.145에서 실증). 구버전 exit 2 증상 시에만 ASCII worktree 우회.
- **outward 실행은 승인 후**: Task 1(MCP 전역 등록)·Task 5(실제 PR 생성 e2e)는 실제 실행 전 사용자 승인.
- **정본 스펙**: `docs/superpowers/specs/2026-07-30-multi-ai-mcp-pipeline-design.md`.

### 태스크별 TDD 적용 여부

| Task | 성격 | TDD | 검증 방식 |
|---|---|---|---|
| 1 codex MCP 등록 | 전역 설정 + 스모크 | 아니오 | 실제 도구 왕복 스모크 |
| 2 `/codex-flow` v2 | 지침 마크다운 | 아니오 | 정합·안전레일 보존 검토 |
| 3 implement/finalize 정합 | 지침 마크다운 | 아니오 | 정합 검토 |
| 4 `CLAUDE.md` 개정 | 지침 마크다운 | 아니오 | 정합·모순 검토 |
| 5 e2e 스모크 | 실증 | 아니오 | 실제 작은 작업 1건 왕복 |

TDD가 없는 이유: 산출물이 실행 코드가 아니라 지침 문서와 설정이라 단위 테스트 대상이 없다. 대신 각 태스크는 편집 후 **재독 + 스모크 검증**으로 닫는다.

---

## Task 1: codex MCP 서버 등록 + 스모크 검증

**Files:**
- 변경 없음 (전역 MCP 설정에 항목 추가 — Claude Code가 관리). 필요 시 `~/.claude.json` 또는 프로젝트 `.mcp.json`에 기록됨.

**Interfaces:**
- Produces: Claude Code 세션에 `mcp__codex__*` 계열 도구(정확한 이름은 스모크에서 확인). Task 2가 "MCP 도구 우선" 경로에서 이 도구를 부른다.

- [ ] **Step 1: (승인 게이트) 전역 MCP 등록임을 사용자에게 고지하고 실행 승인 받기**

이 단계는 전역 설정을 바꾸는 outward 변경이다. 실행 전 승인.

- [ ] **Step 2: codex MCP 서버 등록**

Run:
```bash
claude mcp add codex -- codex mcp-server
claude mcp list | grep -i codex
```
Expected: `codex: ... - ✔ Connected` (또는 등록 직후엔 미연결일 수 있음 — 다음 스텝에서 세션 재시작 후 확인).

- [ ] **Step 3: 새 세션에서 도구 노출 확인**

MCP 도구는 세션 시작 시 로드된다. 새 Claude Code 세션에서 codex 관련 도구가 도구 목록/`ToolSearch`에 뜨는지 확인하고 **정확한 도구 이름**을 기록한다(예: `mcp__codex__codex`).
Expected: codex MCP 도구가 최소 1개 노출.

- [ ] **Step 4: 왕복 스모크**

노출된 codex MCP 도구에 사소한 프롬프트("현재 디렉터리의 파일을 한 줄로 요약")를 전달해 hang·경로 실패 없이 응답이 오는지 확인. 기존 CLI에서 겪던 stdin hang / exit 2 없이 왕복되면 성공.
Expected: 정상 응답 1회 왕복.

- [ ] **Step 5: 폴백 경로 확인**

codex MCP 서버를 일시 비활성(`claude mcp remove codex` 후 재현, 또는 서버 미기동 상태 가정)하고, Task 2의 폴백 문구대로 `codex exec ... < /dev/null`가 여전히 동작하는지 개념 확인(실제 제거는 선택). 폴백이 살아 있어야 롤백 가능.

---

## Task 2: `/codex-flow` v2 재작성

**Files:**
- Modify(전면 재작성): `~/.claude/commands/codex-flow.md` (현재 115줄)
- Backup: `~/.claude/commands/codex-flow.md.bak`

**Interfaces:**
- Consumes: Task 1의 codex MCP 도구(우선 경로), 기존 `codex exec` 폴백.
- Produces: 파이프라인 8단계 실행 명세. Task 3·4가 이 문구와 정합을 맞춘다.

- [ ] **Step 1: 백업 생성**

Run:
```bash
cp ~/.claude/commands/codex-flow.md ~/.claude/commands/codex-flow.md.bak
```

- [ ] **Step 2: v2 전문으로 덮어쓰기**

`~/.claude/commands/codex-flow.md`를 아래 전문으로 교체한다.

````markdown
# /codex-flow (v2)

개인 멀티 AI 파이프라인: Claude 설계 → Codex 구현 → 2층 검증 → draft PR → PR 봇 루프.
사람 관문 = 적응형 시작 게이트 1회 + 최종 PR 검토.

Arguments: `$ARGUMENTS`

## Modes / Flags

`$ARGUMENTS`의 선행 토큰을 파싱한다(플래그는 태스크 설명에서 제거):

- `--auto[=N]` → **무인 자율**: 적응형 시작 게이트까지 건너뛰고 draft PR까지 진행. `N` = 수렴 루프 최대(기본 2).
- `--auto-reply` → PR 봇 답변·수정 push **자동 게시**(기본은 draft-first, 초안 승인 후 게시).
- 없으면 → **적응형(기본)**: 명확·저위험 작업은 자율 진행, 모호·고위험만 시작 시 1회 확인.

## Safety rails (모든 모드 공통)

- main·공유 브랜치 직접 커밋 금지, **force push 절대 금지**, `--dangerously-bypass-approvals-and-sandbox` 금지, release/deploy/prod write 금지.
- codex 호출에 `--ask-for-approval`을 붙이지 말 것 — `codex exec`에 없는 플래그라 즉시 죽는다.
- 자동 atomic commit은 **격리 브랜치/worktree 안에서만** 허용. 이 파이프라인 밖 일반 대화형 세션의 commit 하드룰(사용자 요청 후에만)은 그대로.

## Codex 호출 — MCP 우선, CLI 폴백

1. **1순위 (MCP 도구)**: codex MCP 서버가 등록돼 있으면 노출된 codex 도구로 프롬프트를 전달한다(`claude mcp list`로 확인). stdin hang·exit 파싱·백그라운드 무한대기 문제가 없다.
2. **폴백 (CLI)**: MCP 미등록/실패 시 `codex exec --cd "$(pwd)" --sandbox workspace-write "..." < /dev/null`. 백그라운드 실행 시 `< /dev/null` 필수.
3. **샌드박스 경계**: `--sandbox workspace-write`의 정책 제약(localhost DB `P1001`, 레포 밖 worktree git `index.lock`)은 MCP로도 안 풀린다 → DB·설치·레포 밖 git은 메인(Claude)이 선/후처리.

## Pipeline

### ① 설계 (Claude)
repo guidance(`AGENTS.md`/`CLAUDE.md`/기존 `.ai/`)를 읽고 `.ai/design.md`를 작성한다: Goal / Non-goals / Current flow / Proposed design / Affected files / API·schema impact / tx·concurrency / security·auth / Test plan / Codex steps / Acceptance criteria / **태스크별 TDD 여부 표**.

### ② 적응형 시작 게이트
다음 중 하나라도 해당하면 설계 요약(접근·영향 파일·acceptance)을 짧게 보여주고 승인을 기다린다:
모호·해석 갈림 / 스키마·마이그레이션·데이터 변경 / 인증·보안·결제·외부 부작용 / 다파일 구조 변경·큰 리팩토링 / 되돌리기 어려운 변경.
그 외 명확·저위험이면 통과. `--auto`면 무조건 통과.

### ③ 구현 (Codex)
설계 계약대로 구현(재설계 금지, 불가능·불안전·기존 코드 충돌 시에만 이탈하고 사유 기록). 테스트 추가/갱신. `.ai/implementation-summary.md`에 변경 파일·동작 변화·tests run·설계 이탈·남은 리스크. PR/push/prod write 금지.

### ④ 검증 (2층)
- **Layer 0 (결정론, 항상)**: 레포 자체 검증 명령(lint/type/test/build) green. 아니면 Layer 1로 안 가고 ⑤ 수렴으로.
- **Layer 1 (리스크 기반 병렬 발사)**: 문서·사소 → 생략 / 일반 로직 → `codex review`(외부 시각) + `omc:code-reviewer` / 보안·인증·외부입력·env → + `omc:security-reviewer`(Opus 고정) / 큰 리팩토링·다파일 → + `omc:critic`. 병렬 서브에이전트, 규모 크면 Workflow로 fan-out.
- **적대적 검증(맹종·맹반 금지)**: 각 finding을 파일:라인으로 재확인 → (A) 타당·범위 내 수정 / (B) 타당·범위 밖 후속 기록 / (C) 오탐 반증 기각.
- 검증은 항상 `git diff <base>...` **와** `git status --short` 둘 다(신규 파일 열람).

### ⑤ 수렴 루프
발견 → codex에 수정 위임 → Layer 0 재실행 + 해당 리뷰어 재확인 → clean이면 통과. 최대 `N`회(기본 2). 미수렴이면 자율 멈추고 요약 + 남은 finding을 사람에게. 직전 라운드와 finding이 동일하면(stalled) 조기 중단.

### ⑥ PR 생성 (Claude) ★outward 첫 지점
격리 브랜치에서 **draft PR** 생성. 본문 구성:
- **맨 위에 「이번 변경 한눈에」**(사람이 읽는 설명): 무엇을 바꿨나 · 왜 바꿨나 · 어떻게 설계했나(핵심 판단·검토한 대안 포함)를, 코드를 안 본 사람도 이해되게 **자연스러운 한국어 산문 3~6문장**으로. doc-tidy·humanize 정신(약어·개조식 나열 최소화, 사실·수치·고유명사는 불변). **AI 제작 과정 메타 금지**(에이전트명·파이프라인·"N차 리뷰" 등 넣지 않음).
- **그 아래에 리뷰어용 구조**: 글로벌 PR 규칙(문제/목표/변경[파일:라인]/리스크/검증/후속; `.github` 템플릿 있으면 그 구조 우선).

브랜치 push·draft PR 생성은 이 파이프라인의 승인된 단계.

### ⑦ PR 봇 루프 (레포 적응형)
PR에 **실제 코멘트를 단 봇을 동적 탐지**한다(하드코딩 금지): `@gemini-code-assist` / `chatgpt-codex-connector`(Codex cloud) — 0~2개 모두 처리. codex cloud가 레포에 연결돼 있으면 `@codex review`로 트리거 가능.
봇별로: 수집(대화 `gh pr view --comments` + 인라인 스레드 호스트 API) → 코드로 평가(맹종·맹반 금지) → triage 3갈래(수정+답변 / 답변만 / 반박) → **각 인라인 스레드에 reply(봇 핸들 멘션 포함)** + 필요 시 수정 push. dev/master 이중 PR이면 정합성 교차 확인.
게시 정책: 기본 **draft-first**(답변·수정 초안 보고 후 게시). `--auto-reply`면 자동 게시.

### ⑧ 사람 최종 게이트
draft PR 요약 + 다음 수동 단계(리뷰·머지) 안내. 머지 버튼은 사람.

## Notify (자율 중단 시)
`--auto` 또는 자율 진행이 not converged / stalled repair / execution failure로 멈추면 세션에 사유 + 시도 이력(iteration별 남은 Blocker·Should Fix) + artifacts(`.ai/design.md`, `.ai/implementation-summary.md`, `.ai/claude-verification.md`) + 다음 수동 단계를 출력하고 codex를 재실행하지 않는다. 성공 시엔 도달 iteration·변경 파일·다음 단계(draft PR 링크)를 짧게.
````

- [ ] **Step 3: 정합·안전레일 검증**

편집본을 재독하고 확인: ①안전레일 문구(force push 금지, `--ask-for-approval` 금지, `< /dev/null`)가 전부 남아 있는지, ②MCP 우선 + CLI 폴백이 명시됐는지, ③적응형 게이트·2층 검증·수렴 캡·PR 봇 레포 적응형·게시 정책이 스펙과 일치하는지, ④자기모순 없는지.
Expected: 4개 항목 모두 충족, 모순 없음.

---

## Task 3: `codex-implement.md` / `codex-finalize.md` 정합 갱신

**Files:**
- Modify: `~/.claude/commands/codex-implement.md` (현재 20줄)
- Modify: `~/.claude/commands/codex-finalize.md` (현재 23줄)
- Backup: 각 파일 `.bak`

**Interfaces:**
- Consumes: Task 2의 "MCP 우선, CLI 폴백" 호출 규약.
- Produces: 두 보조 커맨드가 v2 호출 규약과 일치.

- [ ] **Step 1: 백업 생성**

Run:
```bash
cp ~/.claude/commands/codex-implement.md ~/.claude/commands/codex-implement.md.bak
cp ~/.claude/commands/codex-finalize.md ~/.claude/commands/codex-finalize.md.bak
```

- [ ] **Step 2: `codex-implement.md`에 MCP 우선 문구 추가**

`## Command` 섹션의 `codex exec ...` 코드블록 **바로 위**에 다음 문단을 삽입한다(기존 `codex exec` 블록은 폴백으로 보존):

```markdown
**호출 경로**: codex MCP 도구가 등록돼 있으면 그 도구로 아래 프롬프트를 전달한다(stdin hang·exit 파싱 문제 없음). 미등록/실패 시에만 아래 `codex exec` CLI로 폴백한다(백그라운드 실행 시 `< /dev/null` 필수).
```

그리고 코드블록의 `codex exec` 명령 끝에 `< /dev/null`를 추가한다.

- [ ] **Step 3: `codex-finalize.md`에 동일 문구 추가**

`## Command` 섹션에 Step 2와 같은 "호출 경로" 문단을 삽입하고, `codex exec` 명령 끝에 `< /dev/null`를 추가한다.

- [ ] **Step 4: 정합 검증**

두 파일이 Task 2의 호출 규약(MCP 우선 + CLI 폴백 + `< /dev/null`)과 일치하는지, 기존 preconditions·`git status --short` 검토 규칙이 보존됐는지 재독 확인.
Expected: 두 파일 모두 v2 규약과 일치, 기존 규칙 보존.

---

## Task 4: `~/.claude/CLAUDE.md` 전역 규칙 v2 개정

**Files:**
- Modify: `~/.claude/CLAUDE.md`
  - "Claude-design / Codex-implementation 기본 작업방식" 섹션 (`:169`~`:200`)
  - commit 하드룰 문장(`grep "commit"`으로 위치 확인)
  - "PR 봇 리뷰 대응" 섹션(있으면 봇 목록 갱신)
- Backup: `~/.claude/CLAUDE.md.bak`

**Interfaces:**
- Consumes: Task 2 v2 커맨드.
- Produces: 상시 운영 규칙이 파이프라인 v2와 일치.

- [ ] **Step 1: 백업 생성**

Run:
```bash
cp ~/.claude/CLAUDE.md ~/.claude/CLAUDE.md.bak
```

- [ ] **Step 2: "Claude가 Codex를 호출할 때" 하위 항목에 MCP 우선 규약 추가 (`:192`~`:200`)**

기존 "`codex exec --cd <repo> --sandbox workspace-write ...` 형태를 기본으로 한다" 불릿을 아래로 교체한다(기존 `--ask-for-approval` 경고는 폴백 항목으로 보존):

```markdown
- Codex 호출은 **MCP 도구 우선**이다. `codex mcp-server`가 MCP로 등록돼 있으면 그 도구로 호출한다 — CLI의 stdin hang·exit 파싱·백그라운드 무한대기 문제가 없다.
- MCP 미등록/실패 시에만 `codex exec --cd <repo> --sandbox workspace-write "..." < /dev/null` 로 폴백한다(백그라운드 실행 시 `< /dev/null` 필수).
  - **`--ask-for-approval`을 붙이지 말 것.** `codex exec`에 없는 플래그라 `error: unexpected argument`로 즉시 죽는다. 실행 중 방어선은 `--sandbox workspace-write` 하나뿐이고, 사람 관문은 그 앞(적응형 설계 게이트)과 뒤(PR)에 있다.
  - **샌드박스 경계**: `--sandbox workspace-write`의 정책 제약(localhost DB `P1001`, 레포 밖 worktree git `index.lock`)은 MCP로도 안 풀린다 → DB·설치·레포 밖 git은 Claude가 선/후처리한다.
```

- [ ] **Step 3: 자율 파이프라인 소개 문단 추가 (섹션 도입부 `:171` 뒤)**

역할 경계 앞에 다음 문단을 삽입한다:

```markdown
### 자율 파이프라인 (`/codex-flow` v2)

명확·저위험 작업은 사람 개입 없이 **설계 → 구현(Codex) → 2층 검증 → draft PR → PR 봇 루프**까지 자율 진행하고, 사람 관문은 **적응형 시작 게이트 1회 + 최종 PR 검토** 둘뿐이다. 모호·고위험(스키마/데이터, 인증·보안·결제·외부 부작용, 다파일 구조 변경, 되돌리기 어려운 변경)만 시작 시 설계를 1회 확인한다. `--auto`는 시작 게이트까지 건너뛴다. 검증은 결정론 게이트(레포 lint/test/build) + 리스크 기반 병렬 LLM 리뷰(codex review 외부 시각 + omc 서브에이전트) 2층이며, 발견은 적대적으로 재확인(맹종·맹반 금지) 후 codex 수정 위임(수렴 최대 2회).
```

- [ ] **Step 4: commit 하드룰에 자율 예외 명문화**

commit 관련 하드룰 문장(예: "commit은 사용자가 명시 요청한 후에만") 뒤에 다음을 덧붙인다:

```markdown
  - **자율 파이프라인 예외**: `/codex-flow` 자율 진행이 **격리 브랜치/worktree 안에서** 하는 atomic commit은 허용한다(그래야 PR까지 자율로 간다). 단 main·공유 브랜치 직접 커밋과 force push는 여전히 금지. 파이프라인 밖 일반 대화형 세션에는 이 예외가 적용되지 않는다.
```

- [ ] **Step 5: PR 봇 대응 규칙에 레포 적응형 탐지 + 봇 목록 갱신**

"PR 봇 리뷰 대응" 섹션이 있으면 봇 목록에 `chatgpt-codex-connector`를 추가하고, "PR에 실제 코멘트를 단 봇을 런타임에 탐지해 각각 대응(하드코딩 금지, 레포마다 0~2개)"를 명시한다. 섹션이 없으면 위 "자율 파이프라인" 문단의 ⑦ 설명으로 갈음한다.

- [ ] **Step 6: 정합·모순 검증**

편집본을 재독하고 확인: ①MCP 우선/폴백이 Task 2·3과 일치, ②commit 예외가 기존 하드룰과 모순 없이 공존, ③봇 목록·레포 적응형이 스펙과 일치, ④기존 안전레일·handoff 파일 규칙 보존.
Expected: 4개 항목 충족, 모순 없음.

---

## Task 5: e2e 스모크 (실제 작은 작업 1건)

**Files:**
- 대상: 실제 저위험 작은 작업 1건이 있는 아무 레포(예: 문서 오탈자 + 사소 로직). 사용자와 함께 선택.

**Interfaces:**
- Consumes: Task 1~4 전체.
- Produces: 파이프라인 v2가 실제로 draft PR까지 도달한다는 실증.

- [ ] **Step 1: (승인 게이트) 실제 PR 생성 e2e임을 고지하고 대상 작업·레포 승인 받기**

Task 5는 실제 outward(draft PR 생성). 실행 전 대상·승인 확인.

- [ ] **Step 2: 명확·저위험 작업으로 `/codex-flow` 실행 → 적응형 게이트가 통과되는지 확인**

명확한 작업이므로 시작 게이트 없이 자율 진행되어야 한다.
Expected: 시작 게이트 없이 ③ 구현으로 진행.

- [ ] **Step 3: 구현이 MCP 도구 경로로 왕복하는지 확인**

codex 호출이 CLI가 아니라 MCP 도구로 나가고 hang 없이 완료되는지.
Expected: MCP 경로 왕복, hang·exit 2 없음.

- [ ] **Step 4: 2층 검증 분기 확인**

문서 변경만이면 Layer 1 생략, 로직 변경이면 code-reviewer 병렬 발사가 일어나는지 확인.
Expected: 변경 성격에 맞는 리뷰어만 발사.

- [ ] **Step 5: draft PR 생성 + 봇 탐지 확인**

draft PR이 글로벌 규칙 본문으로 생성되고, ⑦에서 붙은 봇(0~2개)을 런타임 탐지하는지. 봇 답변은 기본 draft-first(자동 게시 안 함)여야 함.
Expected: draft PR 생성, 봇 탐지 동작, 답변 초안은 게시 전 보고.

- [ ] **Step 6: 폴백 실증(선택)**

codex MCP를 일시 비활성 후 같은 작업을 돌려 CLI 폴백(`< /dev/null`)으로도 완주하는지 확인.
Expected: CLI 폴백으로 완주.

---

## Self-Review

- **Spec coverage**: 스펙 §3 결정(MCP 승격·폴백=T1/T2/T3/T4, Gemini PR봇 전용=T2 ⑦·T4, 적응형 게이트=T2 ②·T4, PR 게이트=T2 ⑥⑧) / §4.1 2층 검증=T2 ④ / §4.2 봇 루프=T2 ⑦·T4 / §5 commit·게시 정책=T2·T4 Step4 / §6 산출물=T1~T4 / §8 검증방법=T5. 모든 섹션에 대응 태스크 존재.
- **Placeholder scan**: "적절히/TBD/나중에" 없음. 편집 대상 문구는 실제 삽입 텍스트로 제시. 유일한 런타임 미확정치는 codex MCP 도구의 정확한 이름 → T1 Step 3에서 발견해 기록(설계상 불가피, placeholder 아님).
- **Type consistency**: 커맨드/파일 경로·플래그명(`--auto`, `--auto-reply`, `< /dev/null`), 봇 핸들(`@gemini-code-assist`, `chatgpt-codex-connector`), 리뷰어명(`omc:code-reviewer/security-reviewer/critic`)이 Task 전반에서 동일.
