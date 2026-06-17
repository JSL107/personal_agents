# 이대리 Autopilot SP2 (출근 통합) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD + task별 커밋.

**Goal:** morning-briefing cron(= PM `/today` 자동 발화)을 SP1 Autopilot 플레이북으로 실이관하고, 전달을 다중 타깃(콤마)으로 보강한다.

**Architecture:** SP1 골격(`src/autopilot/`) 위에 `MorningBriefingAutopilotTask` + 'morning' 플레이북 항목 추가. 오케스트레이터 전달을 단일→다중 타깃(콤마 split, 항목당 1회 멱등 가드 후 전 타깃 fan-out)으로 보강. 기존 `src/morning-briefing/`의 cron 부분 삭제(**공유 포트 `slack-notifier.port.ts`는 보존**).

**Tech Stack:** SP1과 동일. 기준: `docs/superpowers/specs/2026-06-17-idaeri-autopilot-skeleton-design.md` §8 SP2.

**SP1 대비 패턴 동일** — `src/autopilot/infrastructure/tasks/po-eval.autopilot-task.ts`(+spec)를 그대로 템플릿으로 삼아라.

---

## ⚠️ 필수 주의 (어기면 깨짐/회귀)

1. **`src/morning-briefing/domain/port/slack-notifier.port.ts` 절대 삭제 금지** — autopilot/daily-eval-이관본/기타가 `SLACK_NOTIFIER_PORT`를 여기서 import. 삭제 대상은 morning-briefing의 **scheduler / consumer / type / module + 그 spec** 뿐. 포트 파일만 남기고 디렉토리 유지.
2. **다중 타깃은 "전달 시점"에 fan-out** — 스케줄러가 타깃별 repeatable 여러 개 등록(구 morning-briefing 방식) 금지. 항목당 repeatable 1개, 오케스트레이터 `deliver`가 `target`을 콤마 split 해 각 타깃에 postMessage. 멱등 가드는 항목당 1회(루프 밖)에서 acquire 후 전 타깃 발송 — 구 morning-briefing은 per-queue 키라 2번째 타깃이 skip되던 잠재버그였음(개선).
3. **env**: `.env.example`는 `.env*` 권한 보호 → Edit 툴 불가, **Bash 로 편집**. `.env`는 건드리지 말고 최종 보고에 사용자 안내. **env 변경 후 `pnpm docs:sync` 필수**(env-catalog.md 드리프트로 CI docs:check 실패함 — SP1에서 겪음).
4. **커밋**: `docs/`는 gitignore → docs 커밋은 `git add -f`. worktree라 `git add -A` 시 node_modules 심링크 주의(이 worktree .gitignore엔 `node_modules` 슬래시없는 패턴 있어 안전하나 명시 경로 권장). git은 `git -C "$WORKTREE"`.

