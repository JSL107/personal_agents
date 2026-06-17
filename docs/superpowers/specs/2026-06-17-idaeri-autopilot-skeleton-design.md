# 이대리 Autopilot — SP1 골격 설계

> **상위 비전**: 이대리(회사 롤플레이 구조 유지)를 *수동 slash* → *자동 proactive* 로 전환. 트리거는 하이브리드(GitHub 이벤트 + cron 리듬), 자율성은 리스크 티어(읽기/요약/알림=자동, 비가역 외부쓰기=PreviewGate 확인), 효율(노이즈/쿼터 최소화) 중시.
>
> 이 문서는 그 비전의 **첫 서브프로젝트(SP1) = Autopilot 골격**만 다룬다. 후속 SP2~SP5 는 §8 참조.

**날짜**: 2026-06-17
**상태**: 설계 리뷰 대기 (구현 전)

---

## 1. 배경 — 현실 보정

감사 결과 이대리는 **이미 ~68% 자동**이다:

- **cron 7개**: 아침신문(07시) · daily-eval(19시, PO_EVAL) · CEO 메타(주1) · resume 보정(주1) · job 넛지(매일) · impact(주1) · weekly 요약(주1)
- **webhook 5개**: PR열림→BE_FIX(+조건부 CODE_REVIEWER) · CI실패→BE_SRE · PR머지→careerlog · 이슈열림→labeler · 내부 impact 발화
- **자연어 멘션 라우터**: intent classifier → 13 dispatcher

문제는 자동화 *부재* 가 아니라 **분산**이다:

1. 7개 cron 이 각자 별도 큐·스케줄러로 따로 알림을 쏜다 → "지금 무엇이 자동으로 도는지" 단일 조망이 없고, 하루에 알림이 흩뿌려진다(노이즈).
2. 남은 수동 코어(PM `/today`, WORK_REVIEWER `/worklog`, CODE_REVIEWER, PO_SHADOW, CTO `/assign`, BE plan/schema/test)는 사람이 슬래시를 쳐야만 돈다.
3. 효율 제어(활동 0이면 skip, 쿼터 절약, 멱등)가 cron 마다 제각각 구현돼 일관성이 없다.

→ SP1 은 이 분산을 통합할 **중앙 골격**을 만든다. 신규 자동화 흐름(출근/퇴근/주간 통합)은 SP2~SP4 가 이 골격 위에 올린다.

## 2. 목표 (SP1 한정)

선언적 **워크데이 플레이북** + 얇은 **오케스트레이터 엔진**을 만든다. 엔진은:

- 플레이북에 선언된 항목을 **시간 트리거(cron)** 로 발화시킨다. (이벤트 트리거는 타입만 정의, 실행은 SP4)
- 각 항목 실행을 **리스크 티어**로 처리: `T0_AUTO`(결과를 Slack 자동 게시) / `T1_PREVIEW`(PreviewGate 로 확인 요청).
- **효율 장치** 내장: 활동 0이면 게시 skip, 같은 슬롯의 여러 항목을 **하나의 다이제스트로 묶음**, 일 단위 멱등 가드.
- 기존 cron 패턴(CronIdempotency · NotificationPublisher · BullMQ repeatable · owner env gate)을 **재사용**한다 — 새 인프라 최소화.

**SP1 의 "동작하는 산출물"**: 엔진 + 플레이북 스키마 + **기존 cron 1개(Daily Eval)를 플레이북으로 이관한 수직 슬라이스**. 이로써 엔진이 실제 프로덕션 cron 하나를 end-to-end 로 굴린다는 걸 증명한다. 나머지 6개 cron 은 SP2~SP4 가 점진 이관한다(SP1 에선 그대로 유지).

## 3. 비목표 (SP1 에서 안 하는 것)

