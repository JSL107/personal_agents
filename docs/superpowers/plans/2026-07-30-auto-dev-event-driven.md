# 자동 개발 이벤트드리븐 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) 로 태스크별 실행. Steps use checkbox (`- [ ]`).

**Goal:** 파일 drop·GitHub 이슈·cron으로 사람 없이 `/codex-flow --auto`를 headless 실행해 draft PR까지 만들고 Slack DM으로 통지하는 독립 런처를 `~/.claude/auto-dev/`에 만든다.

**Architecture:** 태스크 큐 하나 + 공급원 2(파일 drop, GitHub 이슈 sync) + 드레인 2(launchd watcher/cron) + 공통 런처(headless claude -p). 무인이라 안전 가드가 1급 요구사항.

**Tech Stack:** bash, launchd(plist), `gh` CLI, `claude -p` headless, `codex mcp-server`(user MCP), Slack incoming webhook.

## Global Constraints

- **대상은 전역 `~/.claude/auto-dev/`** (git repo 아님). 신규 생성이라 백업 불필요, 단 launchd 등록/해제는 되돌릴 수 있게 문서화.
- **안전 불변식 (모든 스크립트가 지킴)**: draft PR만 · main 직접 push 금지 · auto-merge/deploy 금지 · allowlist 레포만 · 격리 worktree · 동시성 1 · 일일 상한 · `DISABLED` 존재 시 즉시 중단.
- **시크릿 커밋 금지**: Slack webhook/토큰은 `config.json`(gitignore 대상 경로, 저장소 밖 `~/.claude`)에만.
- **codex probe 선행**: 절전 후 codex 미준비 실패 예방.
- **정본 스펙**: `docs/superpowers/specs/2026-07-30-auto-dev-extension-design.md`.

### 태스크별 TDD 여부

| Task | 성격 | TDD | 검증 |
|---|---|---|---|
| 1 골격+config+lib | 설정/유틸 | 아니오 | shellcheck + 함수 단위 dry-run |
| 2 notify.sh | 통합(Slack) | 아니오 | 실제 webhook 1회 발송 |
| 3 drain.sh | 핵심 런처 | 아니오 | DISABLED/상한/락 dry-run + mock task |
| 4 github-sync.sh | 통합(gh) | 아니오 | 라벨 이슈 1건 sync + dedupe 확인 |
| 5 launchd plists | 설정 | 아니오 | load 후 watcher/cron 발화 확인 |
| 6 e2e | 실증 | 아니오 | 실제 저위험 태스크 → draft PR (승인 후) |

셸/설정이라 단위 TDD 대상 없음. 검증은 shellcheck + dry-run + 실증.

---

## Task 1: 골격 + config.json + lib.sh

**Files:**
- Create: `~/.claude/auto-dev/{queue,running,done,logs,bin,launchd}/` (디렉터리)
- Create: `~/.claude/auto-dev/config.json`
- Create: `~/.claude/auto-dev/bin/lib.sh`

**Interfaces (lib.sh가 제공, 다른 스크립트가 소비):**
- `ad_enabled()` → `DISABLED` 파일 없고 config.enabled=true 면 0, 아니면 1
- `ad_config <jq-path>` → config.json 값 읽기 (jq)
- `ad_repo_allowed <path>` → allowlist에 있으면 0
- `ad_lock_acquire` / `ad_lock_release` → running/ 락으로 동시성 1
- `ad_daily_count` / `ad_daily_inc` → logs/ 기반 오늘 실행 수, 상한 비교
- `ad_codex_probe` → codex MCP/CLI 왕복 probe, 준비되면 0
- `ad_log <msg>` → logs/YYYY-MM-DD.log 기록

- [ ] **Step 1: 디렉터리 골격 생성**

Run: `mkdir -p ~/.claude/auto-dev/{queue,running,done,logs,bin,launchd}`

- [ ] **Step 2: config.json 작성**

```json
{
  "enabled": true,
  "dailyMax": 5,
  "slackWebhookUrl": "",
  "allowlist": [
    { "repo": "/Users/juneseok/Desktop/backend/기타/personal_agents", "base": "main" }
  ]
}
```
(slackWebhookUrl은 Task 2에서 채움. allowlist는 실제 대상 레포로.)

- [ ] **Step 3: lib.sh 작성 후 shellcheck**

위 Interfaces 함수들을 구현. Run: `shellcheck ~/.claude/auto-dev/bin/lib.sh`
Expected: 경고 없음(또는 의도된 것만).

- [ ] **Step 4: 함수 dry-run**

`source lib.sh` 후 `ad_enabled; echo $?`, `ad_repo_allowed <allowed>`, `<not-allowed>` 각각 기대값 확인. `touch ~/.claude/auto-dev/DISABLED` 후 `ad_enabled`가 1 반환하는지, 지우면 0인지.

---

## Task 2: notify.sh (Slack DM)

**Files:** Create `~/.claude/auto-dev/bin/notify.sh`

**Interfaces:**
- Consumes: `ad_config .slackWebhookUrl`
- Produces: `notify "<title>" "<body>"` → Slack 발송(webhook 미설정이면 로그만, 실패해도 파이프라인 안 죽임)

- [ ] **Step 1: Slack webhook 확보**

사용자에게 incoming webhook URL을 받거나 기존 이대리/Hermes 경로 재사용 결정. `config.json`의 slackWebhookUrl에 기입(커밋 금지).

- [ ] **Step 2: notify.sh 작성 + shellcheck**

`curl -sf -X POST -H 'Content-type: application/json' --data "{\"text\":...}" "$url"`. webhook 빈 값이면 `ad_log`만.

