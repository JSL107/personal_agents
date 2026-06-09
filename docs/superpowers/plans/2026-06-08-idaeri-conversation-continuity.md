# 이대리 대화 연속성 + 결과 신뢰성 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** 대화 맥락이 분류기 → 워커 실행 → 결과 안내까지 끊김 없이 흐르게 하고, 외부 부작용을 실행 후 검증한다.

**Architecture:** (1) 메모리 키에 threadTs 추가. (2) `ConversationContext`(userInstruction + priorAgentRunId)를 DispatchInput → dispatcher → 워커 execute → 프롬프트로 전달. (3) `PreviewApplier.apply`를 `ApplyResult`로 확장하고 `ResultVerifier`로 외부 부작용 실제 반영을 재조회 검증.

**Tech Stack:** NestJS 10, Prisma 6, ts-pattern, jest, Slack Bolt 4, Octokit, Notion SDK.

**Spec:** [2026-06-08-idaeri-conversation-continuity-result-verification-design.md](../specs/2026-06-08-idaeri-conversation-continuity-result-verification-design.md)

**검증 게이트(매 레버 종료 시):** `pnpm lint:check && pnpm test && pnpm build` 3중 green.

---

## 레버 2 — 스레드 단위 메모리

### Task 2.1: `buildKey`에 threadTs 추가
**Files:**
- Modify: `src/router/application/conversation-memory.service.ts:44-52`
- Test: `src/router/application/conversation-memory.service.spec.ts`

- [ ] **Step 1:** 실패 테스트 — `buildKey({slackUserId,channelId,threadTs:'T1'})` → `'u:c:T1'`, threadTs 없으면 `'u:c'`.
- [ ] **Step 2:** `pnpm test conversation-memory` → FAIL.
- [ ] **Step 3:** 구현:
```ts
buildKey({
  slackUserId,
  channelId,
  threadTs,
}: {
  slackUserId: string;
  channelId: string;
  threadTs?: string;
}): string {
  const base = `${slackUserId}:${channelId}`;
  return threadTs ? `${base}:${threadTs}` : base;
}
```
주석의 "thread 단위 분리 X" 문구를 "threadTs 있으면 thread 단위 격리, 없으면 channel fallback"으로 갱신.
- [ ] **Step 4:** `pnpm test conversation-memory` → PASS.

### Task 2.2: 핸들러가 threadTs 전달
**Files:**
- Modify: `src/slack/handler/router-message.handler.ts:175-178`
- Test: 동 핸들러 spec (있으면) 또는 통합 확인

- [ ] **Step 1:** `buildKey({ slackUserId, channelId, threadTs })`로 변경 (threadTs는 이미 `processRouterMessage` 인자에 존재).
- [ ] **Step 2:** `pnpm build` 타입 통과 확인.
- [ ] **Step 3:** 커밋 `feat(router): conversation memory 스레드 단위 격리 (channel fallback)`

---

## 레버 1 — 하이브리드 맥락 전달

### Task 1.1: ConversationContext 타입 신설
**Files:**
- Create: `src/router/domain/conversation-context.type.ts`

```ts
// 워커 실행 입력까지 전달되는 대화 맥락. classifier 가 추출한 사용자 추가 지시 +
// 직전 worker 결과 참조. 전부 optional — 미주입 시 기존 동작 유지 (하위 호환).
export interface ConversationContext {
  // 자연어 분류 단계에서 직전 대화를 근거로 추출한 "이 worker 가 반영할 사용자 지시".
  userInstruction?: string;
  // 직전 turn 의 worker AgentRun id. worker 가 이전 결과를 조회해 이어받을 때 사용.
  priorAgentRunId?: number;
}
```

### Task 1.2: IntentClassification 에 userInstruction 추가
**Files:**
- Modify: `src/router/domain/intent-classification.type.ts`
- Modify: `src/router/domain/prompt/intent-classification.parser.ts:55-63`
- Modify: `src/router/domain/prompt/intent-classifier-system.prompt.ts` (출력 스키마 + 지침)
- Test: `intent-classification.parser.spec.ts`