- 이벤트 트리거 **실행**(GitHub webhook → 플레이북) — 스키마만, 실행은 SP4.
- 출근/퇴근/주간 **통합 흐름** — SP2/SP3/SP4.
- 나머지 6개 cron 이관, 수동 에이전트(PM/worklog) 자동 생성 전환 — SP2~SP4.
- 미사용 기능 정리(cleanup) — SP5 (DB 사용량 확인 후).
- crawler · V3 SOTA 계획문서: 보존(삭제 X).

## 4. 아키텍처

신규 모듈 `src/autopilot/` (헥사고날: domain / application / infrastructure).

```
src/autopilot/
  domain/
    playbook.type.ts          # 플레이북 선언 타입 (트리거/액션/티어)
    autopilot-task.port.ts    # AUTOPILOT_TASK_PORT + AutopilotTask 인터페이스
    autopilot.playbook.ts     # 실제 플레이북 인스턴스(선언 데이터) — "무엇이 언제"
  application/
    autopilot.scheduler.ts    # OnApplicationBootstrap — 플레이북 cron 항목을 repeatable 등록
    autopilot.orchestrator.ts # 발화된 항목 실행: task run → idle skip → 티어 전달 → 다이제스트
    autopilot-delivery.service.ts # 리스크 티어 전달(T0 Slack / T1 PreviewGate)
  infrastructure/
    autopilot.consumer.ts     # @Processor(AUTOPILOT_CRON_QUEUE) WorkerHost
    tasks/
      po-eval.autopilot-task.ts  # 수직 슬라이스: Daily Eval(PO_EVAL) 이관 task
  autopilot.module.ts
  domain/autopilot.type.ts    # 큐명 상수, 기본 스케줄 등
```

### 4.1 플레이북 스키마 (`playbook.type.ts`)

```ts
export type RiskTier = 'T0_AUTO' | 'T1_PREVIEW';

// 시간 트리거 (SP1 구현). 이벤트 트리거는 타입만(SP4 실행).
export interface CronTrigger {
  kind: 'CRON';
  schedule: string;   // cron expr (env override 가능)
  timezone: string;   // 기본 'Asia/Seoul'
}
export interface EventTrigger {
  kind: 'EVENT';
  event: string;      // 예: 'github.pull_request.opened' (SP4 에서 라우팅)
}
export type PlaybookTrigger = CronTrigger | EventTrigger;

export interface PlaybookEntry {
  id: string;                 // 안정 식별자(멱등 키·로그·이관 추적). 예: 'daily-eval'
  taskToken: symbol;          // 실행할 AutopilotTask DI 토큰
  trigger: PlaybookTrigger;
  riskTier: RiskTier;
  digestGroup?: string;       // 같은 그룹은 한 다이제스트로 묶음(예: 'evening'). 없으면 단독 게시.
  enabled: boolean;           // owner env 미설정 등으로 비활성 가능
}
```

### 4.2 AutopilotTask 포트 (`autopilot-task.port.ts`)

엔진을 특정 에이전트에서 분리하는 핵심 추상화. 기존 cron 의 "핵심 로직"을 task 로 감싼다.

```ts
export interface AutopilotTaskContext {
  ownerSlackUserId: string;
  firedAt: PlainDate;         // KST 기준 발화일(멱등·표시용)
}

export interface AutopilotTaskResult {
  // 게시할 내용이 없으면 skip=true → 엔진이 빈 알림을 보내지 않는다(효율).
  skip: boolean;
  // T0: Slack mrkdwn 본문. T1: PreviewGate 페이로드 기반.
  slackText?: string;
  previewKind?: string;       // T1 일 때만
  previewPayload?: unknown;   // T1 일 때만
}

export interface AutopilotTask {
  readonly id: string;                 // PlaybookEntry.id 와 일치
  run(context: AutopilotTaskContext): Promise<AutopilotTaskResult>;
}
```

### 4.3 오케스트레이터 동작

부팅 → 발화 → 전달까지의 흐름:

