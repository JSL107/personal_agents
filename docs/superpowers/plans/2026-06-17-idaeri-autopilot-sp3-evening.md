# 이대리 Autopilot SP3 (퇴근 통합) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD + task별 커밋.

**Goal:** digest 그룹 메커니즘을 구현해 'evening' 그룹(PO_EVAL 회고 + worklog 자동초안)을 **퇴근 1건**으로 발송. worklog 는 오늘 PM plan 을 소스로 자동 생성.

**Architecture:** SP1/SP2 위에서 오케스트레이터를 **그룹 단위 실행**으로 리팩토링 — 스케줄러가 `digestGroup ?? id` 로 묶어 그룹당 repeatable 1개 등록, consumer 가 그룹의 모든 task 를 실행해 slackText 를 합쳐 1회 발송(다중 타깃 fan-out). **그룹 스케줄은 그룹 첫 항목의 기존 env 로 해석 → SP1/2 env 무변경.**

**기준:** `docs/superpowers/specs/2026-06-17-idaeri-autopilot-skeleton-design.md` §8 SP3. SP1/SP2 코드(`src/autopilot/`)가 살아있는 템플릿.

WORKTREE = /Users/juneseok/Desktop/backend/기타/personal_agents/.claude/worktrees/autopilot-sp3 (브랜치 feat/autopilot-sp3, off main #96).

---

## ⚠️ 필수 주의
1. git `git -C "$WORKTREE"`, pnpm `cd "$WORKTREE" && pnpm`. 메인 체크아웃 금지.
2. 오케스트레이터 시그니처 변경(`run(entry,...)` → `runGroup(groupKey, entries[],...)`)은 SP1/SP2 의 reviewed 코드를 건드림 — 기존 orchestrator/consumer/scheduler spec 전부 그룹 모델로 갱신.
3. env **변경 없음** 목표 — 그룹 스케줄은 그룹 첫 항목의 `AUTOPILOT_<firstId>_SCHEDULE`/`_TIMEZONE`(기존)으로 해석. work-reviewer 항목은 trigger.schedule 을 po-eval 과 동일(`0 19 * * *`)로 두고 자체 env 안 만듦. 새 env 없으면 docs:sync 불필요(그래도 끝에 `pnpm docs:check` 로 확인).
4. 멱등 가드는 그룹당 1회(`autopilot:<groupKey>:<today>`), 전달 직전. 다중 타깃 fan-out 유지.
5. 커밋: `git add -f` for docs. 게이트 green(`code-graph` tree-sitter 로컬 flake 무시, autopilot 신규 spec PASS 확인).

---

## Task 1: validatePlaybook — 그룹 스케줄 일관성 검사

**Files:** Modify `src/autopilot/domain/autopilot.playbook.ts` + spec

- [ ] **Step 1: 실패 테스트** — playbook.spec 에: 같은 digestGroup 인데 schedule 다른 두 CRON 항목 → `validatePlaybook` throw(`/그룹.*스케줄|schedule/`).
- [ ] **Step 2: 실패 확인** — `pnpm test -- --testPathPattern autopilot.playbook`.
- [ ] **Step 3: 구현** — `validatePlaybook` 에 추가: CRON 항목을 `digestGroup ?? id` 로 묶어, 각 그룹 내 `trigger.schedule`+`trigger.timezone` 이 전부 동일한지 검사. 다르면 throw(`Autopilot 그룹 '<key>' 항목들의 스케줄이 불일치`).
- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: Commit** (`feat(autopilot): 플레이북 그룹 스케줄 일관성 검증`)

---

## Task 2: 오케스트레이터 그룹 단위 실행

**Files:** Modify `src/autopilot/application/autopilot.orchestrator.ts` + spec

현 `run(entry, owner, target)` → `runGroup(groupKey, entries, owner, target)`. 그룹 내 각 task 실행 → 비-skip slackText 수집 → 합쳐 1회 발송.

- [ ] **Step 1: 실패 테스트** — orchestrator.spec 을 그룹 모델로 갱신/추가:
  - 단일 항목 그룹 정상: `runGroup('daily-eval', [T0_ENTRY], 'U1', 'C1')` → 1 task 실행, 1 발송.
  - 2항목 그룹 합쳐 1건: 두 task(slackText 'A','B') → `runGroup('evening', [e1,e2], ...)` → postMessage 1회(텍스트에 'A'와 'B' 모두 포함, 구분자 포함), acquireOnce 1회.
  - 그룹 내 일부 skip: 한 task skip=true, 다른 task slackText 'B' → 발송 1회(텍스트 'B'만).
  - 전부 skip → 발송 0.
  - 다중 타깃 + 그룹: target 'C1,C2' → 합친 텍스트를 2 타깃에.
  - 미등록 taskId → throw. T1 항목 포함 → throw(SP4).
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `run` 을 `runGroup` 으로 교체:
```ts
  async runGroup(
    groupKey: string,
    entries: PlaybookEntry[],
    ownerSlackUserId: string,
    target: string,
  ): Promise<void> {
    const firedAtKst = getTodayKstDate();
    const parts: string[] = [];
    for (const entry of entries) {
      if (entry.riskTier !== 'T0_AUTO') {
        throw new Error(`Autopilot: T1_PREVIEW 전달은 SP4 — 미지원 (entry=${entry.id})`);
      }
      const task = this.tasks.get(entry.taskId);
      if (!task) {
        throw new Error(`Autopilot: task 미등록 — taskId=${entry.taskId}`);
      }
      const result = await task.run({ ownerSlackUserId, firedAtKst });
      if (!result.skip && result.slackText) {
        parts.push(result.slackText);
      }
    }
    if (parts.length === 0) {
      this.logger.log(`Autopilot[${groupKey}] — 보고 내용 없음, 전달 skip`);
      return;
    }
    const firstRun = await this.cronIdempotency.acquireOnce(
      `autopilot:${groupKey}:${firedAtKst}`,
      CRON_SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(`Autopilot[${groupKey}] — ${firedAtKst} 이미 발송됨, 중복 차단`);
      return;
    }
    const text = parts.join('\n\n────────\n\n');
    const targets = target.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
    for (const resolved of targets) {
      await this.slackNotifier.postMessage({ target: resolved, text });
    }
    this.logger.log(`Autopilot[${groupKey}] — 발송 완료 ${targets.length}건 (${entries.length} task)`);
  }
```
(기존 `run`/`deliver` 제거. import 유지.)
- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: Commit** (`feat(autopilot): 오케스트레이터 그룹 단위 실행(합쳐 1건 발송)`)

---

## Task 3: 스케줄러 + consumer 그룹 모델

**Files:** Modify `src/autopilot/application/autopilot.scheduler.ts`, `src/autopilot/infrastructure/autopilot.consumer.ts` + specs

- [ ] **Step 1: 실패 테스트(scheduler.spec)** — owner 설정 시, 'evening' 그룹(po-eval+work-reviewer)·'morning' 그룹이 **그룹당 1 repeatable** 로 등록(jobName=groupKey). `queue.add` 호출 수 = 그룹 수(=2, daily-eval+work-reviewer 가 한 그룹이면). schedule 은 그룹 첫 항목 env(`AUTOPILOT_DAILY_EVAL_SCHEDULE` 미설정 시 trigger.schedule '0 19 * * *').
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 스케줄러 구현** — 루프를 그룹 단위로:
```ts
    const groups = new Map<string, PlaybookEntry[]>();
    for (const entry of AUTOPILOT_PLAYBOOK) {
      if (entry.trigger.kind !== 'CRON') { continue; }
      const key = entry.digestGroup ?? entry.id;
      const bucket = groups.get(key);
      if (bucket) { bucket.push(entry); } else { groups.set(key, [entry]); }
    }
    for (const [groupKey, entries] of groups) {
      const primary = entries[0];
      if (primary.trigger.kind !== 'CRON') { continue; }
      const envKey = primary.id.toUpperCase().replace(/-/g, '_');
      const schedule = this.readNonEmpty(`AUTOPILOT_${envKey}_SCHEDULE`, primary.trigger.schedule);
      const tz = this.readNonEmpty(`AUTOPILOT_${envKey}_TIMEZONE`, primary.trigger.timezone);
      const payload: AutopilotJobData = { ownerSlackUserId: owner, target };
      await this.queue.add(groupKey, payload, {
        repeat: { pattern: schedule, tz },
        jobId: `autopilot:${groupKey}:${owner}`,
        removeOnComplete: 20, removeOnFail: 20, attempts: 2,
        backoff: { type: 'exponential', delay: 60_000 },
      });
      this.logger.log(`Autopilot 그룹 활성화 — ${groupKey}(${entries.length} task), cron="${schedule}" (${tz})`);
    }
```
(`validatePlaybook(AUTOPILOT_PLAYBOOK)` 호출은 유지.)
- [ ] **Step 4: consumer 구현** — `job.name` = groupKey → 해당 그룹 entries 조회 → `orchestrator.runGroup`:
```ts
    const groupKey = job.name;
    const entries = AUTOPILOT_PLAYBOOK.filter(
      (entry) => (entry.digestGroup ?? entry.id) === groupKey && entry.trigger.kind === 'CRON',
    );
    if (entries.length === 0) {
      this.logger.error(`Autopilot — 미등록 group 무시: ${groupKey}`);
      return;
    }
    try {
      await this.orchestrator.runGroup(groupKey, entries, ownerSlackUserId, target);
    } catch (error) {
      this.logger.error(`Autopilot[${groupKey}] 실패 (owner=${ownerSlackUserId})`, error);
      this.notifyOwnerFailure(ownerSlackUserId, groupKey, error);
      throw error;
    }
```
consumer.spec 갱신(job.name='evening' → runGroup 호출, entries 포함).
- [ ] **Step 5: 통과 확인** (scheduler+consumer spec).
- [ ] **Step 6: Commit** (`feat(autopilot): 스케줄러/consumer 그룹 단위(그룹당 repeatable + runGroup)`)

---

## Task 4: WorkReviewerAutopilotTask (오늘 plan 기반)

**Files:** Create `src/autopilot/infrastructure/tasks/work-reviewer.autopilot-task.ts` + spec

오늘 PM plan 을 workText 로 만들어 `GenerateWorklogUsecase` 호출. **오늘 plan 소스**: weekly-summary 가 plan 을 읽는 경로를 조사해(`src/weekly-summary/infrastructure/weekly-summary.consumer.ts` 상단 + 그것이 쓰는 daily-plan repository/query) **오늘(today) 범위**로 재사용. 오늘 plan 없으면(또는 worklog EMPTY_WORK_INPUT) graceful 안내문 반환(skip=false, slackText 안내).

- [ ] **Step 1: 조사** — weekly-summary 의 plan 소스(repository port + 메서드)와 `formatDailyReview` import 경로 확인. 오늘 plan 1건 조회 방법 파악.
- [ ] **Step 2: 실패 테스트** (`work-reviewer.autopilot-task.spec.ts`) — id='work-reviewer'; 오늘 plan 있음 → GenerateWorklogUsecase 호출 + `{skip:false, slackText}`(formatDailyReview 포함); 오늘 plan 없음 → `{skip:false, slackText: 안내문}`(worklog 호출 안 함 또는 EMPTY 처리); GenerateWorklog 가 EMPTY_WORK_INPUT throw → graceful 안내문. (mock: plan 소스 repository + generateWorklog.)
- [ ] **Step 3: 실패 확인.**
- [ ] **Step 4: 구현** — `po-eval.autopilot-task.ts` 템플릿. 오늘 plan 조회 → 없으면 `{skip:false, slackText:'오늘 작성된 plan 이 없어 회고를 건너뜁니다.'}`. 있으면 workText 구성(weekly-summary 의 `이번 주 일일 plan 요약...` 를 `오늘 plan 요약...` 일간판으로) → `generateWorklog.execute({ workText, slackUserId: ownerSlackUserId, triggerType: TriggerType.DAILY_EVAL_CRON })` (또는 적절한 자동 TriggerType — 기존 enum 에 worklog 자동용 없으면 WEEKLY_SUMMARY_CRON 재사용은 부적절하므로 `MORNING_BRIEFING_CRON`/`DAILY_EVAL_CRON` 중 의미 가까운 것; 신규 enum 값 추가는 범위 밖이니 기존 자동 트리거 중 택1하고 보고에 명기). EMPTY_WORK_INPUT(WorkReviewerException) → graceful. 결과 = `formatDailyReview(outcome.result) + formatModelFooter(outcome)`.
- [ ] **Step 5: 통과 확인.**
- [ ] **Step 6: Commit** (`feat(autopilot): WorkReviewerAutopilotTask — 오늘 plan 기반 자동 worklog`)

---

## Task 5: 플레이북 항목 + 모듈 배선

**Files:** Modify `src/autopilot/domain/autopilot.playbook.ts`, `src/autopilot/domain/autopilot.playbook-defaults.ts`, `src/autopilot/autopilot.module.ts`

- [ ] **Step 1: defaults** — `autopilot.playbook-defaults.ts` 에 evening worklog 스케줄 상수 불필요(po-eval 과 동일 19:00 재사용). work-reviewer 항목은 `DEFAULT_DAILY_EVAL_CRON`/`_TIMEZONE`(기존 상수) 재사용.
- [ ] **Step 2: 플레이북** — `AUTOPILOT_PLAYBOOK`:
  - 기존 `daily-eval` 항목에 `digestGroup: 'evening'` 추가.
  - 신규 항목 추가:
```ts
  {
    id: 'work-reviewer',
    taskId: 'work-reviewer',
    trigger: { kind: 'CRON', schedule: DEFAULT_DAILY_EVAL_CRON, timezone: DEFAULT_DAILY_EVAL_TIMEZONE },
    riskTier: 'T0_AUTO',
    digestGroup: 'evening',
  },
```
  - morning-briefing 은 digestGroup 'morning' 유지(이미 SP2).
  - playbook.spec: 'evening' 그룹에 daily-eval+work-reviewer 2개, validatePlaybook 통과 테스트 추가.
- [ ] **Step 3: 모듈** — `autopilot.module.ts` 에 `WorkReviewerAutopilotTask` provider + `AUTOPILOT_TASKS` 팩토리에 추가(inject 3개), `WorkReviewerModule`(`src/agent/work-reviewer/work-reviewer.module.ts`) + plan 소스 모듈 import.
- [ ] **Step 4: 게이트** — `pnpm lint:check`(0)/`pnpm build`(0)/`pnpm test`(autopilot 신규 PASS; code-graph flake 무시). `pnpm docs:check`(새 env 없으니 통과해야).
- [ ] **Step 5: Commit** (`feat(autopilot): evening 그룹(PO_EVAL+worklog) 플레이북 + 모듈 배선`)

---

## Self-Review
- 그룹 1건 발송: 'evening' 2 task → 1 Slack(구분자) 테스트 green.
- 그룹 멱등 1회, 다중 타깃 fan-out 유지.
- 단일 그룹(morning) 정상.
- 오늘 plan 없음/worklog EMPTY graceful.
- env 무변경 확인(SP1/2 env 그대로). 3중 게이트.

## 미해결/보고
- worklog 자동 TriggerType 선택(기존 enum 재사용) 명기.
- 머지 후: 기존 개별 repeatable 정리 불필요(autopilot-cron 큐는 부팅 cleanup). 단 SP1 의 'daily-eval' jobName repeatable → 이제 'evening' jobName 으로 바뀌므로 부팅 cleanup 이 구 'daily-eval' job 을 지우고 'evening' 재등록(같은 큐라 자동). 확인.
