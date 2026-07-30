# 자동 개발 확장 — 규모 자동 판정 + 이벤트드리븐 트리거 설계

작성일: 2026-07-30
전제: `2026-07-30-multi-ai-mcp-pipeline-design.md`(v2 파이프라인)의 확장. 그 위에 두 가지를 얹는다.

---

## 1. 문제 (Why)

v2 파이프라인은 강력하지만 두 가지 결함이 남았다.

- **허들 위험.** v2 초안 규칙이 "자연어 요청 = 파이프라인"처럼 읽혀, 오탈자·로그 한 줄 같은 작은 일까지 설계→검증→PR ceremony를 태울 소지가 있었다. 가벼운 개발이 막히면 안 된다.
- **트리거가 사람뿐.** 파이프라인을 시작하려면 사람이 세션에서 무언가 입력해야 한다. 이벤트(이슈 등록 등)로 사람 없이 시작되는 경로가 없다.

## 2. 목표 (What)

- 자연어 개발의 기본은 **casual(직접, ceremony 0)**. 규모 있고 위험한 일만 자동으로 파이프라인. 애매하면 casual로 기운다.
- 이벤트(파일 drop·GitHub 이슈·스케줄)로 사람 없이 파이프라인이 **draft PR까지** 자율 진행하고, 결과를 Slack DM으로 통지한다.
- 무인 실행이 프로덕션·main·머지를 건드리지 않는다.

## 3. 확정 결정

| 항목 | 결정 |
|---|---|
| Part A 경계 | **규모 자동 판정**. casual 기본, 큰·위험만 파이프라인, 애매하면 casual, 양방향 override |
| Part B 이벤트 소스 | 로컬 파일 watcher · GitHub 이슈(label) · cron 스케줄 큐 (3소스가 큐 하나로 수렴) |
| 런처 호스트 | 독립 `~/.claude/auto-dev/` (launchd watcher + cron) |
| 알림 | Slack DM (기존 경로 재사용) |
| 안전모델 | draft-only + allowlist 레포 + 격리 worktree + dedupe + 동시성 1·일일 상한 + kill switch + codex probe + 알림 |

## 4. Part A — 규모 자동 판정 (허들 방지)

`~/.claude/CLAUDE.md`의 자율 파이프라인 규칙에 반영(이미 적용됨).

- **기본 casual**: 오탈자·로그·주석·한두 줄 수정·단일 함수·디버깅 반복·설정 조정 → 파이프라인 없이 직접.
- **파이프라인 자동**: 새 기능·다파일 리팩토링·스키마/데이터·인증·보안·결제·외부 부작용.
- **애매하면 casual로 기울고**, 필요할 때만 "파이프라인으로 갈까요?" 한 줄 제안(자동으로 무겁게 끌고 가지 않음).
- **양방향 override**: "그냥 빨리"·"직접"·"ceremony 없이" → 강제 casual / `/codex-flow`·"PR까지 해줘"·"파이프라인으로" → 강제 파이프라인.

명시 호출(`/codex-flow`)은 규모 판정을 거치지 않는다(명시 = 파이프라인).

## 5. Part B — 이벤트드리븐 아키텍처

```
[공급] ① 로컬 파일 drop     ─┐
       ② GitHub 이슈 sync   ─┤→  태스크 큐  ~/.claude/auto-dev/queue/*.task.md
                             ┘        (레포 경로 + 작업 설명 + 출처)
[드레인] launchd WatchPaths(즉시) / launchd StartInterval(주기)
[런처]   drain.sh  →  claude -p "/codex-flow --auto <task>"  (headless, allowlist 레포의 격리 worktree)
[결과]   draft PR 생성(codex-flow ⑥) + Slack DM 통지 + 태스크 done/ 이동
```

- **큐가 단일 substrate**: 파일 drop과 GitHub 이슈 sync가 모두 큐 파일을 만들고, watcher(즉시) 또는 cron(주기)이 큐를 드레인한다. 세 소스가 별개 코드가 아니라 하나로 수렴.
- **GitHub 이슈 sync**: cron이 allowlist 레포에서 `gh issue list --label auto-dev --state open`을 폴링 → 각 이슈를 큐 파일로 변환 → 이슈에 `auto-dev-running` 라벨을 달아 잠금(dedupe).
- **런처**: 큐에서 가장 오래된 태스크 1건을 집어 락(동시성 1) 획득 → codex probe → allowlist 레포의 격리 worktree에서 `claude -p "/codex-flow --auto ..."` headless 실행. codex-flow가 설계→구현→검증→draft PR까지 처리.

