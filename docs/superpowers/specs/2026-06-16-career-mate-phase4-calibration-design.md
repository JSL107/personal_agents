# 이직 메이트 Phase 4 설계서 — 이력서/프로필 보정 점검 (Calibration)

- 작성일: 2026-06-16
- 상태: 설계 승인됨 (구현 계획 대기)
- 범위: **Phase 4 만** (Phase 3 CRM 은 별도 사이클).
- 선행: Phase 1·2 (이미 `main` 머지). 구현 브랜치는 `feat/career-mate-phase4` (main 기준).
- 관련: `2026-06-15-career-mate-phase1-design.md`, `2026-06-15-career-mate-phase2-jd-gap-design.md`.

---

## 1. 배경 / 목적

career-mate 가 "한 번 만들어주는" 생성기에 머물면 장난감이 된다. 실제 이직에 도움 되려면 **닫힌 피드백 루프**가 필요하다:
```
프로필/이력서(P1·2) → 현재 시장기준 보정(P4) → 지원·추적(P3) → 응답 학습 → 보정 반복
```
Phase 4 는 그중 **"현재 기준으로 내 이력서/프로필을 보정"** 하는 조각이다. 사용자 질문("실제 2026 이력서가 어떻게 쓰이는지 주기적으로 습득해 내 것을 쓸모있게")의 직접 구현:
- **주기적 습득** = 주1회 cron 이 웹에서 현재 2026 이력서/채용 트렌드를 끌어와 점검에 반영.
- **실제 도움** = 증거 기반 진단(AI-slop / 정량부족 / 구식표현 / 빠진 키워드 / 액션아이템).

---

## 2. 확정 결정 요약

| 결정 | 선택 | 근거 |
|---|---|---|
| 형태 | CAREER_MATE 에 `CALIBRATE_RESUME` action 추가 (새 에이전트 X) | Phase 1·2 하이브리드 폼 유지 |
| 핵심 산출물 | **내 이력서/프로필 보정 점검**(calibration critique) | 사용자 선택 — "내 것을 직접 쓸모있게" |
| 현재 기준 출처 | **A3 하이브리드** — 온디맨드=Claude 지식(즉시) / 주1회 cron=Hermes 웹리서치 augment | "주기적 습득" + "즉시·안정" 둘 다 |
| 모델 | `AgentType.CAREER_MATE` → CLAUDE 재사용 | 구조화 진단 |
| 웹 경로 | `HermesRunnerPort`(BLOG 공유, Tavily 보유) 재사용 | 이대리에 직접 웹검색 없음 |
| cron | BullMQ repeatable (CeoMetaCron 패턴), 주1회 기본 | 검증된 인프라 |

---

## 3. 아키텍처

```
[온디맨드]  @idaeri "이력서 점검해줘"
  → IntentClassifier → CAREER_MATE → CareerMateDispatcher (action: CALIBRATE_RESUME)
  → CalibrateResumeUsecase.execute({ slackUserId })            // webTrendsNote 없음 = 빠름
      a. 허브 read findLatestBySlackUser() ?? 자동 Build
      b. Claude: 프로필 + (webTrendsNote?) → CalibrationResultData
  → 답글: 보정 리포트 (formatCalibrationReport)

[주1회 cron]  ResumeCalibrationCronScheduler (OnApplicationBootstrap, BullMQ repeatable)
  → ResumeCalibrationCronConsumer (WorkerHost):
      a. Hermes 웹리서치(HermesRunnerPort.run) → "현재 2026 이력서/채용 트렌드" 텍스트 노트
         (실패 시 webTrendsNote=undefined 로 graceful — 점검은 계속)
      b. CalibrateResumeUsecase.execute({ slackUserId, webTrendsNote })  // 웹 augment
      c. SlackNotifierPort.postMessage({ target, text: formatCalibrationReport(...) })
```

설계 원칙: 한 usecase(`CalibrateResumeUsecase`)가 온디맨드·cron 양쪽을 담당하되, **웹 노트는 optional 입력**으로 주입(온디맨드=없음, cron=Hermes). LLM 은 Claude 1회. 무상태(새 테이블 X).