- [ ] IntentClassification 에 `userInstruction?: string` 추가.
- [ ] 파서: `obj.userInstruction` 가 string 이고 비어있지 않으면 채움, 아니면 undefined.
- [ ] 시스템 프롬프트 출력 객체에 `"userInstruction": string (선택)` + 추출 지침: "직전 대화에 사용자가 명시한 추가 지시/제약이 있을 때만 한 문장으로. 없으면 생략." 보수적 추출.
- [ ] 실패 테스트 먼저: userInstruction 있는 JSON / 없는 JSON / 빈 문자열 케이스 → PASS.

### Task 1.3: DispatchInput 에 conversationContext 전달 + classifier 결과 연결
**Files:**
- Modify: `src/router/domain/idaeri-router.port.ts:9-22` (DispatchInput 에 `conversationContext?: ConversationContext`)
- Modify: `src/router/application/intent-classifier.usecase.ts:25-43` (classify 가 IntentClassification 전체 반환 — 이미 그럼)
- Modify: `src/router/application/idaeri-router.usecase.ts:69-88,169-198` (classifyOrThrow 가 userInstruction 도 반환, dispatch 시 conversationContext 구성)
- Test: `idaeri-router.usecase.spec.ts`

- [ ] `classifyOrThrow` 를 `{ agentType, userInstruction? }` 반환으로 변경 (classification 전체 보존).
- [ ] dispatcher 호출 시 `conversationContext: { userInstruction, priorAgentRunId: input.contextRefs?.agentRunId }` 합성해 전달.
- [ ] handoff followUpInput 에도 conversationContext 승계 검토(직전 결과 ref).
- [ ] 테스트: classify 결과의 userInstruction 이 dispatcher 에 전달되는지 mock dispatcher 로 검증.

### Task 1.4: 워커 dispatcher 가 conversationContext 를 execute 로 전달
**Files (13개 중 의미있는 4개 우선):**
- Modify: `src/agent/pm/infrastructure/pm.dispatcher.ts:28-37`
- Modify: `src/agent/cto/infrastructure/cto.dispatcher.ts`
- Modify: `src/agent/be/infrastructure/be.dispatcher.ts`
- Modify: `src/agent/code-reviewer/infrastructure/code-reviewer.dispatcher.ts`
- 나머지 9개: 통로만(필드 전달) — 점진.

- [ ] 각 dispatcher 가 `execute({ ..., conversationContext: input.conversationContext })` 전달.

### Task 1.5: 워커 입력 타입 + 프롬프트 빌더 반영 (PM 우선)
**Files:**
- Modify: `src/agent/pm/domain/pm-agent.type.ts` (GenerateDailyPlanInput 에 `conversationContext?`)
- Modify: `src/agent/pm/application/generate-daily-plan.usecase.ts:75-98`
- Modify: `src/agent/pm/application/daily-plan-prompt.builder.ts` (`[사용자 지시]` 최우선 섹션 + `[직전 작업 결과]` 섹션, TRIM_ORDER 반영)
- (직전 결과 조회) `AgentRunService` 로 priorAgentRunId 의 output 조회 helper.
- Test: `generate-daily-plan.usecase.spec.ts`, `daily-plan-prompt.builder.spec.ts`

- [ ] userInstruction 주입 시 프롬프트에 `[사용자 지시]` 포함, 미주입 시 기존 동작 동일(회귀).
- [ ] CTO/BE/CodeReviewer 동일 패턴 반복 (각 type + builder).
- [ ] 커밋 `feat(router): ConversationContext 워커 전달 — userInstruction + 직전 결과 이어받기`

---

## 레버 3 — 전면 결과 검증 + 오류 안내

### Task 3.1: ApplyResult + VerifiableArtifact 타입
**Files:**
- Create: `src/preview-gate/domain/apply-result.type.ts`

```ts
// 외부 부작용 검증 대상 산출물 — applier 가 생성한 리소스 식별자.
export type VerifiableArtifact =
  | { type: 'github_pr'; repo: string; prNumber: number }
  | { type: 'github_comment'; repo: string; issueNumber: number; commentId: number }
  | { type: 'github_label'; repo: string; issueNumber: number; labels: string[] }
  | { type: 'notion_page'; pageId: string };

// PreviewApplier.apply 반환 — 사용자 메시지 + 검증 대상 산출물.
export interface ApplyResult {
  message: string;
  artifacts: VerifiableArtifact[];
}
```