## 6. 파일 구조 (구현 단위)

```
~/.claude/auto-dev/
  config.json         # allowlist 레포, 일일 상한, Slack webhook, enabled 플래그
  queue/*.task.md     # 대기 태스크 (레포 경로 + 설명 + 출처 메타)
  running/            # 락 파일 (동시성 1)
  done/               # 처리 완료 태스크 (감사 기록)
  logs/               # 실행 로그
  DISABLED            # 존재하면 전체 정지 (kill switch)
  bin/
    drain.sh          # 큐 드레인 + headless 런처 (핵심)
    github-sync.sh    # GitHub 이슈 → 큐 (dedupe 라벨)
    notify.sh         # Slack DM helper (webhook)
    lib.sh            # 공통: config 읽기, 락, probe, 로깅
  launchd/
    auto-dev-watch.plist    # WatchPaths=queue/ (즉시 드레인)
    auto-dev-cron.plist     # StartInterval (github-sync + 드레인, 주기)
```

## 7. 안전모델 (무인이라 최우선)

- **draft PR만.** auto-merge·main 직접 push·release/deploy 금지. 사람이 PR에서 최종 머지.
- **allowlist 레포.** `config.json`에 명시된 레포에서만 실행. 임의 레포 금지.
- **격리 worktree.** headless 실행 권한을 그 worktree로 국한.
- **dedupe.** GitHub 이슈는 `auto-dev-running` 라벨로 잠가 중복 발사 방지. 파일 큐는 running/ 락 + done/ 이동으로 방지.
- **동시성 1 + 일일 상한.** 런어웨이·쿼터 폭주 방지. 상한 도달 시 큐는 남기고 다음 주기로.
- **kill switch.** `~/.claude/auto-dev/DISABLED` 파일 존재 시 모든 실행 즉시 중단.
- **codex readiness probe.** 절전 후 codex 미준비로 실패하던 문제(과거 morning-briefing) 예방 — 실행 전 codex 왕복 probe, 미준비면 보류하고 다음 주기.
- **알림.** PR 생성/실패/보류를 Slack DM으로 통지.

## 8. 정직한 제약 / 리스크

- **headless 권한**: `claude -p`는 권한 프롬프트를 못 받으므로 skip-permissions 또는 광범위 allowlist가 필요하다 → 그 worktree 안에선 사실상 광범위 권한. draft-only + allowlist + worktree 격리가 방어선이지만 "무인 에이전트가 코드를 짠다"는 리스크 자체는 남는다.
- **쿼터**: Claude + codex 쿼터를 무인 반복이 소모 → 일일 상한 필수. codex config MCP 오염(죽은 MCP로 지연) 재발 시 probe에서 걸러야 한다.
- **Slack 토큰**: 독립 런처가 Slack을 쓰려면 webhook URL 또는 봇 토큰이 필요하다 → `config.json`에 두거나 기존 이대리/Hermes 경로 재사용. 시크릿은 커밋 금지.
- **검증 한계**: 무인 e2e는 실제 이슈·실제 draft PR을 만들어야 완전 검증된다 → 빌드 후 dry-run 스모크 + 실 1건 라이브 검증(사람 참관)으로 닫는다.

## 9. 검증 방법

- `config.json`에 test 레포 1개 allowlist. 큐에 저위험 태스크 파일 1개 drop → watcher가 드레인 → draft PR 생성 + Slack DM 도착 확인.
- GitHub 이슈에 `auto-dev` 라벨 → cron sync가 큐 생성 + `auto-dev-running` 라벨 확인, 재폴링 시 중복 안 만드는지 확인.
- `DISABLED` 파일 생성 → 아무 것도 실행 안 되는지 확인.
- 일일 상한 도달 시 큐 보류 + 다음 주기 재개 확인.

## 10. 범위 밖 / 후속

- GitHub PR 코멘트 트리거(`@codex-flow fix`)는 이번 소스에서 제외(선택됨). 후속.
- 완전 자율 머지·deploy는 영구 범위 밖.
- 웹 대시보드·큐 GUI는 범위 밖(로그·done/ 폴더로 갈음).