WORKTREE = /Users/juneseok/Desktop/backend/기타/personal_agents/.claude/worktrees/autopilot-sp2 (브랜치 feat/autopilot-sp2, off origin/main #95).

---

## Task 1: 오케스트레이터 다중 타깃 전달 보강

**Files:** Modify `src/autopilot/application/autopilot.orchestrator.ts` + `autopilot.orchestrator.spec.ts`

현 `deliver`는 단일 `target`에 1회 postMessage. 콤마 split → 항목당 1회 멱등 가드 → 각 타깃 발송으로 변경.

- [ ] **Step 1: 실패 테스트** — orchestrator.spec 에 추가:
```ts
it('T0 다중 타깃(콤마) → 각 타깃에 발송, 멱등은 1회', async () => {
  const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
  const postMessage = jest.fn().mockResolvedValue(undefined);
  const acquireOnce = jest.fn().mockResolvedValue(true);
  const o = new AutopilotOrchestrator([task] as never, { postMessage } as never, { acquireOnce } as never);
  await o.run(T0_ENTRY, 'U1', 'C1, C2 ,C3');
  expect(acquireOnce).toHaveBeenCalledTimes(1);
  expect(postMessage).toHaveBeenCalledTimes(3);
  expect(postMessage).toHaveBeenCalledWith({ target: 'C2', text: '본문' });
});
```
- [ ] **Step 2: 실패 확인** — `pnpm test -- --testPathPattern autopilot.orchestrator` → FAIL(2회 발송 기대 불일치 또는 1 타깃만).
- [ ] **Step 3: 구현** — `deliver` 의 단일 postMessage를 다음으로:
```ts
    const firstRun = await this.cronIdempotency.acquireOnce(
      `autopilot:${entry.id}:${firedAtKst}`,
      CRON_SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(`Autopilot[${entry.id}] — ${firedAtKst} 이미 발송됨, 중복 차단`);
      return;
    }
    const targets = target
      .split(',')
      .map((entryTarget) => entryTarget.trim())
      .filter((entryTarget) => entryTarget.length > 0);
    for (const resolved of targets) {
      await this.slackNotifier.postMessage({ target: resolved, text: result.slackText });
    }
    this.logger.log(`Autopilot[${entry.id}] — 발송 완료 ${targets.length}건`);
```
(기존 단일 postMessage/로그 라인 대체. `result.slackText` 빈값 가드는 위에 유지.)
- [ ] **Step 4: 통과 확인** — orchestrator spec 전부 PASS(기존 단일 타깃 테스트는 split 결과 1건이라 그대로 통과).
- [ ] **Step 5: Commit** — `git -C "$WORKTREE" add src/autopilot/application/autopilot.orchestrator.ts src/autopilot/application/autopilot.orchestrator.spec.ts && git -C "$WORKTREE" commit` (msg: `feat(autopilot): 전달을 다중 타깃(콤마 fan-out)으로 보강`, Co-Authored-By 트레일러).

---

## Task 2: 플레이북 defaults 에 morning 추가

**Files:** Modify `src/autopilot/domain/autopilot.playbook-defaults.ts`, `src/autopilot/domain/autopilot.playbook.ts` + `autopilot.playbook.spec.ts`

- [ ] **Step 1: defaults 추가** — `autopilot.playbook-defaults.ts` 에:
```ts
// Morning Briefing 기본 스케줄 — 기존 src/morning-briefing/domain/morning-briefing.type.ts 승계.
export const DEFAULT_MORNING_BRIEFING_CRON = '30 8 * * *';
export const DEFAULT_MORNING_BRIEFING_TIMEZONE = 'Asia/Seoul';
```
- [ ] **Step 2: 플레이북 항목 추가** — `autopilot.playbook.ts` 의 `AUTOPILOT_PLAYBOOK` 배열에 (daily-eval 항목 뒤) 추가, import 도 갱신:
```ts
  {
    id: 'morning-briefing',
    taskId: 'morning-briefing',
    trigger: { kind: 'CRON', schedule: DEFAULT_MORNING_BRIEFING_CRON, timezone: DEFAULT_MORNING_BRIEFING_TIMEZONE },
    riskTier: 'T0_AUTO',
    digestGroup: 'morning',
  },
```
- [ ] **Step 3: 테스트 추가** — playbook.spec 에:
```ts
it('SP2 플레이북은 morning-briefing 항목을 포함한다', () => {
  const morning = AUTOPILOT_PLAYBOOK.find((entry) => entry.id === 'morning-briefing');
  expect(morning?.taskId).toBe('morning-briefing');
  expect(morning?.digestGroup).toBe('morning');
});
```
- [ ] **Step 4: 통과 확인** — `pnpm test -- --testPathPattern autopilot.playbook` PASS.
- [ ] **Step 5: Commit** — (msg: `feat(autopilot): morning-briefing 플레이북 항목 + defaults`)

---

## Task 3: MorningBriefingAutopilotTask (PM 자동 계획 이관)

**Files:** Create `src/autopilot/infrastructure/tasks/morning-briefing.autopilot-task.ts` + `.spec.ts`

`po-eval.autopilot-task.ts` 를 템플릿으로. 기존 `src/morning-briefing/infrastructure/morning-briefing.consumer.ts` 의 핵심(GenerateDailyPlanUsecase + EMPTY_TASKS_INPUT graceful + formatDailyPlan + formatModelFooter)을 task 로.

- [ ] **Step 1: 실패 테스트** (`morning-briefing.autopilot-task.spec.ts`) — id='morning-briefing'; 성공 시 `{skip:false, slackText}` (formatDailyPlan 결과 포함); `EMPTY_TASKS_INPUT`(PmAgentException) 시 `{skip:false, slackText: 안내문}`; 그 외 에러 throw. (po-eval task spec 의 PmAgentException 버전 — 생성자는 기존 morning-briefing.consumer 의 PmAgentException 사용처 참조해 정합.)
- [ ] **Step 2: 실패 확인** — 모듈 없음.
- [ ] **Step 3: 구현**:
```ts
import { Injectable } from '@nestjs/common';
import { GenerateDailyPlanUsecase } from '../../../agent/pm/application/generate-daily-plan.usecase';
import { PmAgentException } from '../../../agent/pm/domain/pm-agent.exception';
import { PmAgentErrorCode } from '../../../agent/pm/domain/pm-agent-error-code.enum';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { formatDailyPlan } from '../../../slack/format/daily-plan.formatter';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import { AutopilotTask, AutopilotTaskContext, AutopilotTaskResult } from '../../domain/autopilot-task.port';

@Injectable()
export class MorningBriefingAutopilotTask implements AutopilotTask {
  readonly id = 'morning-briefing';
  constructor(private readonly generateDailyPlan: GenerateDailyPlanUsecase) {}
  async run({ ownerSlackUserId }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    try {
      const outcome = await this.generateDailyPlan.execute({
        tasksText: '',
        slackUserId: ownerSlackUserId,
        triggerType: TriggerType.MORNING_BRIEFING_CRON,
      });
      const text = formatDailyPlan(outcome.result.plan) + formatModelFooter(outcome);
      return { skip: false, slackText: text };
    } catch (error) {
      if (error instanceof PmAgentException && error.pmAgentErrorCode === PmAgentErrorCode.EMPTY_TASKS_INPUT) {
        return { skip: false, slackText: '오늘 자동 수집된 할 일이 없습니다 (GitHub/Notion/Slack 모두 비어있음). 필요하면 `/today <할 일>` 로 직접 입력해주세요.' };
      }
      throw error;
    }
  }
}
```
(`outcome.result.plan` 접근/포맷터 import 경로는 기존 morning-briefing.consumer.ts:61-68 과 동일.)
- [ ] **Step 4: 통과 확인** — task spec PASS.
- [ ] **Step 5: Commit** — (msg: `feat(autopilot): MorningBriefingAutopilotTask — PM 자동계획 이관`)

---

## Task 4: 모듈 배선 + morning-briefing cron 제거 + env + docs

**Files:** Modify `src/autopilot/autopilot.module.ts`, `src/app.module.ts`, `src/config/app.config.ts`, `.env.example`, `README.md`; Delete morning-briefing cron 부분; docs:sync.

- [ ] **Step 1: AUTOPILOT_TASKS 팩토리에 morning task 추가** — `autopilot.module.ts`:
```ts
    {
      provide: AUTOPILOT_TASKS,
      useFactory: (poEval: PoEvalAutopilotTask, morning: MorningBriefingAutopilotTask) => [poEval, morning],
      inject: [PoEvalAutopilotTask, MorningBriefingAutopilotTask],
    },
```
+ providers 에 `MorningBriefingAutopilotTask` 추가, import. autopilot.module 이 `PmModule`(GenerateDailyPlanUsecase 제공 모듈) 을 import 해야 함 — 기존 morning-briefing.module 이 import 하던 PM 모듈을 그대로 가져와라(`grep "import" src/morning-briefing/morning-briefing.module.ts` 로 확인).
- [ ] **Step 2: morning-briefing cron 삭제(포트 보존)** —
```bash
git -C "$WORKTREE" rm src/morning-briefing/application/morning-briefing.scheduler.ts \
  src/morning-briefing/infrastructure/morning-briefing.consumer.ts \
  src/morning-briefing/infrastructure/morning-briefing.consumer.spec.ts \
  src/morning-briefing/domain/morning-briefing.type.ts \
  src/morning-briefing/morning-briefing.module.ts
```
스케줄러 spec(있으면)도 rm. **`src/morning-briefing/domain/port/slack-notifier.port.ts` 는 남긴다.**
- [ ] **Step 3: app.module 에서 MorningBriefingModule 제거** — import 라인 + imports 배열 항목 삭제 (`grep -n MorningBriefingModule src/app.module.ts`).
- [ ] **Step 4: app.config env 교체** — `MORNING_BRIEFING_*` 4개(`_OWNER_SLACK_USER_ID`, `_DELIVERY_TARGETS`, `_CRON`, `_TIMEZONE`) 제거, `AUTOPILOT_MORNING_BRIEFING_SCHEDULE?`/`AUTOPILOT_MORNING_BRIEFING_TIMEZONE?` 추가(@IsOptional @IsString). `AUTOPILOT_TARGET` 주석에 "콤마 다중 타깃 지원" 명기.
- [ ] **Step 5: 잔여 참조 정리** — `grep -rn "MORNING_BRIEFING\|morning-briefing/\(application\|infrastructure\|domain/morning\|morning-briefing.module\)" src --include="*.ts" | grep -v "domain/port"` 으로 깨진 import 0 확인. (포트 import 는 OK)
- [ ] **Step 6: .env.example (Bash 편집)** — `MORNING_BRIEFING_*` 라인 제거(있으면), `AUTOPILOT_MORNING_BRIEFING_SCHEDULE=30 8 * * *` / `AUTOPILOT_MORNING_BRIEFING_TIMEZONE=Asia/Seoul` 추가. README env/cron 표의 morning-briefing 행을 AUTOPILOT 으로 갱신(Edit 툴 가능).
- [ ] **Step 7: docs:sync** — `cd "$WORKTREE" && pnpm docs:sync` → `docs/env-catalog.md` 재생성. `git -C "$WORKTREE" add -f docs/env-catalog.md` (gitignore).
- [ ] **Step 8: 3중 게이트** — `pnpm lint:check`(0 errors; 안 되면 `pnpm lint` autofix) / `pnpm build`(exit 0) / `pnpm test`(autopilot + 전체; code-graph tree-sitter는 로컬 flake라 무시, autopilot/morning 신규 spec PASS 확인). 안 되면 디버깅(근본원인).
- [ ] **Step 9: Commit** — `git -C "$WORKTREE" add ...명시...` (또는 `-A`, node_modules 안전) + `git add -f docs/env-catalog.md` (msg: `feat(autopilot): morning-briefing cron 이관 완료 — 모듈 배선 + env(MORNING_BRIEFING→AUTOPILOT) + 포트 보존`)

---

## Self-Review 체크 (구현 후)
- 공유 포트 `slack-notifier.port.ts` 보존 확인(autopilot import 안 깨짐).
- 다중 타깃: 멱등 1회 + N 발송 테스트 green.
- morning-briefing 잔여 참조 0(포트 제외).
- env-catalog.md 재생성 커밋됨(docs:check 통과).
- 3중 게이트(lint 0 / build 0 / 신규 spec pass).

## 미해결 / 사용자 안내
- `.env`: `MORNING_BRIEFING_OWNER_SLACK_USER_ID`/`_DELIVERY_TARGETS`/`_CRON`/`_TIMEZONE` → Autopilot 로 흡수. owner 는 `AUTOPILOT_OWNER_SLACK_USER_ID`(이미 SP1), 다중 발송은 `AUTOPILOT_TARGET`(콤마), 스케줄은 `AUTOPILOT_MORNING_BRIEFING_SCHEDULE/_TIMEZONE`. 값 이전 안내.
- 배포 시 구 `morning-briefing` 큐 Redis repeatable 정리(1회): `redis-cli -p 6381 --scan --pattern 'bull:morning-briefing:*' | xargs -r redis-cli -p 6381 del`.