1. **부팅** (`autopilot.scheduler.ts`, `OnApplicationBootstrap`): owner env 없으면 전체 비활성(graceful return). `cleanupExistingRepeatables()` 후 플레이북의 `CRON` 항목마다 `AUTOPILOT_CRON_QUEUE` 에 named repeatable 등록(jobName = entry.id). 이벤트 항목은 등록 skip(SP4).
2. **발화** (`autopilot.consumer.ts`): `@Processor(AUTOPILOT_CRON_QUEUE)` 가 job 수신 → orchestrator 위임.
3. **실행** (`autopilot.orchestrator.ts`):
   - 멱등 가드: `CronIdempotencyService.acquireOnce('autopilot:<entry.id>:<dateKey>', TTL)` — 중복 발화 차단(기존 패턴).
   - 해당 `taskToken` 의 `AutopilotTask.run(context)` 실행.
   - `result.skip === true` → 조용히 종료(빈 알림 금지).
   - 아니면 `autopilot-delivery.service` 로 티어 전달.
   - 실패 시 `NotificationPublisher.publishCronFailure({ cronName: 'Autopilot:<id>', ... })` 후 throw(BullMQ 재시도).
4. **전달** (`autopilot-delivery.service.ts`):
   - `T0_AUTO`: `digestGroup` 이 있으면 같은 그룹 결과를 모아 한 번에, 없으면 즉시 `SlackNotifierPort.postMessage`.
   - `T1_PREVIEW`: `CreatePreviewUsecase` 로 preview 생성(사용자 탭 대기). 기존 PreviewGate 소유권/TTL 규칙 준수.

> **다이제스트 묶기(SP1 범위)**: SP1 에선 cron 항목이 사실상 Daily Eval 하나뿐이라 `digestGroup` 묶기는 *스키마+전달 경로*만 구현하고, 실제 다중 묶기는 SP2~SP4(출근/퇴근/주간에 여러 task 가 한 그룹에 들어갈 때)에서 활용한다. SP1 은 단독 게시 경로로 충분.

### 4.4 수직 슬라이스 — Daily Eval 이관

- `tasks/po-eval.autopilot-task.ts`: 기존 daily-eval consumer 의 핵심(PO_EVAL usecase 호출 → 결과 텍스트)을 `AutopilotTask` 로 감싼다. 결과 없으면 `skip:true`.
- 플레이북 항목: `{ id:'daily-eval', taskToken: PO_EVAL_AUTOPILOT_TASK, trigger:{kind:'CRON', schedule:'0 19 * * *', timezone:'Asia/Seoul'}, riskTier:'T0_AUTO', enabled: <owner 존재> }`.
- **기존 `src/daily-eval/` 스케줄러는 제거**(이중 발화 방지). 동작은 동등하게 보존(19:00 KST PO_EVAL Slack 게시). 기존 daily-eval 의 owner/스케줄 env 는 Autopilot env 로 승계하거나 매핑(§6).

> **결정 확정 (2026-06-17 리뷰)**: 수직 슬라이스 = **Daily Eval 실이관**. live cron 1개를 플레이북으로 옮기고 구 스케줄러를 제거해 엔진이 실제 프로덕션 cron 을 굴린다는 걸 증명한다. 동작(19:00 KST PO_EVAL Slack 게시) 동등 보존이 수용 기준.

## 5. 데이터 흐름 · 에러 · 효율

- **데이터 흐름**: boot → scheduler(플레이북 읽어 repeatable 등록) → cron 발화 → consumer → orchestrator(멱등 acquire → task.run → idle skip → 티어 전달) → 실패 시 publishCronFailure.
- **에러 처리**: 기존 cron 패턴 그대로. consumer try/catch → owner DM 실패 통지(fire-and-forget) → throw 로 BullMQ 재시도(attempts/backoff). 멱등 가드가 재시도·stalled 중복을 흡수.
- **효율(명시 요구사항)**:
  - *idle skip*: task 가 `skip:true` 반환 시 게시 안 함(빈 다이제스트 방지) — 기존 job 넛지의 "due 0 skip" 일반화.
  - *다이제스트 묶기*: 같은 `digestGroup` 결과를 1건으로(알림 수 감소) — 경로는 SP1, 활용은 SP2+.
  - *멱등*: `autopilot:<id>:<dateKey>` 키로 일 1회 보장.
  - *쿼터 인지*: 엔진 자체는 LLM 미호출. LLM 은 각 task 내부에서만 — 향후 task 들이 같은 슬롯에 묶일 때 호출 묶기/순차화는 SP2+ 에서 다룬다.

