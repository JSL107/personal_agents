# 이직 메이트 Phase 3 설계서 — 지원 추적 CRM (Job Application Tracker)

- 작성일: 2026-06-16
- 상태: 설계 승인됨 (구현 계획 대기)
- 범위: **Phase 3 만** (추적기 + 넛지). 결과 학습/Notion 미러는 후속(P3.5).
- 선행: Phase 1·2·4 (이미 main). 브랜치 `feat/job-application-crm` (main 기준).
- 관련: Phase 1·2·4 설계서, **레퍼런스 = VACATION 에이전트(`src/agent/vacation/`)**.

---

## 1. 배경 / 목적

이직 메이트 피드백 루프 `프로필/이력서 → 보정 → 지원·추적 → 응답 학습 → 보정 반복` 의 **outcome 추적 조각**. "내가 어디에 지원했고 무슨 상태인지" 를 기록·조회하고, **마감/팔로업을 놓치지 않게 넛지**한다. (앞 단계 P1·2·4 와 달리 상태를 **영속**하는 CRM.)

핵심 가치(확정): **추적기 + 넛지.** 결과 학습(어떤 포지셔닝이 콜백을 받았나)은 데이터가 쌓인 뒤 P3.5.

---

## 2. 확정 결정 요약

| 결정 | 선택 | 근거 |
|---|---|---|
| 아키텍처 | **신규 자체 에이전트 `JOB_APPLICATION`** (VACATION 스타일) | param-rich CRUD 라 CAREER_MATE 의 "허브 합성" 계열과 분리. Phase 1 이 예고한 패밀리 분화. IntentClassifier 가 라우팅하므로 UX 는 여전히 `@이대리` 하나 |
| 저장소 | **Postgres (Prisma `JobApplication`)** | cron 넛지가 "마감 임박/팔로업 지남" 을 SQL 로 깔끔히 쿼리. VACATION leave_usage 선례 |
| 진입 | 자연어 → LLM 파라미터 추출 1회 → 결정론 CRUD (VACATION 패턴) | LLM 은 추출만, 비즈니스 로직은 결정론 |
| 모델 | `AGENT_TO_PROVIDER[JOB_APPLICATION] = CHATGPT` | param 추출 경량 작업 (VACATION 동일) |
| 넛지 | 매일 cron (CeoMetaCron 복제), env 미설정 시 비활성 | 검증된 BullMQ repeatable 패턴 |

---

## 3. 아키텍처

```
[CRUD]  @이대리 "토스 백엔드 지원했어, 마감 6/30"  / "토스 서류 합격" / "지원 현황"
  → IntentClassifier → JOB_APPLICATION → JobApplicationDispatcher
  → LLM 1회 파라미터 추출 → parseJobApplicationIntent { action, company?, role?, status?, ref?, deadline?, ... }
  → 결정론 switch:
      ADD            → AddApplicationUsecase     (repository.save)
      UPDATE_STATUS  → UpdateApplicationUsecase  (repository.updateStatus)
      LIST           → ListApplicationsUsecase   (repository.listByUser)
      (UNKNOWN/잘못된 입력 → 사용법 안내)
  → Slack 답글 (formatter)

[넛지 cron]  JobApplicationNudgeCronScheduler (BullMQ repeatable, 매일 09:00 KST 기본)
  → Consumer: repository.findDueNudges(slackUserId, today)  // 마감≤3일 OR nextFollowUpAt 경과
              → 있으면 SlackNotifierPort.postMessage (리마인더), 없으면 skip
```

VACATION 과 동일 구조(자체 에이전트 + dispatcher + CRUD usecases + Prisma repo) + cron(CeoMetaCron 복제). LLM 은 ADD/UPDATE 파라미터 추출에만.

---

## 4. 데이터 모델 (Postgres)