---

## 4. 컴포넌트

**신규 (`src/agent/career-mate/`)**
- `application/calibrate-resume.usecase.ts` — 허브 read(없으면 자동 Build) → Claude 진단 → `CalibrationResultData`. AgentRun 래핑. 입력 `{ slackUserId, webTrendsNote?: string }`.
- `domain/prompt/calibration.prompt.ts` — `CALIBRATION_SYSTEM_PROMPT` + `buildCalibrationPrompt(profile, webTrendsNote?)` + `parseCalibrationOutput(text)`.

**신규 (`src/resume-calibration-cron/`, CeoMetaCron 구조 복제)**
- `domain/resume-calibration-cron.type.ts` — QUEUE/JOB 상수, JobData, 기본 cron/tz.
- `application/resume-calibration-cron.scheduler.ts` — `OnApplicationBootstrap`, BullMQ repeatable 등록 (env owner/cron/tz, 미설정 시 graceful 비활성).
- `infrastructure/resume-calibration-cron.consumer.ts` — `@Processor` WorkerHost. Hermes 웹리서치 → CalibrateResumeUsecase → SlackNotifierPort.
- `resume-calibration-cron.module.ts` — 와이어링.

**수정**
- `domain/prompt/career-mate-intent.prompt.ts` — `CALIBRATE_RESUME` 분류.
- `domain/career-mate.type.ts` — `CALIBRATE_RESUME` action + `CalibrationResultData` + `CalibrateResumeInput`.
- `infrastructure/career-mate.dispatcher.ts` — `CALIBRATE_RESUME` case.
- `infrastructure/career-mate.formatter.ts` — `formatCalibrationReport(data)` (mrkdwn escape).
- `career-mate.module.ts` — `CalibrateResumeUsecase` 등록 + export(cron 이 주입).
- `app.module.ts` — `ResumeCalibrationCronModule` 등록.
- `app.config.ts` + `.env.example` — `RESUME_CALIBRATION_*` env.
- `response-code.enum.ts` / `career-mate-error-code.enum.ts` — 필요 시 재사용(NO_EVIDENCE/INVALID_MODEL_OUTPUT).

**재사용**
- `CareerProfileRepositoryPort.findLatestBySlackUser`, `BuildCareerProfileUsecase`(자동 Build), `HermesRunnerPort.run`(웹리서치), `SlackNotifierPort.postMessage`, BullMQ cron 패턴, `ModelRouterUsecase`/CAREER_MATE→CLAUDE.

---

## 5. 데이터 (무상태)

```ts
type CalibrationResultData = {
  verdict: string;            // 한 줄 총평 + 현재 기준 적합도
  aiSlopRisks: string[];      // generic / AI 티 나는 표현 (구체성 부족)
  underQuantified: string[];  // 정량 지표 빠진 성과
  outdatedPhrasing: string[]; // 2026 기준 구식 표현
  missingKeywords: string[];  // 타겟 직무에서 기대되나 빠진 키워드/스킬
  actionItems: string[];      // 우선순위 개선 액션
};

interface CalibrateResumeInput {
  slackUserId: string;
  webTrendsNote?: string;     // cron 에서 Hermes 웹리서치 결과 주입 (온디맨드는 생략)
}
```
- 무상태 — 결과는 AgentRun.output 으로만 영속(별도 테이블 X). 갭/액션을 블로그로 메울 만하면 안내문에 "주제로 BLOG 써보세요" 힌트(체인 자동화는 범위 밖, Phase 2 와 차별).

---

## 6. 호출 흐름 상세

**CALIBRATE_RESUME (온디맨드)**
```
dispatch: intent.action === 'CALIBRATE_RESUME'
 → CalibrateResumeUsecase.execute({ slackUserId })   // webTrendsNote 없음
     agentRunService.execute({ agentType:CAREER_MATE, triggerType:SLACK_MENTION_CAREER_MATE, run: async () => {
       profile = repo.findLatestBySlackUser ?? (await buildProfile.execute()).result
       completion = modelRouter.route({ prompt: buildCalibrationPrompt(profile, undefined), systemPrompt: CALIBRATION_SYSTEM_PROMPT })
       data = parseCalibrationOutput(completion.text)
       return { result: data, modelUsed, output: data }
     }})
 → formatCalibrationReport(data)
```