- [ ] **Step 3: 실제 1회 발송 스모크**

Run: `~/.claude/auto-dev/bin/notify.sh "auto-dev test" "hello"` → Slack에 도착 확인.

---

## Task 3: drain.sh (핵심 런처)

**Files:** Create `~/.claude/auto-dev/bin/drain.sh`

**Interfaces:**
- Consumes: lib.sh 전부, notify.sh
- 동작: 안전 가드 통과 시 큐에서 1건 → allowlist worktree에서 headless `/codex-flow --auto` → draft PR → notify → done/ 이동

- [ ] **Step 1: 안전 가드 시퀀스 구현 (순서 고정)**

```
1. ad_enabled 아니면 즉시 exit (kill switch / disabled)
2. ad_daily_count >= dailyMax 면 로그 남기고 exit (다음 주기)
3. ad_lock_acquire 실패(이미 실행 중)면 exit (동시성 1)
4. 큐에서 가장 오래된 *.task.md 1건 선택, 없으면 unlock 후 exit
5. task의 repo가 ad_repo_allowed 아니면 → done/rejected 이동 + notify + unlock
6. ad_codex_probe 실패면 → task 큐에 남기고 notify(보류) + unlock (다음 주기 재시도)
```

- [ ] **Step 2: 격리 worktree + headless 실행**

allowlist repo에서 `git worktree add`(ASCII 경로), 그 안에서:
```
claude -p "/codex-flow --auto $(task 설명)" \
  --permission-mode acceptEdits   # headless 권한 (실측값으로 조정)
```
codex-flow가 설계→구현→검증→draft PR까지. base는 config의 base.

- [ ] **Step 3: 결과 처리**

성공(draft PR 링크 파싱) → notify(PR 링크) + task done/ 이동 + `ad_daily_inc`. 실패 → notify(사유 + 로그 경로) + task done/failed 이동. 항상 `ad_lock_release`.

- [ ] **Step 4: shellcheck + dry-run**

`shellcheck drain.sh`. `DISABLED` 존재 시 즉시 exit 확인. mock task(allowlist 아닌 repo)로 rejected 경로 확인. dailyMax=0으로 상한 exit 확인. 실제 codex 실행은 Task 6에서.

---

## Task 4: github-sync.sh (이슈 → 큐)

**Files:** Create `~/.claude/auto-dev/bin/github-sync.sh`

**Interfaces:**
- Consumes: lib.sh
- 동작: allowlist repo마다 `gh issue list --label auto-dev --state open` → 각 이슈를 큐 파일로 + `auto-dev-running` 라벨로 잠금(dedupe)

- [ ] **Step 1: 작성**

repo마다 `gh -R <owner/repo> issue list --label auto-dev --json number,title,body`. 각 이슈 → `queue/gh-<repo>-<num>.task.md`(repo 경로 + 제목/본문 → 작업 설명 + 출처=issue#). 그 후 `gh issue edit <num> --add-label auto-dev-running --remove-label auto-dev`.

- [ ] **Step 2: shellcheck + dedupe 확인**

라벨 이슈 1건 만들어 sync → 큐 파일 1개 생성 + 라벨 전환 확인. 재실행 시 (라벨 없어졌으므로) 중복 큐 안 생기는지 확인.

---

## Task 5: launchd plists (watcher + cron)

**Files:**
- Create `~/.claude/auto-dev/launchd/auto-dev-watch.plist` (WatchPaths=queue/ → drain.sh)
- Create `~/.claude/auto-dev/launchd/auto-dev-cron.plist` (StartInterval → github-sync.sh && drain.sh)

- [ ] **Step 1: plist 작성**

watch: `WatchPaths` = `~/.claude/auto-dev/queue`, ProgramArguments = drain.sh. cron: `StartInterval`(예: 900초), ProgramArguments = sync 후 drain 하는 래퍼. 둘 다 StandardOut/Error → logs/.

- [ ] **Step 2: load + 발화 확인**

`launchctl load ~/.claude/auto-dev/launchd/*.plist`. queue/에 파일 touch → watcher가 drain 발화(logs 확인). cron 간격 후 sync+drain 발화 확인. 되돌리기: `launchctl unload`.

---

## Task 6: e2e 스모크 (실증, 승인 후)

- [ ] **Step 1: (승인 게이트) 실제 무인 draft PR 생성 e2e 고지 + 대상 확인**

- [ ] **Step 2: 저위험 태스크 파일 drop → watcher → draft PR + Slack DM 확인**

- [ ] **Step 3: 라벨 이슈 → cron sync → draft PR + dedupe 확인**

- [ ] **Step 4: DISABLED / dailyMax 안전 가드 실증**

`touch DISABLED` 후 태스크 drop → 실행 안 됨 확인. dailyMax 도달 후 보류 확인.

---

## Self-Review

- **Spec coverage**: §4 Part A(별도 적용 완료) / §5 아키텍처=T1~T5 / §6 파일구조=T1~T5 / §7 안전모델=T3 Step1 가드 + T5 + config / §9 검증=T6. 전 항목 대응.
- **Placeholder scan**: config.json·가드 시퀀스·plist 키는 구체. 실제 셸 본문은 빌드 단계 산출물(계약·검증 스텝은 명시). headless `--permission-mode` 정확값은 T3에서 실측 조정(불가피).
- **Type consistency**: lib.sh 함수명(`ad_*`)이 T2~T4에서 동일 사용. 큐 파일 규약(`queue/*.task.md`, repo 경로+설명+출처) 일관.