### Task 3.2: ResultVerifier 포트
**Files:**
- Create: `src/preview-gate/domain/port/result-verifier.port.ts`

```ts
import { VerifiableArtifact } from '../apply-result.type';

export const RESULT_VERIFIERS = Symbol('RESULT_VERIFIERS');

export interface VerificationOutcome {
  verified: boolean;
  detail: string;
  unverifiableReason?: string; // 재조회 불가(실패 아님)
}

// artifact 1건의 실제 반영을 재조회로 검증. type 별 verifier 가 자기 type 만 처리.
export interface ResultVerifier {
  supports(artifact: VerifiableArtifact): boolean;
  verify(artifact: VerifiableArtifact): Promise<VerificationOutcome>;
}
```

### Task 3.3: GitHub/Notion 재조회 메서드
**Files:**
- Modify: `src/github/infrastructure/octokit-github.client.ts` + port
- Modify: `src/notion/infrastructure/notion-api.client.ts` + `src/notion/domain/port/notion-client.port.ts`

- [ ] GitHub: `getPullRequest(repo, prNumber)`, `getIssueComment(repo, commentId)`, `listIssueLabels(repo, issueNumber)`.
- [ ] Notion: `getPage(pageId)`.
- [ ] 각 재조회 실패는 throw 가 아닌 verify 단계의 `unverifiableReason` 으로 흡수.

### Task 3.4: kind별 Verifier 구현
**Files:**
- Create: `src/preview-gate/infrastructure/github-pr.verifier.ts`, `github-comment.verifier.ts`, `github-label.verifier.ts`, `notion-page.verifier.ts`
- 또는 type 별 1 verifier 로 통합. RESULT_VERIFIERS multi-provider 등록(preview-gate.module.ts).

### Task 3.5: PreviewApplier.apply → ApplyResult 확장 (breaking, 4 applier 동시)
**Files:**
- Modify: `src/preview-gate/domain/port/preview-applier.port.ts` (반환 `Promise<ApplyResult>`)
- Modify: `src/agent/pm/infrastructure/pm-write-back.applier.ts`
- Modify: `src/agent/be-sandbox/infrastructure/be-sandbox.applier.ts`
- Modify: `src/agent/be-sandbox/infrastructure/be-sandbox-push-pr.applier.ts`
- Modify: `src/agent/po-eval/infrastructure/po-eval-careerlog.applier.ts`

- [ ] 각 applier 가 `{ message, artifacts }` 반환 — 생성한 리소스 id 를 artifacts 에 채움.

### Task 3.6: ApplyPreviewUsecase 가 verify 통합
**Files:**
- Modify: `src/preview-gate/application/apply-preview.usecase.ts:28-57`
- Modify (소비처): `src/slack/handler/router-message.handler.ts:384`, `src/slack/handler/preview-action.handler.ts`

- [ ] apply 성공 후 artifacts 각각을 지원하는 verifier 로 검증, 결과를 resultText 에 합성("✅ 반영 확인" / "⚠️ 반영 확인 실패 — 수동 확인 권장" / "ℹ️ 확인 불가: <reason>").
- [ ] 반환 `{ preview, resultText }` 형태 유지 (소비처 영향 최소).

### Task 3.7: 오류 안내 카테고리화
**Files:**
- Modify: `src/slack/handler/slack-handler.helper.ts:10-15`
- Test: `slack-handler.helper.spec.ts`

- [ ] `toUserFacingErrorMessage` 가 비-DomainException 을 카테고리로: GitHub 연동/네트워크/LLM 응답 비정상/DB. **토큰·경로·stack 비노출 불변식** 테스트로 고정.
- [ ] 커밋 `feat(preview-gate): 외부 부작용 전면 결과 검증 + 오류 안내 카테고리화`

---

## Self-Review 체크
- 스펙 §3 레버1/2/3 → Task 매핑 완료. 비목표(멀티 인텐트) 미포함 확인.
- 신규 타입 시그니처 일관: `ConversationContext`, `ApplyResult`, `VerifiableArtifact`, `VerificationOutcome`, `ResultVerifier`.
- 하위 호환: conversationContext/userInstruction optional, threadTs optional.
