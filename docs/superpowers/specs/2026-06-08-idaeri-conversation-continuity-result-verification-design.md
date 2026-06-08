# 이대리 대화 연속성 + 결과 신뢰성 설계

- 작성일: 2026-06-08
- 상태: 설계 확정 대기 (사용자 리뷰 전)
- 범위: 통합 스펙 (레버 1·2·3 한 번에)

---

## 1. 배경 — "한 요청당 하나씩, 맥락을 못 이어받는" 증상

실제 관측된 대화:

1. 이대리: *"…현재 코드와 이슈를 기준으로 병목을 찾아 우선순위부터 정리해볼까요?"*
2. 사용자: *"네 우선순위 정리해주세요"*
3. 이대리: PM 워커(`/today`)로 분류 → GitHub 이슈/PR을 새로 긁어와 **고정 포맷 daily plan**("오늘의 최우선 과제 / 오전 / 오후")을 출력.

사용자가 기대한 것은 *"방금 네가 말한 그 개선 항목들의 우선순위"* 였으나, 이대리는 직전 대화 맥락을 워커에 전달하지 못하고 일반 daily plan을 새로 생성했다.

### 근본 원인 (코드 근거)

| # | 원인 | 근거 |
|---|---|---|
| 1 | 대화 맥락(`priorTurns`)이 IntentClassifier의 **분류 힌트로만** 쓰이고 워커 실행 입력에는 안 들어감 | `intent-classifier.usecase.ts:46-62`, `idaeri-router.port.ts:18-21` |
| 2 | 모든 워커 `execute()`가 현재 턴 `text + userId`만 받음. 이전 결과는 `agentRunId`로 DB 직접 조회해야 함 | 워커 input 타입들 (`pm-agent.type.ts:61-67` 등) |
| 3 | 워커가 매번 외부 데이터를 새로 긁어 고정 포맷 생성 | `generate-daily-plan.usecase.ts:90-98` |
| 4 | 대화 메모리가 `slackUserId+channelId` 단위 — **스레드 분리 안 함**, TTL 30분 / 최근 5턴 | `conversation-memory.service.ts:42-43`, `router-message.handler.ts:175-178` |
| 5 | 결과 검증 부재 — GitHub API가 throw 안 하면 성공 간주, applier 반환값만 신뢰 | `octokit-github.client.ts` write 메서드들, `apply-preview.usecase.ts:28-57` |
| 6 | 오류 안내가 비-DomainException을 전부 "내부 오류가 발생했습니다"로 가림 | `slack-handler.helper.ts:10-15` |

핵심은 **맥락이 "분류기 → 워커 실행 → 결과 안내"로 흐르지 못하고 분류기에서 끊긴다**는 것이다.

---

## 2. 목표 / 비목표

### 목표
- 직전 대화 맥락(사용자 추가 지시 + 직전 워커 결과)이 워커 실행 입력까지 흐른다. (레버 1)
- 대화 메모리가 스레드 단위로 격리된다(스레드 밖은 채널 단위 fallback). (레버 2)
- 외부 부작용 작업의 실제 반영을 실행 후 검증하고, 실패 원인을 사용자에게 명확히 안내한다. (레버 3, 전면 검증)
- 위 변경이 `conversationContext` 없는 기존 호출 경로의 동작을 바꾸지 않는다(하위 호환).

### 비목표
- 멀티 인텐트(한 멘션에서 여러 작업 추출) — 이번 범위 제외. IntentClassifier는 단일 `agentType` 유지.
- handoff chain 자동화 확대 — 기존 `followUp` 메커니즘 그대로.
- 모델 라우팅(`AGENT_TO_PROVIDER`) 변경 없음.

---

## 3. 설계

### 레버 2 — 스레드 단위 메모리 (가장 단순, 먼저)

**변경 파일:** `conversation-memory.service.ts`, `router-message.handler.ts`

- `buildKey({ slackUserId, channelId, threadTs? })`:
  - `threadTs` 있으면 → `user:channel:thread` 키
  - 없으면 → 기존 `user:channel` 키 (fallback)
- `router-message.handler.ts`는 이미 `threadTs`를 추출(`:68`, `:111`) → `buildKey`에 전달만 추가.
- 하위 호환: 기존 채널 키는 30분 TTL로 자연 만료. 마이그레이션 불필요.

**효과:** 같은 채널의 동시 스레드 맥락이 안 섞임. 스레드 밖(일반 메시지)은 기존대로.

---

### 레버 1 — 하이브리드 맥락 전달 (핵심)