**주1회 cron**
```
scheduler: OnApplicationBootstrap → queue.add(JOB, {ownerSlackUserId, target}, { repeat:{pattern,tz}, jobId, ... })
consumer.process(job):
  trendsNote = await safeHermesResearch()   // HermesRunnerPort.run(RESEARCH_PROMPT) → 텍스트, 실패 시 undefined
  outcome = await calibrateResume.execute({ slackUserId: ownerSlackUserId, webTrendsNote: trendsNote })
  await slackNotifier.postMessage({ target, text: formatCalibrationReport(outcome.result) })
```
> `safeHermesResearch`: HermesRunnerPort.run 의 텍스트 결과 사용. (HermesRunResult 의 정확한 텍스트 필드는 구현 계획에서 확인 — BLOG 는 Notion URL 추출용이나 raw stdout/text 도 보유.) 실패/타임아웃 → undefined 반환(throw 안 함) → Claude 지식만으로 graceful degrade.

---

## 7. 에러 처리

| 상황 | 처리 |
|---|---|
| 허브 없음 + PR 0 | 자동 Build 시도 → 그래도 없으면 `CAREER_MATE_NO_EVIDENCE`(재사용) |
| Claude 출력 파싱 실패 | `CAREER_MATE_INVALID_MODEL_OUTPUT`(재사용) |
| Hermes 웹리서치 실패(cron) | **graceful** — webTrendsNote=undefined, 점검은 Claude 지식만으로 계속 |
| cron 발송 실패 | 기존 cron 실패 알림 패턴(NotificationPublisher) 재사용 |

---

## 8. 테스트 전략 (전부 mock, live 호출 X)

- `parseCalibrationOutput` 순수함수 (정상/형태오류/코드펜스).
- `buildCalibrationPrompt` — webTrendsNote 유/무 분기 (있으면 프롬프트에 포함).
- `CalibrateResumeUsecase` — mock 허브(있음/없음→자동Build) + mock LLM → CalibrationResultData 반환.
- `formatCalibrationReport` — 섹션 구성 + LLM 텍스트 mrkdwn escape.
- `career-mate.dispatcher` — CALIBRATE_RESUME case 라우팅.
- cron `scheduler` — env 있음/없음(graceful 비활성) 등록 분기.
- cron `consumer` — mock HermesRunner(성공/실패 graceful) + mock CalibrateResume + mock SlackNotifier → postMessage 호출 검증.
- **완료 기준**: `pnpm lint:check && pnpm test && pnpm build && pnpm docs:check` 4중 green.

---

## 9. 범위 밖 / 후속

- BLOG 자동 체인(보정 액션→블로그 초안): 힌트만, 자동 체인은 후속(Phase 2 패턴 재사용 가능).
- 타겟 직무 JD 집계(market-demand) = Phase 4.5/별도.
- 결과 추적/학습(어떤 보정이 콜백을 늘렸나) = Phase 3 CRM.

---

## 10. 가정 / 열린 항목

1. `HermesRunResult` 의 텍스트 필드(웹리서치 raw 응답) — 구현 계획에서 확인. BLOG 는 Notion URL 추출용이나 stdout 보유 추정. 안 되면 thin research 변형 추가.
2. cron env: `RESUME_CALIBRATION_OWNER_SLACK_USER_ID` / `RESUME_CALIBRATION_TARGET`(기본 owner DM) / `RESUME_CALIBRATION_CRON`(기본 `0 10 * * 1` 월 10시) / `RESUME_CALIBRATION_TIMEZONE`(기본 Asia/Seoul). 미설정 시 cron 비활성(온디맨드는 동작).
3. 온디맨드는 웹 없음(빠름) — 사용자가 매번 최신 웹을 원하면 cron 또는 후속 옵션.
4. `.env` 주입은 owner (툴 권한 밖).
