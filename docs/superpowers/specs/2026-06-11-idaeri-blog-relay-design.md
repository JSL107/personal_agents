# 이대리 BLOG 릴레이 — 설계 (이대리 → Hermes)

- 작성일: 2026-06-11
- 대상: 이 레포(personal_agents / 이대리, NestJS)
- 의존: [Hermes tistory-blog 스킬](2026-06-11-tistory-blog-skill-design.md) (이미 구현·E2E 검증됨)
- 상태: 설계 확정 (구현 계획 대기)

---

## 1. 배경 / 목적

Hermes `tistory-blog` 스킬은 완성됐지만 트리거가 터미널(`hermes -z`)뿐이다. 사용자는 **Slack에서 자연어로** 블로그를 요청하고 싶어 한다. Hermes는 Slack 수신을 안 하므로(발신 전용), Slack 수신이 되는 **이대리를 앞단**으로 두고 Hermes를 헤드리스로 호출한다.

`hermes -z "<프롬프트>"`가 **헤드리스 일회성 실행**(TTY 불필요, stdout=최종결과)임을 확인했고, 스킬을 **명시 호출**("tistory-blog 스킬을 사용해라. …")하면 Notion 페이지 생성까지 E2E 동작함을 검증했다(2026-06-11). 따라서 이대리는 codex/claude처럼 `hermes -z`를 spawn하면 된다.

## 2. 핵심 결정 (확정)

| 항목 | 결정 |
|---|---|
| 트리거 | **자연어 멘션 `@이대리 … 블로그 써줘`** (DM 포함) → Router/IntentClassifier → BLOG worker |
| 실행 | `hermes -z "tistory-blog 스킬을 사용해라. <요청>"` spawn (헤드리스) |
| env 자세 | **실제 HOME으로 실행** (buildSafeChildEnv 격리 안 씀 — Hermes가 `~/.hermes/` 접근 필요) |
| 결과 전달 | 이대리가 stdout에서 Notion URL 추출 → **요청한 자리(스레드)에 답장**. Hermes 자체 DM은 끔 |
| Hermes DM 억제 | spawn 시 `BLOG_NOTIFY_SLACK=0` → 스킬 `notify_slack` 생략 |
| 모델 라우팅 | **미경유** — Hermes가 모델 자체 선택. `AGENT_TO_PROVIDER`에 BLOG 미등록(외부 에이전트 디스패치) |
| 비동기 | 별도 큐/interim 메시지 없음 — 기존 reaction 진행표시(:hourglass:)로 60~90초 dispatch 커버 |

## 3. 비목표 (Out of Scope)

- 슬래시 커맨드 `/blog` (자연어만). 필요 시 후속.
- 이대리가 블로그 *내용*을 직접 작성(= Hermes 스킬이 전담, 이대리는 릴레이만).
- Hermes 스킬 로직 변경(= `BLOG_NOTIFY_SLACK` 가드 1개만 추가).
- 발행 자동화(수동 유지).

## 4. 아키텍처 / 흐름

```
app_mention / DM  "@이대리 React 서버컴포넌트 블로그 써줘"
  → RouterMessageHandler (기존)
  → IdaeriRouterUsecase → IntentClassifierUsecase (BLOG 의도 분류)
  → BlogDispatcher (AgentDispatcher 구현)
       ├─ AgentRunService.create (BLOG, 감사 기록)
       └─ GenerateBlogDraftUsecase
            ├─ 프롬프트: "tistory-blog 스킬을 사용해라. " + redactPii(userText)
            ├─ HermesCliRunner.run(prompt)  → `hermes -z <prompt>` (real HOME, BLOG_NOTIFY_SLACK=0, timeout 300s)
            └─ extractNotionUrl(stdout)
  → DispatchOutcome { formattedText = blog.formatter(제목/URL), ... }
  → RouterMessageHandler 가 thread 에 say (요청한 자리)
```

## 5. 컴포넌트 (파일)

| 파일 | 책임 |
|---|---|
| `src/model-router/domain/model-router.type.ts` | `AgentType.BLOG` enum 값 추가 (수정) |
| `src/router/application/intent-classifier.usecase.ts` | BLOG 의도 분류 추가 (수정 — 분류 프롬프트/매핑) |
| `src/agent/blog/domain/blog.type.ts` | 입력/출력 타입(BlogDraftResult 등) |
| `src/agent/blog/domain/blog-error-code.enum.ts` | BlogErrorCode |
| `src/agent/blog/domain/blog.exception.ts` | BlogException |
| `src/agent/blog/domain/port/hermes-runner.port.ts` | `HermesRunnerPort` + `HERMES_RUNNER_PORT` 토큰 |
| `src/agent/blog/application/generate-blog-draft.usecase.ts` | 프롬프트 구성 → runner → URL 추출 |
| `src/agent/blog/application/extract-notion-url.ts` | 순수 함수: stdout → Notion URL (테스트 대상) |
| `src/agent/blog/infrastructure/hermes-cli.runner.ts` | `hermes -z` spawn(real HOME, env flag, timeout, stdout 캡처) |
| `src/agent/blog/infrastructure/blog.dispatcher.ts` | AgentDispatcher 구현 (AgentRun + usecase) |
| `src/agent/blog/blog.module.ts` | 모듈 등록 |
| `src/slack/format/blog.formatter.ts` | 결과 mrkdwn 포맷 |
| `src/router/router.module.ts` | BlogDispatcher useFactory 등록 + inject (수정) |
| `src/app.module.ts` | BlogModule 등록 (수정) |
| `~/.hermes/skills/tistory-blog/bin/notify_slack.py` | `BLOG_NOTIFY_SLACK=0`이면 skip (수정) |
| `~/.hermes/skills/tistory-blog/SKILL.md` | 5번 단계에 env 가드 명시 (수정) |