**(a) 분류기가 사용자 지시 추출**
- 변경: `intent-classification.type.ts`, `intent-classifier.usecase.ts`, `intent-classifier-system.prompt.ts`
- 스키마에 `userInstruction?: string` 추가. 분류기가 `agentType`을 정하면서 직전 대화를 근거로 "이 워커가 반영할 사용자의 추가 지시/제약"을 한 문장으로 추출.
- 추출 무관/실패 → `undefined` (기존 동작 유지).
- 예) `userInstruction: "방금 논의한 개선 항목(자연어 해석·맥락 유지·GitHub 검증)을 현재 코드·이슈 기준으로 우선순위화"`

**(b) 직전 워커 결과 이어받기**
- 인프라 일부 존재: `router-message.handler.ts:182-184`가 직전 turn의 `agentRunId`를 뽑아 `contextRefs.agentRunId`로 전달 중. 현재는 워커가 미사용.
- 워커가 이 `agentRunId`로 직전 `AgentRun.output`을 조회해 입력에 포함.

**(c) 공통 전달 통로**
- 신설 타입: `ConversationContext { userInstruction?: string; priorAgentRunId?: number }`
- `DispatchInput`(`idaeri-router.port.ts`)에 `conversationContext?` 추가.
- `AgentDispatcher.dispatch`(`agent-dispatcher.port.ts`)가 이 필드를 워커 `execute()`로 전달.
- 각 워커 입력 타입에 `conversationContext?` optional 추가 → 안 받는 워커는 무시(하위 호환).
- 프롬프트 빌더(예: `daily-plan-prompt.builder.ts`)가:
  - `userInstruction` → `[사용자 지시]` **최우선 섹션**
  - `priorAgentRunId` 조회 결과 → `[직전 작업 결과]` 섹션
  - 기존 byte-cap `TRIM_ORDER` 규칙 안에 배치.

**적용 범위:** 공통 통로는 13개 워커 전부에 연다. 프롬프트 실제 반영은 맥락이 의미 있는 워커부터: PM, CTO, BE 계열(BE/BE-Schema/BE-Test/BE-SRE/BE-Fix), CodeReviewer. 나머지는 통로만 열고 점진 적용.

---

### 레버 3 — 전면 결과 검증 + 오류 안내

**(a) ResultVerifier 포트 (전면 검증)**

PreviewApplier가 ✅ 클릭 후 외부 부작용을 실행하는 strategy 패턴(`preview-applier.port.ts`)이므로, 대칭으로 `ResultVerifier`를 둔다.

```ts
// 신설: src/preview-gate/domain/port/result-verifier.port.ts
export const RESULT_VERIFIERS = Symbol('RESULT_VERIFIERS');

export interface VerificationResult {
  verified: boolean;          // 실제 반영 확인 여부
  detail: string;             // 사용자 안내 문구 (예: "PR #707 코멘트 반영 확인")
  unverifiableReason?: string; // 재조회 불가 시 사유 (실패 아님)
}

export interface ResultVerifier {
  readonly kind: PreviewKind;
  // apply 성공 후 호출. applier 반환 메타(생성된 리소스 ID 등)로 재조회 검증.
  verify(preview: PreviewAction, applyResult: ApplyResult): Promise<VerificationResult>;
}
```

- `PreviewApplier.apply()` 반환을 `string` → `ApplyResult { message: string; artifacts: VerifiableArtifact[] }`로 확장.
  - `VerifiableArtifact` 예: `{ type: 'github_pr', repo, prNumber }`, `{ type: 'github_comment', repo, issueNumber, commentId }`, `{ type: 'notion_page', pageId }`
- `apply-preview.usecase.ts`가 apply 성공 후 해당 kind의 ResultVerifier로 검증 → 결과를 Slack 안내에 합성.
- GitHub/Notion 클라이언트에 재조회 메서드 추가:
  - `getPullRequest(repo, prNumber)` — PR 존재/상태
  - `getIssueComment(repo, commentId)` — 코멘트 존재
  - `getNotionPage(pageId)` — 페이지 존재
- write 메서드가 생성 리소스 ID를 반환하도록 시그니처 보강(현재 일부 `void` 반환).

**검증 대상 부작용 카탈로그 (전면):**

| Applier / 경로 | 외부 부작용 | 검증 방법 |
|---|---|---|
| `pm-write-back.applier.ts` (PM_WRITE_BACK) | GitHub 코멘트/라벨, Notion write | 코멘트 재조회 + Notion 페이지 재조회 |
| `be-sandbox-push-pr.applier.ts` | GitHub branch push + PR open | PR 번호 재조회 (존재·head ref 확인) |
| `be-sandbox.applier.ts` | BE sandbox 작업 | 작업 산출물 존재 확인 |
| `po-eval-careerlog.applier.ts` | Notion careerlog write | Notion 페이지 재조회 |

