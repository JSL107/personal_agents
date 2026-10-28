# CLAUDE.md

@AGENTS.md

위 AGENTS.md 가 이 레포의 공통 규칙(스택·완료 조건·hard rule·함정·리뷰 봇 규약) 전부다. 공통 규칙은 AGENTS.md 에만 쓰고, 이 파일에는 Claude Code 전용 내용만 둔다.

## Claude Code 도구 활용 (이 레포 한정 권장)

글로벌 OMC 가이드 (`~/.claude/CLAUDE.md`) 와 중복 회피용 — 본 레포에서 가성비 좋은 선택지만 적시.

- **Serena MCP**: 프로젝트 등록됨. 6 memories 보유 (`project_overview`, `hot_paths_and_gotchas`, `code_conventions`, `suggested_commands`, `task_completion_checklist`, `progress_tracking`). 심볼 단위 편집은 `find_symbol` + `replace_symbol_body` 우선 — `Read` 전체 파일 로드 회피.
- **context7 MCP**: NestJS / Prisma / Slack Bolt / BullMQ / class-validator / Octokit API 막힐 때 사용 (학습 데이터 cutoff 보다 최신 docs). 본 레포 의존성 전부 해당.
- **OMC subagent**: 멀티파일 변경 → `executor`, 디버깅 → `debugger`, 테스트 전략 → `test-engineer`, 보안 검토 → `security-reviewer`, 종합 리뷰 → `code-reviewer`.
- **OMC skill**: 큰 자율 작업은 `/ralph` 또는 `/autopilot`. 단 AGENTS.md §7 #1 (commit 정책), §1 완료 조건은 skill 도 준수.