```prisma
model JobApplication {
  id             Int       @id @default(autoincrement())
  slackUserId    String    @map("slack_user_id")
  company        String
  role           String
  jdUrl          String?   @map("jd_url")
  status         String    // APPLIED | SCREENING | INTERVIEW | OFFER | REJECTED | WITHDRAWN
  appliedAt      DateTime  @map("applied_at") @db.Date
  deadline       DateTime? @db.Date
  nextFollowUpAt DateTime? @map("next_follow_up_at") @db.Date
  notes          String?   @db.Text
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")
  @@index([slackUserId, status])
  @@map("job_application")
}
```
- status 는 도메인 `ApplicationStatus` union/enum 으로 검증. 적용: schema 수정 → `pnpm db:push` → `pnpm prisma:generate`.
- 날짜는 `@db.Date` (VACATION leave_usage 의 plain-date 헬퍼 패턴 재사용 — UTC 자정 round-trip).

---

## 5. 진입/파싱 (VACATION 패턴)

`JobApplicationDispatcher` (AgentDispatcher, agentType=JOB_APPLICATION):
```
dispatch(input):
  completion = modelRouter.route({ agentType: JOB_APPLICATION, request:{ prompt:`[오늘:${todayKst}]\n${input.text}`, systemPrompt: PARSE_PROMPT } })
  intent = parseJobApplicationIntent(completion.text)   // JSON → 구조화, 실패 시 예외
  switch(intent.action):
    ADD           → addApplication.execute({ slackUserId, company, role, jdUrl?, status?(기본 APPLIED), appliedAt?(기본 today), deadline? })
    UPDATE_STATUS → updateApplication.execute({ slackUserId, ref(회사명/최근), status })
    LIST          → listApplications.execute({ slackUserId, statusFilter? })
    default       → 사용법 안내
```
- `parseJobApplicationIntent`: 순수 함수 (VACATION `parseNlVacationIntent` 미러) — JSON 파싱 + 검증 + 실패 시 `JobApplicationException(NL_PARSE_FAILED)`.
- UPDATE 의 `ref`: 회사명 매칭(부분일치) — 모호하면(여러 건) 안내. 최신 1건 가정도 가능.

---

## 6. 넛지 cron (CeoMetaCron 복제)

- `JobApplicationNudgeCronScheduler`: `OnApplicationBootstrap`, BullMQ repeatable. env `JOB_APPLICATION_NUDGE_OWNER_SLACK_USER_ID` 미설정 시 graceful 비활성. 기본 `0 9 * * *`(매일 09:00), tz Asia/Seoul.
- `JobApplicationNudgeCronConsumer`: `repository.findDueNudges({ slackUserId, today, deadlineWithinDays: 3 })` → `(마감 ≤ 3일 & 미종료상태) OR (nextFollowUpAt ≤ today)` 건 조회 → 있으면 `SlackNotifierPort.postMessage(리마인더 목록)`, 없으면 skip. `deliverOnce` 멱등 + `notifyOwnerFailure`.
- 종료상태(OFFER/REJECTED/WITHDRAWN)는 넛지 제외.

---

## 7. 컴포넌트

**신규 `src/agent/job-application/`**
- `domain/job-application.type.ts` — `ApplicationStatus`, `JobApplicationIntent`, `JobApplicationRecord`, usecase 입출력
- `domain/job-application-error-code.enum.ts` + `job-application.exception.ts` (VACATION 패턴)
- `domain/prompt/job-application-parse.prompt.ts` — `PARSE_PROMPT` + `parseJobApplicationIntent`
- `domain/port/job-application.repository.port.ts` — `save`/`updateStatus`/`listByUser`/`findDueNudges` + 토큰
- `application/add-application.usecase.ts` · `update-application.usecase.ts` · `list-applications.usecase.ts`
- `infrastructure/job-application.dispatcher.ts` · `job-application.prisma.repository.ts`
- `infrastructure/job-application.formatter.ts` (Slack mrkdwn, escape)
- `job-application.module.ts`

**신규 `src/job-application-nudge-cron/`** (CeoMetaCron 복제): type/scheduler/consumer/module

