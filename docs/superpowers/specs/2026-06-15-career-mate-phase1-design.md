# 이직 메이트 — Phase 1 설계서 (역량 프로필 허브 + 이력서/포트폴리오 신디사이저)

- 작성일: 2026-06-15
- 상태: 설계 승인됨 (구현 계획 대기)
- 범위: **Phase 1 만**. Phase 2~4 는 "후속 로드맵" 절에 개요만.
- 관련 선행 기능: BLOG 에이전트(`src/agent/blog/`) — Phase 2 의 출력 채널로 연결 예정.

---

## 1. 배경 — "이직 메이트" 전체 비전과 이 스펙의 위치

이직 메이트는 단일 기능이 아니라 **하나의 허브(역량 프로필)를 공유하는 여러 capability 의 묶음**이다.
핵심 통찰: 이대리는 이미 사용자의 "진짜 한 일"을 자동 수집한다(merged PR, careerLog, Impact Report).
이직 준비의 최대 병목인 "내가 뭘 했는지 증거와 함께 정리"의 원재료가 이미 쌓여 있다.

```
   입력: careerLog(Notion) · merged PR(GitHub) · Impact Report
                         │
                         ▼
            ┌──────────────────────────┐
            │  ① 역량 프로필 (HUB)       │  ← 증거 기반 스킬+성과 단일 소스
            │  Postgres 영속            │
            └──┬──────────┬──────────┬──┘
               ▼          ▼          ▼
          이력서/PF    ② JD갭→블로그   ⑤ 시장인텔
                          │            │
                          ▼            ▼
                       ④ 지원추적 CRM (Notion + Slack 넛지)
```

### 의존성 순 로드맵 (각 Phase = 독립 스펙→플랜→구현 사이클)

| Phase | 내용 | 의존 |
|---|---|---|
| **1 (본 스펙)** | 역량 프로필 허브 + 이력서/포트폴리오 신디사이저 | merged PR (이미 읽기 가능) |
| 2 | JD 갭 분석 → 블로그/학습 주제 → BLOG 연결 | Phase 1 |
| 3 | 지원 추적 CRM (회사/상태/마감 Notion + Slack 넛지) | (②에서 JD 유입) |
| 4 | 시장·포지셔닝 인텔 (Tavily 회사 리서치) | Phase 1·2 |
| (후순위) | 면접 준비 (모의면접) | Phase 1·2 |

---

## 2. 확정된 설계 결정 요약

| 결정 | 선택 | 근거 |
|---|---|---|
| 메이트 형태 | **C. 하이브리드** — 단일 `CAREER_MATE` 에이전트 + 내부 capability 모듈, 추후 패밀리 승격 | 메이트는 "한 대화 상대" UX + 점진 확장. IntentClassifier 인프라 재활용 |
| 허브 데이터 소스 | **A. merged PR 만** (careerLog 는 Phase 1.5) | PR 은 careerLog 의 원천 + 지금 구조화 읽기 가능 + 증거 링크. 기존 write 경로 미수정(YAGNI) |
| 허브 영속 | **2-A. 전용 `CareerProfile` 테이블(블롭)** | 토대가 명시적. Phase 2~4 가 감사로그가 아닌 도메인 엔티티에 의존 |
| 빈 프로필 시 Render | **자동 Build 후 이어서 렌더** | 메이트다운 UX. Render 가 `findLatest() ?? await build()` 공유 |

---

## 3. 아키텍처 골격

```
@이대리 "내 포트폴리오 정리해줘" / "이력서 성과 뽑아줘"   (또는 슬래시)
        │
        ▼  IntentClassifier (자연어 → CAREER_MATE)
   CareerMateDispatcher              ← 단일 에이전트 (VACATION 하이브리드 패턴)
        │  ① 자연어면 LLM 으로 sub-intent 파싱 → { action, windowMonths? }
        │     (슬래시면 파싱 생략 — /career-profile|resume|portfolio 직결)
        │  ② 결정론 switch(action)
        ├─ BuildCareerProfileUsecase   → 허브 생성/갱신 (Claude 합성, Postgres 영속)
        ├─ RenderResumeUsecase         → 허브 읽어 STAR 이력서 bullet (LLM 0회)
        └─ RenderPortfolioUsecase      → 허브 읽어 포트폴리오 (Notion 미러, LLM 0회)
```

