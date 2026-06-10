# ConversationalReply codex→claude fallback 설계

- 날짜: 2026-06-10
- 범위: `ConversationalReplyUsecase` (intent 분류 실패 시 자연어 대화 fallback)
- 관련 선행: PR #80 — model-router `route()` 레벨 양방향 fallback (`FALLBACK_OF`)

## 배경 / 문제

PR #80 에서 `ModelRouterUsecase.route()` 에 양방향 fallback 을 넣었다 (CHATGPT 실패 → CLAUDE,
CLAUDE 실패 → CHATGPT). 그러나 LLM 을 호출하는 진입점 중 **딱 하나** 가 `route()` 를 우회한다:

- `src/router/application/conversational-reply.usecase.ts`
  - `@Inject(MODEL_PROVIDER_TOKENS[CHATGPT])` 로 codex provider 를 직접 주입
  - `this.chatgptProvider.complete({ prompt, systemPrompt })` 단독 호출
  - 발동: `router-message.handler.ts:254` — IntentClassifier 가 UNKNOWN 반환 시 자연어 응답 fallback

이 경로는 CHATGPT 단독 호출이라 codex 쿼터 소진/인증 실패 시 **즉시 throw** — Claude fallback 혜택이 전혀 없다.
조사 결과 `route()` 를 우회하는 직접 LLM 호출 진입점은 이 한 곳뿐 (cron·agent worker·IntentClassifier 는 모두 `route()` 경유).

## 결정

`ConversationalReplyUsecase` 를 `chatgptProvider.complete()` 직접 호출에서
`ModelRouterUsecase.route({ agentType: PM, request })` 경유로 전환한다.
`IntentClassifierUsecase` 가 이미 쓰는 패턴과 동일.

### 우회 설계가 더 이상 필요 없는 근거

`route()` 우회의 본래 이유는 클래스 주석(line 20-21) 에 적힌 두 가지:

1. **AgentRun 통계 오염 회피** — `route()` 자체는 AgentRun 을 기록하지 않는다 (provider 선택 + fallback 만 수행).
   AgentRun 기록은 각 agent usecase 가 별도로 한다. IntentClassifier 도 `route({agentType: PM})` 을 쓰지만
   AgentRun 미기록. → route() 로 바꿔도 통계 오염 없음.
2. **짧은 응답 / 빠른 latency** — `route()` 는 짧은 prompt 를 그대로 넘기고, 정상 시 추가 호출이 없다
   (fallback 은 primary 실패 시에만 1회). → 정상 경로 latency 동일.

`CompletionRequest = { prompt, systemPrompt? }` 를 `route()` 가 provider 로 그대로 전달하므로
대화용 커스텀 systemPrompt 도 보존된다.

## 변경 상세

1. **`conversational-reply.usecase.ts`**
   - 생성자: `@Inject(MODEL_PROVIDER_TOKENS[CHATGPT]) chatgptProvider: ModelProviderPort` 제거
     → `private readonly modelRouter: ModelRouterUsecase` 주입. `ConfigService` 는 유지.
   - `reply()` 본문: `this.chatgptProvider.complete({ prompt, systemPrompt })`
     → `this.modelRouter.route({ agentType: AgentType.PM, request: { prompt, systemPrompt } })`,
     반환은 `completion.text.trim()` 동일.
   - import 정리: `MODEL_PROVIDER_TOKENS` / `ModelProviderPort` / `ModelProviderName` 제거,
     `ModelRouterUsecase` + `AgentType` 추가.
   - 클래스 상단 주석(line 17-21) 갱신: "CHATGPT 직접 호출" → "route(PM) 경유 — codex 실패 시 claude fallback".
   - `reply()` 시그니처(`{ text, priorTurns }` 입력 / `string` 반환) 불변 → 호출부 변경 불필요.

2. **테스트 (`conversational-reply.usecase.spec.ts`)**
   - 기존 `buildSystemPrompt` / `buildPrompt` 순수 함수 테스트는 불변 (그대로 통과).
   - `reply()` 단위 테스트 추가: mock `ModelRouterUsecase.route` 가
     `{ agentType: PM, request: { prompt, systemPrompt } }` 로 1회 호출되는지 +
     반환 `text` 가 trim 되어 나오는지 검증.

3. **`model-router.module.ts` (선택적 정리)**
   - 현재 CHATGPT/CLAUDE provider 토큰을 `exports` 로 노출하는 유일한 외부 consumer 가
     `ConversationalReplyUsecase` 였다. 전환 후 외부 직접 consumer 가 없으면 두 토큰 export 와
     관련 주석(line 14-15) 제거 가능.
   - 단, 다른 consumer 가 없음을 빌드/grep 으로 재확인한 뒤에만 제거. 불확실하면 export 는 보존하고
     주석만 갱신 (fallback 목표와 무관한 정리이므로 안전 우선).

## 검증

- `pnpm lint:check && pnpm test && pnpm build` 3중 green.
- 동작 확인 포인트: intent UNKNOWN 대화 응답이 정상 시 CHATGPT 로, codex 쿼터 소진 시 CLAUDE 로
  자동 fallback (route() 의 기존 로그 `primary provider(CHATGPT) 실패, fallback(CLAUDE) 으로 재시도` 노출).

## 비목표 (YAGNI)

- 새 `AgentType.CONVERSATIONAL` 신설 안 함 (AGENTS.md 13개 체크리스트 동반 — 추적 안 하는 대화 응답엔 과임).
- `route()` 의 fallback 정책/친절 안내 로직 변경 안 함 (PR #80 그대로 재사용).