> PreviewGate를 거치지 않는 직접 write(cron consumer 등)는 별도 검증 경로 필요 — 구현 단계에서 인벤토리 확정.

**(b) 오류 안내 개선**
- 변경: `slack-handler.helper.ts`, `router-message.handler.ts`
- `toUserFacingErrorMessage()`가 비-DomainException을 **카테고리 힌트**로 분류:
  - GitHub 연동 오류 / 일시적 네트워크 오류 / LLM 응답 비정상 / DB 오류 등
  - **보안 불변식:** 토큰·내부 경로·stack trace·환경변수는 절대 노출 안 함. 카테고리 라벨만.
- 빈 LLM 응답 명시적 분기 메시지.
- 검증 실패(`verified=false`)는 "작업 호출은 성공했으나 반영 확인 실패 — 수동 확인 권장" 형태로 안내(부분 성공 구분).

---

## 4. 데이터 흐름 (After)

```
멘션 → priorTurns(스레드 키) ──→ IntentClassifier
                                   ├─ agentType
                                   └─ userInstruction (NEW)
                                        │
                          ConversationContext { userInstruction, priorAgentRunId }
                                        │
                       AgentDispatcher.dispatch(input + conversationContext)
                                        │
                                   워커 execute()
                                   ├─ [사용자 지시] + [직전 작업 결과] 프롬프트 주입
                                   └─ 외부 부작용 → PreviewGate
                                        │
                              apply 성공 → ResultVerifier.verify (NEW, 전면)
                                        │
                              결과 안내 (검증 상태 + 카테고리화된 오류)
```

---

## 5. 하위 호환 / 마이그레이션

- `conversationContext`, `userInstruction`은 전부 optional → 미주입 시 기존 동작 동일.
- `PreviewApplier.apply` 반환 타입 확장(`string` → `ApplyResult`)은 **모든 applier 동시 수정** 필요 (4곳) — breaking change지만 내부 인터페이스라 범위 한정.
- 메모리 키 변경은 TTL 자연 만료로 흡수, DB 마이그레이션 없음.
- 새 env 추가 없음 (예상). 추가 시 CLAUDE.md §2-7의 4곳 동기 갱신.

---

## 6. 테스트 전략

- `conversation-memory.service.spec.ts`: thread 키 분리 / channel fallback / TTL.
- `intent-classifier.usecase.spec.ts`: `userInstruction` 추출 (있음/없음/무관).
- 워커 spec(PM·CTO 대표): `conversationContext` 주입 시 프롬프트 섹션 포함 + 미주입 시 기존 동작 회귀.
- ResultVerifier spec: 검증 성공 / 검증 실패(verified=false) / 재조회 불가(unverifiableReason) 분기.
- 오류 안내 spec: 예외 종류별 카테고리 매핑 + 민감정보 비노출 검증.

검증 게이트: `pnpm lint:check && pnpm test && pnpm build` 3중 green.

---

## 7. 단계적 구현 순서 (통합 스펙, 전면 검증이 큼)

1. **레버 2** (스레드 메모리) — 가장 작고 독립적. 먼저 머지 가능.
2. **레버 1** (ConversationContext 통로 + userInstruction 추출 + PM/CTO 프롬프트 반영).
3. **레버 1 점진** — 나머지 워커 프롬프트 반영.
4. **레버 3 (a)** — ResultVerifier 포트 + ApplyResult 확장 + GitHub/Notion 재조회 + 4 applier 검증.
5. **레버 3 (b)** — 오류 카테고리화 안내.

각 단계는 독립 PR 가능. 1·2가 스크린샷 증상의 직접 해결.

---

## 8. 리스크 / 트레이드오프

- **전면 검증의 비용:** 모든 부작용에 재조회 API 호출 추가 → GitHub rate limit·지연 증가. 완화: 검증은 부작용당 1회 재조회로 제한, 재조회 불가는 실패가 아닌 `unverifiableReason`으로 분리.
- **`ApplyResult` breaking change:** 4개 applier 동시 수정 필요 — 한 PR로 묶어 깨진 상태 방지.
- **`userInstruction` 품질 의존:** 분류기가 잘못 추출하면 엉뚱한 지시가 워커에 감 → 추출 실패 시 `undefined` 안전 기본값, 추출은 "직전 대화에 명시적 지시가 있을 때만" 보수적으로.
- **byte-cap 충돌:** 새 프롬프트 섹션이 기존 TRIM_ORDER와 경쟁 → `[사용자 지시]`는 최우선, `[직전 작업 결과]`는 GitHub 데이터보다 후순위로 trim 배치.