설계 원칙:
- **LLM 은 Build 에서만 1회** (+ 멘션 파싱 1회). Render 류는 허브를 결정론 포맷 → 비용·환각 최소, 일관성 ↑.
- 진입은 **슬래시 + 자연어 멘션 병행** (슬래시는 파싱 LLM 생략).
- 작은 단위로 격리: 각 usecase 는 하나의 책임, 포트 인터페이스로 통신, 독립 테스트 가능.

---

## 4. 데이터 소스 (Phase 1 = merged PR)

- 메서드: `GithubClientPort.listAuthorMergedPullRequestsSince({ repo, author, sinceIsoDate, limit })`
  - 구현: `src/github/infrastructure/octokit-github.client.ts:417`
  - 반환 `GithubPullRequestSummary`: `{ number, title, body, repo, url, state, mergedAt, updatedAt, additions, deletions, changedFilesCount }`
- 윈도우 기본값: **최근 12개월, limit 100** (요청 시 자연어로 조정 가능 — `windowMonths`).
- `author`(GitHub login): 단일 사용자(owner) 시스템 → 기존 PM 에이전트가 쓰는 owner GitHub 식별자 설정을 재사용.
  - **[열린 항목]** owner GitHub login 의 실제 소스(env/config 키)를 구현 계획 단계에서 확정.

---

## 5. 도메인 모델 + 영속

### 5.1 허브 표준 형태 `CareerProfileData` (모든 출력의 단일 소스)

```ts
type CareerProfileData = {
  summary: string;                 // 2~3문장 헤드라인 (포지셔닝)
  skills: Array<{
    name: string;                  // "NestJS", "BullMQ", "분산 큐 설계"
    category: 'LANGUAGE' | 'FRAMEWORK' | 'DOMAIN' | 'TOOL';
    proficiency: 'FAMILIAR' | 'PROFICIENT' | 'EXPERT';
    evidence: Array<{ repo: string; pr: number; url: string }>;
  }>;
  accomplishments: Array<{
    title: string;
    bullet: string;                // 이력서용 한 줄 (Action + Result + 정량)
    star: { situation: string; task: string; action: string; result: string };
    techTags: string[];
    evidence: Array<{ repo: string; pr: number; url: string; mergedAt: string }>;
  }>;
  meta: { githubLogin: string; windowStart: string; prCount: number };
};
```

원칙: **모든 skill·accomplishment 에 PR 증거 링크가 박힌다** → "증거 기반 이력서".

### 5.2 Prisma `CareerProfile` (블롭 + 쿼리용 상위 컬럼)

```prisma
model CareerProfile {
  id          Int       @id @default(autoincrement())
  agentRunId  Int?      @map("agent_run_id")            // 감사 링크
  agentRun    AgentRun? @relation(fields: [agentRunId], references: [id], onDelete: SetNull)
  slackUserId String    @map("slack_user_id")
  githubLogin String    @map("github_login")
  windowStart DateTime  @map("window_start") @db.Date
  prCount     Int       @map("pr_count")
  summary     String    @db.Text
  profileJson Json      @map("profile_json")             // = CareerProfileData
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")
  @@index([slackUserId, createdAt])
  @@map("career_profile")
}
```

- `AgentRun` 모델에 역관계 한 줄 추가: `careerProfiles CareerProfile[]`.
- **버저닝**: Build 1회 = 1 row insert → 이력 보존. "현재 프로필" = `slackUserId` 의 최신 `createdAt`.
- 적용: `prisma/schema.prisma` 수정 → `pnpm db:push` (synchronize, 마이그레이션 파일 X) → `pnpm prisma:generate`.
- 블롭 선택 이유: 단일 사용자 + 수십 항목 규모라 정규화 이득 적음. 필요 시 후속 정규화(YAGNI).

---

## 6. 컴포넌트 + 모듈 레이아웃