## 6. HermesCliRunner — 핵심 인프라

- 실행: `spawn('hermes', ['-z', prompt], { env, timeout })`.
- **env**: `process.env` 기반(실제 HOME 유지) + `BLOG_NOTIFY_SLACK='0'` 추가. `buildSafeChildEnv` **미사용**(§7 트레이드오프 1). 단, `.env`의 이대리 시크릿(SLACK_BOT_TOKEN 등)은 Hermes가 자기 `~/.hermes/.env`를 따로 읽으므로 굳이 안 넘겨도 됨 — 넘기는 범위는 구현 시 최소화(실제 HOME + PATH + locale + BLOG_NOTIFY_SLACK).
- **timeout**: 300_000ms, 초과 시 SIGKILL + 명확한 에러(web 모드 대비 여유).
- stdout 전량 수집(최종 블록), stderr tail 보존. exit≠0 또는 timeout → 에러.
- 반환: `{ stdout, stderr }` → usecase가 URL 추출.

## 7. 의도적 트레이드오프 (명시)

1. **실제 HOME 실행 (격리 안 함)**: Hermes는 사용자 본인의 전체 에이전트라 `~/.hermes/`(auth·config·skills·.env)에 접근해야 한다. 모델 호출 CLI(codex/claude)의 throwaway-HOME 샌드박스와 **다른 신뢰 경계**다. prompt-injection으로 Hermes가 임의 행동할 수 있으나, 이는 "사용자가 자기 Hermes에 블로그를 시킨다"는 신뢰 모델 안에 있다. `redactPii`로 1차 방어.
2. **프롬프트 argv 노출**: `hermes -z`는 argv-only(stdin 경로 없음)라 주제가 `ps aux`에 보인다. 블로그 주제는 토큰이 아니므로 위험 낮음. `redactPii` 적용. (CODE_RULES/§2#4의 stdin 원칙은 codex/claude 모델 호출에 유지; 여기선 CLI 한계로 불가피한 예외 — 본 문서에 명시.)

## 8. 에러 처리

- spawn 실패(ENOENT 등) → "Hermes CLI 실행 실패" 안내.
- timeout(300s) → "블로그 생성 시간 초과" + 재시도 안내.
- exit≠0 → stderr tail 포함 친절 메시지(Hermes 인증/쿼터 문제는 stderr에 드러남).
- stdout에 Notion URL 없음 → "초안은 작성됐을 수 있으나 링크 추출 실패" + Notion DB 확인 안내 + stdout tail.
- 모든 에러는 `BlogException` → 기존 `toUserFacingErrorMessage` 경유 Slack 답장.

## 9. 테스트

- 유닛: `extract-notion-url.ts`(다양한 stdout 케이스 → URL/null), 프롬프트 빌더(명시 호출 prefix + redactPii 적용 검증), dispatcher(runner mock으로 성공/timeout/URL없음 분기).
- `HermesRunnerPort`를 mock으로 주입 → 실제 `hermes` spawn 없이 usecase/dispatcher 단위테스트.
- **3중 green**: `pnpm lint:check && pnpm test && pnpm build`.
- 실제 `hermes` 연동은 수동 통합 검증(Slack에서 @이대리 멘션).

## 10. 13체크리스트 적용 (AGENTS.md §4)

- 적용: `AgentType.BLOG` enum / IntentClassifier 분류 / Dispatcher / Slack formatter / AgentRun 라이프사이클 / ResponseCode(있으면) / 모듈 등록(app.module, router.module).
- **면제**: `AGENT_TO_PROVIDER`(모델 미경유) / `/retry-run` switch — BLOG는 모델 완성이 아니라 외부 에이전트 호출이라 model-router 재시도 의미 없음(필요 시 재멘션). 면제 사유를 구현 시 주석으로 남긴다.

## 11. 검증 기준 (Acceptance)

1. Slack에서 `@이대리 <주제> 블로그 써줘` → IntentClassifier가 BLOG로 분류.
2. 이대리가 `hermes -z "tistory-blog 스킬을 사용해라. …"`를 실제 HOME·`BLOG_NOTIFY_SLACK=0`으로 spawn.
3. Hermes가 Notion '블로그 초안' DB에 페이지 생성(자체 Slack DM은 안 보냄).
4. 이대리가 stdout에서 Notion URL을 추출해 **멘션한 스레드에** `📝 블로그 초안 완성 — <제목>\nNotion: <url>` 답장.
5. timeout/실패 시 친절한 에러 답장.
6. `pnpm lint:check && pnpm test && pnpm build` 3중 green.