## 6. 설정 / env

신규 env (CLAUDE.md §2 #7 — `.env.example` + `.env` + `src/config/app.config.ts` class-validator + README 4곳 동기):

- `AUTOPILOT_OWNER_SLACK_USER_ID` (필수 게이트 — 없으면 Autopilot 전체 비활성).
- (선택) `AUTOPILOT_DAILY_EVAL_SCHEDULE` / `..._TIMEZONE` — 기존 daily-eval env 승계 매핑.

> daily-eval 이관 시 기존 `DAILY_EVAL_*` env 의 마이그레이션 경로를 명시(이관 plan 에서 처리). 기존 값 보존이 원칙.

## 7. 테스트 전략

기존 jest 단위 패턴 준수(스케줄러/컨슈머/유스케이스 spec):

- `playbook.type` / `autopilot.playbook`: 플레이북 선언 유효성(중복 id 없음, cron expr 형식, taskToken 존재).
- `autopilot.orchestrator.spec`: (a) task 정상 → 티어별 전달 호출 검증(mock delivery), (b) `skip:true` → 게시 0회, (c) 멱등 2회차 → skip, (d) task throw → publishCronFailure + rethrow.
- `autopilot-delivery.service.spec`: T0 → SlackNotifier.postMessage, T1 → CreatePreviewUsecase 호출.
- `autopilot.scheduler.spec`: owner 없으면 등록 0, 있으면 CRON 항목만 repeatable 등록(EVENT 항목 skip).
- `po-eval.autopilot-task.spec`: PO_EVAL 결과 → slackText, 결과 없음 → skip.
- 게이트: `pnpm lint:check && pnpm test && pnpm build` 3중 green.

## 8. 후속 서브프로젝트 (SP1 이후)

- **SP2 출근 통합**: 아침신문 + PM 자동 계획(GitHub 할당/어제 미완/inbox 종합) → `digestGroup:'morning'` 한 건. morning-briefing cron 이관.
- **SP3 퇴근 통합**: worklog 자동 초안 + PO_EVAL 회고 → `digestGroup:'evening'`. (daily-eval 은 SP1 에서 이미 이관됨 → 여기서 worklog 합류)
- **SP4 주간 통합 + 이벤트 실행**: CEO 메타 + weekly + impact → `digestGroup:'weekly'`; GitHub webhook → 플레이북 EventTrigger 실행(CODE_REVIEWER auto-on, 이슈→CTO assign→BE plan 체인, T1 게이트).
- **SP5 정리(cleanup)**: DB `agent_run` 사용량 확인 후 미사용 진단 슬래시 정리. crawler/V3 SOTA 보존.

## 9. 결정 기록 / 리뷰 포인트

1. ✅ **수직 슬라이스 범위** (2026-06-17 확정): **Daily Eval 실이관**. (§4.4)
2. ✅ **task vs dispatcher**: 기존 cron 처럼 task 가 usecase 직접 호출. 자연어/슬래시 dispatcher 경유 불필요(엔진은 cron 발화 전용).
3. ✅ **다이제스트 묶기 시점**: SP1 은 경로만, 실제 다중 묶기는 SP2+.
4. 🔶 **env 마이그레이션**: `DAILY_EVAL_*` → `AUTOPILOT_*` 승계 방식 — 구현 plan(writing-plans)에서 단계로 확정.