```
src/agent/career-mate/
├─ career-mate.module.ts
├─ domain/
│  ├─ career-mate.type.ts             # CareerProfileData, CareerMateAction enum
│  ├─ career-mate.error.ts            # 도메인 에러코드 + 예외
│  ├─ port/career-profile.repository.port.ts
│  └─ prompt/
│     ├─ career-mate-intent.prompt.ts    # 자연어 → action 파싱
│     └─ career-profile-synth.prompt.ts  # PR → CareerProfileData 합성
├─ application/
│  ├─ build-career-profile.usecase.ts    # LLM 합성 (AgentRun 래핑)
│  ├─ render-resume.usecase.ts           # 결정론 포맷 (허브 읽기, 없으면 자동 Build)
│  └─ render-portfolio.usecase.ts        # 결정론 + Notion 미러 (없으면 자동 Build)
└─ infrastructure/
   ├─ career-mate.dispatcher.ts          # AgentDispatcher 구현, VACATION 패턴
   ├─ career-profile.prisma.repository.ts
   └─ career-mate.formatter.ts           # Slack mrkdwn
```

참조 패턴:
- 디스패처: `src/agent/vacation/infrastructure/vacation.dispatcher.ts` (LLM intent 파싱 → 결정론 switch)
- 분석 usecase: `src/agent/po-eval/application/generate-po-evaluation.usecase.ts` (`agentRunService.execute({...})` 래핑)
- Notion 미러: `NotionClientPort.findOrCreateChildPage()` + `appendBlocks()` (`src/notion/`)

---

## 7. 호출 흐름 (세 capability)

### 7.1 BuildCareerProfile (LLM 1회 — 유일하게 비쌈)

```
agentRunService.execute({ agentType:CAREER_MATE, triggerType, inputSnapshot, evidence, run: async () => {
  a. githubLogin = owner 설정 (PM 에이전트와 동일 소스)
  b. prs = githubClient.listAuthorMergedPullRequestsSince({ author, sinceIsoDate(12개월), limit:100 })
  c. prs 비어있으면 → CareerMateNoEvidenceException
  d. completion = modelRouter.route({ agentType:CAREER_MATE, request:{ prompt: PR요약, systemPrompt: SYNTH_PROMPT } })  // Claude
  e. data = parseCareerProfileOutput(completion.text) → CareerProfileData (실패 시 InvalidModelOutput)
  f. repository.save({ slackUserId, githubLogin, windowStart, prCount, summary:data.summary, profileJson:data, agentRunId })
  g. return data
}})
→ formatter → Slack: "프로필 갱신 ✅ 스킬 N · 성과 M · 증거 PR K건" + 상위 3개 미리보기
```

### 7.2 RenderResume (LLM 0회)

```
profile = repository.findLatestBySlackUser(slackUserId) ?? await buildCareerProfile.execute({slackUserId})
→ profileJson.accomplishments[].bullet 을 카테고리별 STAR 이력서 블록으로 → Slack (복붙용)
```

### 7.3 RenderPortfolio (LLM 0회, BLOG 의 URL 반환 UX)

```
profile = repository.findLatestBySlackUser(slackUserId) ?? await buildCareerProfile.execute({slackUserId})
→ Notion blocks(스킬/테마별 heading + 증거링크 bullet) 생성
→ notionClient.findOrCreateChildPage(부모=CAREER_PORTFOLIO_NOTION_PAGE_ID) + appendBlocks
→ Slack: Notion 포트폴리오 URL
```

---

## 8. 진입·등록 (에이전트 추가 체크리스트)

