# 이직 메이트 Phase 2 설계서 — JD 갭 분석 → 블로그/학습 주제 → BLOG 체인

- 작성일: 2026-06-15
- 상태: 설계 승인됨 (구현 계획 대기)
- 범위: **Phase 2 만**.
- **선행 의존성**: Phase 1 (`CAREER_MATE` 에이전트 + 역량 프로필 허브). 구현 브랜치는 `feat/career-mate-phase1`(PR #90) 기준, 또는 #90 머지 후 main 기준. 설계서 작성엔 무관.
- 관련: `docs/superpowers/specs/2026-06-15-career-mate-phase1-design.md`, BLOG 에이전트(`src/agent/blog/`).

---

## 1. 배경 / 목적

Phase 1 이 만든 "역량 프로필 허브"(증거 기반 skills/accomplishments)를 **목표 공고(JD)와 대조**해, 무엇이 충분하고(보유) 무엇이 부족한지(갭)를 보여주고, **갭을 메우는 블로그/학습 주제**를 제안한다. 사용자가 주제를 고르면 **기존 BLOG 에이전트로 자동 체인**해 초안을 만든다.

이로써 블로그 기능에 "전략적 목적"이 생긴다 — 아무거나 쓰는 게 아니라 **목표 직무의 갭을 메우는 글**을 쓴다. (Phase 1 허브 → Phase 2 가 소비하는 첫 사례.)

---

## 2. 확정 결정 요약

| 결정 | 선택 | 근거 |
|---|---|---|
| 형태 | **CAREER_MATE 하이브리드에 `ANALYZE_JD_GAP` capability 추가** (새 에이전트 X) | Phase 1 하이브리드 폼 그대로. 진입·등록 비용 최소 |
| BLOG 연결 | **제안 + 선택 시 자동 체인** (B) | 자동화 + 제어권 균형 |
| 선택 수단 | **자연어 "N번" + PreviewGate** | 멘션 답글은 텍스트 전용(버튼 X). 기존 "자연어 Y/N → PreviewGate" intercept 패턴을 N지선다로 미러링 → 텍스트 네이티브, infra 최소 |
| 영속 | **무상태** — 주제 목록은 preview payload 가 TTL 동안 보관 | 새 Prisma 테이블 불필요 (YAGNI) |

---

## 3. 아키텍처

새 에이전트 없이 Phase 1 `CareerMateDispatcher` 에 action 하나 추가. 나머지는 기존 인프라(허브 read / BuildProfile / PreviewGate / BlogDispatcher) 조립.

```
@이대리 "이 공고 갭 분석해줘 <JD 텍스트>"
 → IntentClassifier → CAREER_MATE → CareerMateDispatcher (action: ANALYZE_JD_GAP)
 → AnalyzeJdGapUsecase (Claude 1회, AgentRun 래핑):
     a. 허브 읽기 findLatestBySlackUser() ?? 자동 Build (Phase 1 재사용)
     b. Claude: 입증 역량(skills/accomplishments) ⨯ JD → {fit, 보유, 갭, 갭 메우는 주제 N개}
     c. PreviewGate preview 생성 (kind=CAREER_JD_GAP_BLOG, payload={topics})
     d. 답글: 갭 리포트 + 번호 매긴 주제 N개 + "원하는 번호 말해주세요(예: '2번'), '아니'로 취소"
 → 사용자 "2번"
 → router-message.handler 주제선택 intercept (기존 tryHandlePreviewYesNo 의 형제):
     pending CAREER_JD_GAP_BLOG preview + "N번" 파싱 → topics[N-1] 선택
     → JdGapBlogApplier(PreviewApplier): BlogDispatcher.dispatch({ text: 주제, slackUserId })
 → BLOG (Hermes tistory-blog) → Notion 초안 URL 답글
```

설계 원칙: LLM 은 갭 분석 1회 + (허브 없으면 자동 Build 1회). 선택→BLOG 는 결정론 디스패치(+Hermes). 무상태.

---

## 4. 컴포넌트

**신규 (`src/agent/career-mate/`)**
- `application/analyze-jd-gap.usecase.ts` — 허브+JD → Claude → `GapAnalysisData`, PreviewGate preview 생성, AgentRun 래핑.
- `domain/prompt/jd-gap.prompt.ts` — system prompt + `buildJdGapPrompt(profile, jdText)` + `parseGapAnalysisOutput(text)`.
- `infrastructure/jd-gap-blog.applier.ts` — `PreviewApplier` 구현. `apply(preview, selectedIndex)` → `BlogDispatcher.dispatch({ text: topics[index].title, slackUserId })`.
- (`GapAnalysisData` 타입은 `domain/career-mate.type.ts` 에 추가.)

**수정**
- `domain/prompt/career-mate-intent.prompt.ts` — `ANALYZE_JD_GAP` action 추가 (JD/공고/갭 키워드).
- `infrastructure/career-mate.dispatcher.ts` — `ANALYZE_JD_GAP` case → `AnalyzeJdGapUsecase`.
- `src/slack/handler/router-message.handler.ts` — **주제선택 intercept** `tryHandleTopicSelection` (기존 `tryHandlePreviewYesNo` 와 동일 위치/패턴): pending `CAREER_JD_GAP_BLOG` preview + "N번" 파싱 → 선택 적용.
- PreviewGate `forRoot({ appliers })` 등록부 (`src/app.module.ts` 또는 preview-gate 등록 위치) — `JdGapBlogApplier` 추가.
- `src/common/exception/response-code.enum.ts` + `career-mate-error-code.enum.ts` — `CAREER_MATE_JD_EMPTY`, `CAREER_MATE_INVALID_MODEL_OUTPUT`(재사용), `NO_EVIDENCE`(재사용).

**재사용 (변경 없음)**
- `CareerProfileRepositoryPort.findLatestBySlackUser` (허브 read)
- `BuildCareerProfileUsecase` (허브 없을 때 자동 Build)
- `BlogDispatcher` / `GenerateBlogDraftUsecase` (체인 대상, 입력 `{requestText, slackUserId}`)
- PreviewGate (CreatePreview / Apply / Cancel, TTL·소유권 검증)
- `parseTopicSelection`("N번"/"N" → index) — `yes-no-detector.ts` 옆 신규 순수 함수.

---

## 5. 데이터 (무상태)

```ts
type GapTopic = {
  title: string;       // 블로그/학습 주제 한 줄
  rationale: string;   // 이 주제가 메우는 갭 + JD 연관
};

type GapAnalysisData = {
  fitSummary: string;        // 적합도 2~3문장 (강점/포지셔닝)
  have: string[];            // JD 요구 중 이미 입증된 역량 (허브 evidence 근거)
  gaps: string[];            // 부족/미입증 역량
  topics: GapTopic[];        // 갭 메우는 주제 N개 (기본 3)
};
```

- 주제 목록은 **PreviewGate preview payload** `{ topics: GapTopic[] }` 에 보관 (TTL = PreviewGate 기본). 선택 시 `topics[index].title` 을 BLOG `requestText` 로.
- 새 Prisma 모델 없음.

---

## 6. 호출 흐름 상세

**ANALYZE_JD_GAP (디스패처 → usecase)**
```
dispatch(input): intent.action === 'ANALYZE_JD_GAP'
 → AnalyzeJdGapUsecase.execute({ slackUserId, jdText: input.text })
     agentRunService.execute({ agentType: CAREER_MATE, triggerType: SLACK_MENTION_CAREER_MATE, run: async () => {
       profile = repo.findLatestBySlackUser(slackUserId) ?? (await buildProfile.execute({slackUserId})).result
       jdText 비어있으면 → CareerMateException(JD_EMPTY)
       completion = modelRouter.route({ agentType: CAREER_MATE, request:{ prompt: buildJdGapPrompt(profile, jdText), systemPrompt } })
       data = parseGapAnalysisOutput(completion.text)   // 실패 시 INVALID_MODEL_OUTPUT
       preview = createPreview.execute({ kind:'CAREER_JD_GAP_BLOG', slackUserId, payload:{ topics:data.topics } })
       return { result: { data, previewId: preview.id }, modelUsed, output: data }
     }})
 → formattedText = formatGapReport(data) + 번호 주제 목록 + 안내
```

**주제 선택 (router-message.handler intercept)**
```
tryHandleTopicSelection({ text, slackUserId, ... }):
  pending = findLatestPendingPreview.execute({ slackUserId })
  pending?.kind !== 'CAREER_JD_GAP_BLOG' → false (일반 dispatch 로 fall through)
  idx = parseTopicSelection(text)   // "2번"/"2" → 2, 아니면 null → false
  topics = pending.payload.topics; topics[idx-1] 없으면 안내 후 true
  → applyPreviewUsecase.execute({ previewId: pending.id, slackUserId, selection: idx })  // JdGapBlogApplier.apply
  → applier 가 BlogDispatcher.dispatch({ text: topics[idx-1].title, slackUserId }) → Notion URL
  → say(BLOG 결과)
```
> `ApplyPreviewUsecase` 에 선택 인덱스를 전달하는 경로가 필요. 기존 apply 는 binary 이므로, **(a) apply 입력에 optional `selection` 추가** 또는 **(b) intercept 가 payload 에서 직접 topic 추출 후 BlogDispatcher 직접 호출 + preview 를 applied 처리**. 구현 계획에서 기존 PreviewGate 시그니처 확인 후 둘 중 최소 변경으로 확정.

---

## 7. 에러 처리

| 상황 | 코드 | 메시지 |
|---|---|---|
| JD 텍스트 비어있음 | `CAREER_MATE_JD_EMPTY` | "분석할 공고(JD) 내용을 함께 붙여주세요." |
| 허브 없음 + PR 0 | `CAREER_MATE_NO_EVIDENCE`(재사용) | Phase 1 과 동일 안내 |
| Claude 출력 파싱 실패 | `CAREER_MATE_INVALID_MODEL_OUTPUT`(재사용) | "갭 분석 실패 — 다시 시도해주세요" |
| preview 만료/타인/없음 | PreviewGate 기존 검증 | 기존 메시지 |
| 잘못된 번호 ("9번") | (intercept 내 안내) | "1~N 중에서 골라주세요" |

---

## 8. 테스트 전략 (전부 mock, live 호출 X)

- `parseGapAnalysisOutput` 순수 함수 (정상/형태오류/코드펜스).
- `parseTopicSelection` 순수 함수 ("2번"/"2"/"두번째"?/비매칭).
- `AnalyzeJdGapUsecase` — mock 허브(있음/없음→자동Build) + mock LLM → preview 생성 호출 검증, JD 빈값 → JD_EMPTY.
- `JdGapBlogApplier` — mock BlogDispatcher → 선택 topic.title 로 dispatch 호출 검증.
- `tryHandleTopicSelection` — pending preview 종류/번호 파싱 분기 (career-mate 가 아니면 fall through).
- formatter — 갭 리포트 + 번호 주제 + mrkdwn escape(LLM 텍스트).
- **완료 기준**: `pnpm lint:check && pnpm test && pnpm build && pnpm docs:check` 4중 green. (Phase 1 교훈: docs:check 포함.)

---

## 9. 범위 밖 / 후속

- JD 영속·지원 추적(어느 회사 JD 였는지) → Phase 3 CRM.
- 학습 로드맵(주제별 학습 자료) → 후속. Phase 2 는 "주제 제안"까지.
- 사이드프로젝트 제안 → 후속 (topics 에 type 필드로 확장 가능).

---

## 10. 가정 / 열린 항목

1. `ApplyPreviewUsecase` 에 선택 인덱스 전달 방식(§6) — 구현 계획에서 기존 PreviewGate 시그니처 확인 후 최소 변경 확정.
2. 주제 개수 기본 3 (조정 가능).
3. JD 는 멘션 본문에 붙여넣음(긴 텍스트). 별도 업로드/URL 파싱은 범위 밖.
4. 구현 브랜치는 Phase 1(`feat/career-mate-phase1`) 기준 — Phase 1 미머지 상태 의존.
