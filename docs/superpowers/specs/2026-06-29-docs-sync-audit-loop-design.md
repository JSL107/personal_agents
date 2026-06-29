# docs-sync-audit 자율 루프 — 설계 (Phase 1)

- 작성일: 2026-06-29
- 상태: 설계 승인 대기 (brainstorming → writing-plans 전 단계)
- 주제: 문서↔코드 동기화를 점검하는 주간 autopilot task. **루프 엔지니어링 학습용 + 실용** 겸용.
- 관련: `knowledge-lint` 시리즈(#115~#118, 형제 패턴), `scripts/sync-docs.ts`(결정론 generator), `harness-engineering-design.md`(계열)

---

## 1. 배경 (Why)

이 레포는 코드↔문서 동기화를 두 갈래로 다룬다.

- **결정론 영역**: `scripts/sync-docs.ts`([scripts/sync-docs.ts:225-241](../../../scripts/sync-docs.ts#L225-L241))가 `AGENT_REGISTRY`·`app.config.ts`·`model-router`에서 `docs/agent-catalog.md`·`docs/env-catalog.md`를 **기계적으로 생성**한다. `pnpm docs:check`가 드리프트 시 `exit 1`. 즉 이 영역의 드리프트는 `pnpm docs:sync` 한 방으로 100% 해결 — LLM 불필요.
- **의미 영역 (갭)**: 같은 스크립트가 [sync-docs.ts:11](../../../scripts/sync-docs.ts#L11)에서 *"손으로 큐레이션된 README는 일부러 덮지 않는다"* 고 명시한다. README·CLAUDE.md의 자연어 서술은 코드가 바뀌면 **의미적으로** 드리프트하지만, 결정론 generator가 못 잡는다. 이 갭을 메우려면 "코드 변경의 의미를 읽고 문서 설명이 여전히 맞는지" 판단하는 LLM이 필요하다.

메모리 `feedback_docs_sync_check.md`에 *"agent-registry/AgentType/env 변경 시 docs:check 필수, 로컬 3중 green엔 없어 CI verify만 잡음"* 이 실제 페인포인트로 기록돼 있다 — 의미 영역 드리프트는 더더욱 자동 점검이 없다.

**학습 동기**: 두 영역을 한 task에 담으면 *"왜 어떤 검증은 한 방이고 어떤 검증은 루프가 필요한가"*(검증자가 결정론적이냐 주관적이냐)를 코드로 대조할 수 있다. 루프 엔지니어링의 4요소(행동·검증·종료·자기수정)와 컨텍스트 엔지니어링 4레버(write·select·compress·isolate)를 실물로 익히는 게 목표.

## 2. 목표 / 비목표

**목표 (성공 기준)**
- 주간 cron으로 도는 읽기 전용 `docs-sync-audit` autopilot task 신설.
- Layer 1(결정론)·Layer 2(LLM 자기수정 루프) 두 레이어를 한 task에 담는다.
- Layer 2가 evaluator-optimizer 루프로 **green(judge 통과) 또는 종료조건까지 자율 반복**하며, 검증된 수정 제안을 Slack으로 보고한다.
- `pnpm lint:check && pnpm test && pnpm build` 3중 green.

**비목표 (범위 밖)**
- 문서 자동 수정·커밋 (Phase 2, `T1_PREVIEW`).
- autopilot↔PreviewGate 오케스트레이션 신규 구현 (Phase 2 / autopilot SP4).
- `sync-docs.ts` 자체 수정 (그대로 호출만).
- 결정론 카탈로그를 LLM으로 다시 점검 (불필요 — `docs:check`로 충분).

## 3. 확정 결정 (brainstorming 산출)

| 항목 | 결정 | 근거 |
|---|---|---|
| 학습 성격 | 실용 + 학습 하이브리드 | 사용자 선택 |
| 자율성 | 자율(내부 반복), 적용은 Phase 2 | "자율 = 수렴까지 사람 개입 없이 돎"은 루프 내부로 충족, 비가역 변경만 분리 |
| 대상 | Layer1 결정론 카탈로그 + Layer2 README/CLAUDE.md 의미 | 두 영역 대조가 학습 핵심 |
| 트리거 | 주간 cron (autopilot task) | knowledge-lint 형제, 문서 드리프트는 천천히 쌓임 |
| LLM | ChatGPT (codex) — optimizer/evaluator 둘 다 | knowledge-lint L4와 동일, 의미 판정에 적합 |
| Layer2 범위 | 최근 git 변경 기반 (just-in-time) | 컨텍스트 절약, 중복 점검 회피 |
| riskTier | `T0_AUTO` (읽기 전용, 비가역 0) | 기존 오케스트레이터에서 바로 동작 |

## 4. 설계

### 4.1 두 레이어

**Layer 1 — 결정론 게이트 (LLM 없음, 루프 없음)**
- `pnpm docs:check`(자식 프로세스) + `pnpm check:env` 실행, exit code로 판정.
- 드리프트 시 → *"`pnpm docs:sync` 실행 후 커밋하면 해결"* 안내 + drift 파일 목록.
- 루프가 없는 이유를 spec·코드 주석에 명시: 검증자가 결정론적 → 수정도 결정론적(한 방). **이 대조가 학습 포인트.**

**Layer 2 — LLM 자기수정 루프 (evaluator-optimizer)**
- 입력: 지난 주기 이후 git 변경에서 건드린 **SoT 파일**(agent-registry, app.config, model-router 등 사전 정의된 화이트리스트) + 그와 연관된 문서 섹션(README/CLAUDE.md).
- 루프:
  ```
  ① optimizer(codex): "이 코드 변경 기준으로 이 문서 문단이 어긋났나? 어긋났으면 수정안 diff 생성"
  ② evaluator(codex, 별도 호출): "이 수정안이 코드와 정확히 일치? 과/부족 수정 없나?" → {pass, score, feedback}
  ③ pass면 종료 / 아니면 feedback 들고 ①로 (반복캡까지)
  ```
- 출력: 검증 통과한 수정 제안(문서/섹션/제안 diff/신뢰도). 없으면 빈 결과.

### 4.2 루프 4요소 ↔ 코드 매핑 (학습 체크포인트)

| 요소 | Layer 1 | Layer 2 |
|---|---|---|
| 행동 | `docs:sync` 안내 | optimizer 수정안 생성 |
| 검증 | `docs:check` exit code (기계) | evaluator LLM 채점 (← "검증자가 병목") |
| 종료 | drift 0 | judge green / 반복캡 / Circuit Breaker |
| 자기수정 | 없음 (결정론) | judge feedback → 재생성 |

### 4.3 컴포넌트 (knowledge-lint 형제 구조)

```
src/docs-audit/                                          # 신규 모듈 (knowledge-lint이 episodic-memory에 산 것처럼 독립)
  ├─ domain/port/docs-audit.port.ts                      # DOCS_AUDIT_PORT + Layer1/Layer2 결과 타입
  ├─ application/run-docs-audit.usecase.ts               # 자율 루프 본체 (optimizer↔evaluator + 종료조건)
  └─ infrastructure/
      ├─ deterministic-docs.checker.ts                   # docs:check / check:env 자식 프로세스 실행
      └─ codex-docs-judge.adapter.ts                     # model-router 경유 codex 호출 (optimizer/evaluator)
src/autopilot/infrastructure/tasks/docs-sync-audit.autopilot-task.ts   # AutopilotTask 구현 (id='docs-sync-audit')
src/slack/format/docs-audit.formatter.ts                 # slackText 렌더 (mrkdwn escape)
src/autopilot/domain/autopilot.playbook.ts               # AUTOPILOT_PLAYBOOK 항목 추가 (riskTier: 'T0_AUTO')
src/autopilot/domain/autopilot.playbook-defaults.ts      # DEFAULT_DOCS_AUDIT_CRON / _TIMEZONE
src/config/app.config.ts (+ .env.example + .env + README) # env 게이트 4곳 동기
```

### 4.4 데이터 흐름

```
주간 cron → autopilot scheduler → orchestrator.runGroup
  → DocsSyncAuditTask.run({ ownerSlackUserId, firedAtKst })
      → RunDocsAuditUseCase.execute()
          ├─ Layer 1: DeterministicDocsChecker (docs:check / check:env)
          └─ Layer 2: optimizer↔evaluator 루프 (CodexDocsJudgeAdapter)
      → 이슈 0건이면 { skip: true }
      → 아니면 { skip: false, slackText: formatDocsAudit(...) }
  → orchestrator가 owner digest 로 fan-out
```

## 5. 안전장치 (루프 엔지니어링 패턴 직접 적용)

- **Bounded Execution**: Layer 2 반복 최대 N회 (`DOCS_AUDIT_MAX_ITERATIONS`, 기본 3) — loopmaxxing 차단.
- **Circuit Breaker**: evaluator score가 2회 연속 개선 없으면 중단(정체 감지) → 그때까지의 최선 제안을 "미확정"으로 표기 보고.
- **쿼터 가드 + env 게이트**: `DOCS_AUDIT_ENABLED`(미설정 시 활성, 'false'만 비활성), `DOCS_AUDIT_MAX_FILES`(codex 쿼터 보호, 기본 5) — knowledge-lint L4 패턴 그대로.
- **읽기 전용**: 파일 절대 미수정 → 비가역 부작용 0 → `T0_AUTO`. 자동 커밋 없음([CLAUDE.md](../../../CLAUDE.md) §2 #1 준수).
- **skip 패턴**: 이슈 0건 → `{ skip: true }` (빈 알림 방지).
- **task 격리**: orchestrator try/catch가 task 런타임 실패를 그룹 단위로 격리([autopilot.orchestrator.ts:52-67](../../../src/autopilot/application/autopilot.orchestrator.ts#L52-L67)) — 기존 보장 활용.

## 6. 컨텍스트 엔지니어링 (4레버 적용)

- **select (just-in-time)**: 전체 코드베이스 X → git 최근 변경이 건드린 SoT 화이트리스트 + 관련 문서 섹션만 codex에 투입.
- **isolate**: optimizer와 evaluator를 **별도 codex 호출**로 분리 — 자기 답을 자기가 채점하는 편향 방지(adversarial verify 정신).
- **compress**: 반복 시 전체 히스토리 X → 직전 evaluator feedback만 다음 optimizer에 전달.
- **write**: (Phase 1 범위 밖. Phase 2에서 AgentRun에 루프 결과 기록 검토.)

## 7. 검증 신호 설계

- **Layer 1**: `docs:check`/`check:env` 종료 코드 — 결정론, 신뢰도 100%.
- **Layer 2**: evaluator codex 호출이 `{ pass: boolean, score: 0-100, feedback: string }`을 반환하도록 강제(JSON). pass 기준선은 env가 아닌 상수(예: score >= 90 && pass). 파싱 실패는 명시 에러로 끊고 그 반복은 미통과 처리.

## 8. env 추가 (4곳 동기: .env.example + .env + app.config.ts + README)

| 키 | 필수 | 설명 |
|---|---|---|
| `DOCS_AUDIT_ENABLED` | ❌ | 'false'면 Layer 2 비활성(Layer 1은 유지). 미설정 시 활성 |
| `DOCS_AUDIT_MAX_FILES` | ❌ | Layer 2가 점검할 최대 파일 수 (codex 쿼터 가드, 기본 5) |
| `DOCS_AUDIT_MAX_ITERATIONS` | ❌ | Layer 2 자기수정 반복 캡 (기본 3) |
| `DOCS_AUDIT_CRON` | ❌ | cron 패턴 override (기본: 주간) |

## 9. 테스트 전략

- `run-docs-audit.usecase.spec.ts`: optimizer/evaluator를 mock — (a) 1회 pass 종료, (b) 반복캡 도달, (c) Circuit Breaker 정체 중단, (d) Layer1 drift만 있고 Layer2 클린.
- `docs-sync-audit.autopilot-task.spec.ts`: 이슈 0건 → skip, 이슈 있음 → slackText 포함 (knowledge-lint task spec 미러).
- `deterministic-docs.checker.spec.ts`: 자식 프로세스 exit code 매핑.
- `autopilot.playbook.spec.ts`: 신규 항목 등록·중복 id 검사 통과 확인.

## 10. Phase 2 로드맵 (범위 밖 — 별도 spec/plan)

`T1_PREVIEW` 경로(autopilot SP4): Layer 2의 검증된 수정안을 격리 worktree에 적용 → `docs:check` green 확인 → PreviewGate `create-preview`로 Slack 승인 → `apply-preview`. autopilot↔PreviewGate 오케스트레이션([autopilot.orchestrator.ts:39-43](../../../src/autopilot/application/autopilot.orchestrator.ts#L39-L43)의 `T1_PREVIEW throw` 해제 포함) 신규 구현 필요. Phase 1 완료·운영 관찰 후 착수.

## 11. 미해결 / 리스크

- **codex 출력 안정성**: optimizer/evaluator JSON 파싱 실패 가능 → 명시 에러 + 해당 반복 미통과 처리로 방어. (knowledge-lint L4도 동일 리스크 안고 운영 중.)
- **"관련 문서 섹션" 매핑**: SoT 파일 → 문서 섹션 연결을 어떻게? Phase 1은 단순 휴리스틱(파일명/키워드 매칭)으로 시작, 정교화는 후속.
- **git 변경 범위 산정**: "지난 주기 이후"를 어떻게 계산? 마지막 성공 실행 시각 또는 `git log --since`. 구현 계획에서 확정.