| # | 작업 | 위치 |
|---|---|---|
| 1 | `AgentType.CAREER_MATE` | `src/model-router/domain/model-router.type.ts` |
| 2 | `AGENT_TO_PROVIDER[CAREER_MATE] = CLAUDE` | `src/model-router/application/model-router.usecase.ts` (Record exhaustive = 컴파일 강제) |
| 3 | `TriggerType.SLACK_COMMAND_CAREER_MATE` / `SLACK_MENTION_CAREER_MATE` | `src/agent-run/domain/agent-run.type.ts` |
| 4 | `ResponseCode.CAREER_MATE_*` (도메인에러 1:1) | `src/common/exception/response-code.enum.ts` |
| 5 | `CareerMateModule` import + `CareerMateDispatcher` inject | `src/router/router.module.ts` |
| 6 | IntentClassifier 분류 기준 추가 ("프로필/이력서/포트폴리오/커리어") | `src/router/domain/prompt/intent-classifier-system.prompt.ts` |
| 7 | `/retry-run` case CAREER_MATE → BuildProfile 재실행 | `src/slack/handler/retry-run.handler.ts` |
| 8 | AgentRegistry 엔트리 (spec 가 자동 검증) | `src/agent-registry/agent-registry.ts` |
| 9 | Slack 슬래시 핸들러 `/career-profile|resume|portfolio` | `src/slack/handler/` |
| + | env `CAREER_PORTFOLIO_NOTION_PAGE_ID` **4곳 동기** | `.env.example` · `.env` · `src/config/app.config.ts` · README |
| + | `CareerMateModule` 등록 | `src/app.module.ts` |

---

## 9. 에러 처리 (도메인에러 → ResponseCode → AllExceptionsFilter → Slack)

| 상황 | 코드 | 사용자 메시지 |
|---|---|---|
| 기간 내 merged PR 0건 | `CAREER_MATE_NO_EVIDENCE` | "최근 12개월 merged PR 이 없습니다 — 기간을 늘려 다시 요청하세요" |
| Claude 출력 파싱 실패 | `CAREER_MATE_INVALID_MODEL_OUTPUT` | "프로필 생성 실패 — 다시 시도해주세요" (model-router 가 Claude 실패 시 ChatGPT 자동 폴백) |
| 입력 비어있음(슬래시) | `CAREER_MATE_EMPTY_INPUT` | 사용법 안내 |
| GitHub/Notion API 오류 | 기존 인프라 예외 래핑 | "외부 연동 일시 오류" |

- **Slack 3초 ack**: Build 는 Claude latency(≤180s) → 즉시 ack → `respond({ replace_original:true })` 로 덮어쓰기 (`slack-handler.helper.ts` 재사용). Render 류는 결정론이라 빠름.

---

## 10. 테스트 전략

- **단위(jest, 전부 mock — live LLM/GitHub/Notion 호출 X)**:
  - `career-mate.dispatcher.spec` — 자연어 파싱 → action별 올바른 usecase 라우팅 + UNKNOWN.
  - `build-career-profile.usecase.spec` — PR 샘플 mock → save 호출 검증 / PR 0건 → NoEvidence / 잘못된 LLM 출력 → InvalidModelOutput.
  - `render-resume.usecase.spec` — 프로필 있을 때 STAR 포맷 / 없을 때 자동 Build 호출 후 렌더.
  - `render-portfolio.usecase.spec` — Notion blocks 생성 + appendBlocks 호출 + URL 반환.
  - `career-mate.formatter.spec` — mrkdwn escape/구조.
  - `parseCareerProfileOutput` 순수함수 테스트.
- **자동 검증**: `agent-registry.spec`(AgentType 망라) + `AGENT_TO_PROVIDER` Record(컴파일타임).
- **완료 기준**: `pnpm lint:check && pnpm test && pnpm build` 3중 green. 실 LLM E2E 는 owner 가 Slack 에서 수동.

---

## 11. 범위 밖 / 후속

- **Phase 1.5**: careerLog 통합 (Notion read-back 또는 write 시점 Postgres 미러). Impact Report 흡수.
- **Phase 2**: JD 갭 분석 → 블로그/학습 주제 → BLOG 에이전트 연결.
- **Phase 3**: 지원 추적 CRM. **Phase 4**: Tavily 시장 인텔. (후순위) 면접 준비.
- **자동 갱신 훅**: PR merged webhook → 프로필 증분 갱신 (현재는 수동 트리거).

---

## 12. 가정 / 열린 항목

1. owner GitHub login 의 실제 설정 소스(env/config 키) — 구현 계획에서 확정 (PM 에이전트 재사용).
2. `CAREER_PORTFOLIO_NOTION_PAGE_ID` 는 신규 env (owner 가 Notion 부모 페이지 생성 후 주입).
3. 단일 사용자(owner) 전제 — multi-user 는 범위 밖.
