# V3 §1.3 MCP + RBAC — 도입 결정 (2026-04-30)

V3 Roadmap §1.3 의 MCP+RBAC 도입을 평가하고 **이번 단계에서는 보류**하기로 결정.

## 배경

V3 Roadmap §1.3 (2026-04-29 작성) 은 BE-4 의 git push / PR write / DB 변경 등 외부 부작용에
"단일 권한 토큰" 위험 (Confused Deputy) 이 있다고 보고, 다음을 제안했다:

1. MCP 서버 도입 — GitHub / Slack / DB / 쉘 명령을 MCP server 로 캡슐화
2. RBAC — 작업 단위 token. BE-4 가 "PR 수정" 만 가능, "issue close" 는 불가
3. 감사 로그 — 모든 MCP 호출을 `agent_run.evidence_record` 에 기록

추정: 3주 / TypeScript SDK (`@modelcontextprotocol/sdk`).

## 현재 상태

다음을 검토한 결과, **MCP 즉시 도입의 비용 대비 효익이 낮다**:

### 1) 외부 부작용 surface 가 작음
- GitHub: octokit (read PR / read issue / 향후 PR draft) — 모두 read-only. write 는 #9 BE-4 의 HITL 버튼만, 그것도 sandbox 강화 후로 보류.
- Slack: Bolt App (post message / interactive button). Slack OAuth scope 가 이미 분리.
- DB: Prisma client. 도메인 코드 안에서만 호출 — 에이전트가 직접 DB 쓰지 않음.
- 쉘: SandboxModule 의 Docker 일회성 컨테이너 (V3 §1.2). 호스트 mount 는 default `:ro`.

각 surface 가 이미 모듈 경계 안에 캡슐화돼 있고, write 권한이 필요한 흐름은 모두
HITL (사용자 ✅ 클릭) 을 거친다.

### 2) 현재 위협 모델은 LLM-output 위조 / 호스트 fs 변조
- preview-gate (PO-2) 가 부작용 명령에 대한 ✅ 게이트를 이미 제공.
- BE-Test (V3 §8) MVP 에서 codex audit P1 에 따라 LLM 생성 spec 의 호스트 fs 작성 / sandbox call 을 모두 제거. self-correction 루프는 sandbox 디자인 강화 (read-only mount + tmpfs spec) 후 재도입.
- Sandbox MVP (V3 §1.2) 가 mount default `:ro` / `--network none` / shell injection 차단을 이미 제공.

→ MCP 가 해결하는 위협 (Confused Deputy via 단일 토큰) 은 아직 표면화되지 않음. 표면화되는 시점은:
- BE-4 의 auto fix branch push 가 자동화될 때 (아직 슬래시 + HITL 단계)
- BE-1 의 PR draft 자동 생성이 도입될 때 (아직 슬래시 분석 단계)

### 3) MCP SDK 도입 비용
- `@modelcontextprotocol/sdk` 의존성 + 별도 process / IPC 디자인 / 감사 로그 schema.
- 현재 NestJS DI 안에서 GithubModule / SlackModule 이 독립 권한 객체로 작동 — 같은 캡슐화 기능을 이미 제공.
- MCP 의 핵심 가치는 "외부 도구를 LLM 이 호출" 인데, 우리는 LLM 이 도구를 직접 호출하지 않고 NestJS 도메인 코드가 LLM 결과를 받아 도구를 호출함. 즉 MCP 의 가치 곡선이 이 아키텍처에 평평하다.

## 결정

**MCP+RBAC 도입은 다음 trigger 가 발생할 때까지 보류**:

1. BE-4 의 auto fix branch push 가 자동화 단계로 진입 (지금은 슬래시 분석 only)
2. 외부 토큰 (GitHub PAT / Slack Bot token) 의 권한 분리가 실제 운영에서 위험으로 표면화 (예: 한 토큰 leak → repo 전체 write 노출)
3. 이대리가 DB / shell 등 추가 부작용 surface 를 LLM 직접 결정으로 노출하기 시작

각 trigger 에 대해 다음 행동:
- (1): MCP 보다 먼저 GitHub fine-grained PAT 으로 권한 축소 + 감사 로그를 `agent_run.evidence_record` 에 기록 (이미 인프라 있음). MCP 는 이 단계 후에도 추가 가치 부족 시 도입 안 함.
- (2): 토큰별로 환경변수 분리 + 모듈별 권한 격리 강화. 단계적 평가 후 MCP 도입.
- (3): 그 surface 가 정말 LLM 직접 결정이 안전한가? 안전하지 않다면 surface 자체를 줄임. 안전하면 MCP 검토.

## 그 사이 안전망 강화 (이번 단계 적용)

MCP 도입 없이도 다음으로 위협 모델을 좁힌다:

1. **Sandbox `:ro` default** — 이미 V3 §1.2 MVP 적용 (commit `c5f6754`).
2. **BE-Test self-correction 루프 제거** — 이미 V3 §8 MVP 적용 (commit `3e5e887`).
3. **GitHub octokit 토큰 권한 점검** — 별도 작업: `repo` scope 가 필요한 흐름이 어디인지 정리하고, 가능한 경우 fine-grained PAT 으로 축소. (TODO)
4. **agent_run.evidence_record 의 외부 부작용 기록 표준화** — 이미 PreviewActionRepository / PM-2 PreviewGate 가 트랜잭션 레코드 남김. BE-4 의 auto write 가 도입될 때 같은 패턴 확장.

## 향후 재검토 시점

- BE-4 (#9) 가 슬래시 분석에서 자동 PR write 단계로 넘어갈 때
- BE-1 (#7) 이 자동 PR draft 생성 단계로 넘어갈 때
- 또는 외부 보안 사고가 발생한 직후

이 시점에 본 문서를 업데이트하거나 별도 plan 으로 분리.

## 참조

- V3 Roadmap: `docs/superpowers/plans/2026-04-29-v3-roadmap.md` §1.3
- BE-Test audit: codex review P1.1 / P1.2 (2026-04-30 turn)
- Sandbox MVP: commit `c5f6754`
- BE-Test MVP: commit `3e5e887`