**수정 (9단계 등록)**: `AgentType.JOB_APPLICATION` · `AGENT_TO_PROVIDER`(CHATGPT) · `TriggerType`(SLACK_MENTION_JOB_APPLICATION + 필요시 NUDGE) · `ResponseCode`(JOB_APPLICATION_*) · router.module(import+inject) · intent-classifier prompt · retry-run case · agent-registry · app.module(cron) · app.config+.env.example(JOB_APPLICATION_NUDGE_* env) · prisma/schema.prisma(+AgentRun? — CRUD 는 AgentRun 래핑 선택)

**재사용**: VACATION 전 패턴 · PrismaService · SlackNotifierPort · BullMQ cron · CronIdempotencyService · NotificationPublisher · plain-date 헬퍼

---

## 8. AgentRun 래핑 여부
VACATION 의 결정론 CRUD usecase 는 AgentRun 을 **선택적**으로 래핑(LIST 는 0, register/cancel 은 래핑). Phase 3 도 동일: ADD/UPDATE 는 AgentRun 래핑(감사), LIST 는 비래핑(조회만). 구현 계획에서 VACATION 의 실제 래핑 여부 확인 후 동일 적용.

---

## 9. 에러 처리

| 상황 | 코드 | 메시지 |
|---|---|---|
| 자연어 파싱 실패 | `JOB_APPLICATION_NL_PARSE_FAILED` | "다시 말씀해주세요 — 예: '토스 백엔드 지원했어'" |
| ADD 필수(회사/직무) 누락 | `JOB_APPLICATION_MISSING_FIELDS` | "회사·직무를 알려주세요" |
| UPDATE 대상 모호/없음 | `JOB_APPLICATION_NOT_FOUND` | "어느 지원 건인지 회사명으로 알려주세요" |
| 잘못된 status | `JOB_APPLICATION_INVALID_STATUS` | 허용 상태 안내 |

---

## 10. 테스트 전략 (전부 mock, live 호출 X)

- `parseJobApplicationIntent` 순수함수 (ADD/UPDATE/LIST/UNKNOWN, 날짜·상태 파싱, 코드펜스).
- Add/Update/List usecase (mock repository) — save/updateStatus/listByUser 호출 검증, 누락/모호 예외.
- `job-application.prisma.repository` (mock PrismaService) — save/updateStatus/listByUser/findDueNudges 쿼리.
- dispatcher (mock modelRouter+usecase) — action 라우팅.
- formatter — 목록/상태 mrkdwn escape.
- 넛지 cron scheduler(env gating)/consumer(due 있음·없음, 종료상태 제외).
- **완료 기준**: `pnpm lint:check && pnpm test && pnpm build && pnpm docs:check` 4중 green (신규 에이전트 → agent-catalog 갱신 + 신규 env → env-catalog 갱신 = docs:sync 필요).

---

## 11. 범위 밖 / 후속

- **P3.5 결과 학습**: 상태 전이(OFFER/REJECTED) 통계 → 어떤 포지셔닝/이력서 버전이 콜백률 높았나 → CAREER_MATE 프로필/보정에 피드백.
- **Notion 보드 미러**: 지원 현황 칸반 (P3.5).
- 면접 일정 캘린더 연동.

---

## 12. 가정 / 열린 항목

1. AgentRun 래핑 여부 — VACATION 실제 패턴 확인 후 동일(구현 계획).
2. UPDATE 대상 지정: 회사명 부분일치 우선, 모호 시 안내. (정교한 다중매칭 disambiguation 은 후속.)
3. 넛지 cron env: `JOB_APPLICATION_NUDGE_OWNER_SLACK_USER_ID`/`_TARGET`/`_CRON`(기본 `0 9 * * *`)/`_TIMEZONE`. 미설정 시 비활성(CRUD 는 동작).
4. `.env` 주입은 owner.
5. 단일 사용자(owner) 전제 — slackUserId 스코프.
