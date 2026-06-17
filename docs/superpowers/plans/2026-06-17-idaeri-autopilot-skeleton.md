# 이대리 Autopilot SP1 (골격) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선언적 워크데이 플레이북 + 얇은 오케스트레이터(`src/autopilot/`)를 만들고, 기존 Daily Eval cron 을 그 위로 실이관해 엔진이 실제 프로덕션 cron 을 굴린다는 걸 증명한다.

**Architecture:** 단일 BullMQ 큐(`autopilot-cron`)에 플레이북의 CRON 항목을 named repeatable 로 등록(스케줄러) → 단일 consumer 가 `job.name`(=entry.id)으로 라우팅 → 오케스트레이터가 해당 `AutopilotTask` 실행 후 리스크 티어로 전달(T0=Slack 자동 게시). 기존 cron 인프라(CronIdempotency·NotificationPublisher·LONG_RUNNING_WORKER_OPTIONS·SlackNotifierPort) 전면 재사용.

**Tech Stack:** NestJS 10, BullMQ, `@nestjs/bullmq`, Prisma(무관), jest. 설계 출처: `docs/superpowers/specs/2026-06-17-idaeri-autopilot-skeleton-design.md`.

**Spec 대비 정제(plan 에서 확정):**
- `PlaybookEntry.taskToken: symbol` → **`taskId: string`** (task.id 키 레지스트리). 심볼 남발 회피.
- `PlaybookEntry.enabled` 제거 — SP1 은 전역 `AUTOPILOT_OWNER_SLACK_USER_ID` 게이트로 on/off (per-entry enable 은 후속).
- `autopilot-delivery.service.ts` 분리 보류 — SP1 은 T0 단일이라 오케스트레이터 private `deliver` 로. (digest 그룹 다중 전달 필요한 SP2 에서 분리)
- `AutopilotTaskResult.previewKind/payload` 제거 — SP1 에 T1 항목 0개. T1 전달은 오케스트레이터가 명시 throw(SP4 에서 구현). 결과는 `{ skip, slackText? }`.
- `firedAt: PlainDate` → **`firedAtKst: string`**(`getTodayKstDate()`). 오케스트레이터가 1회 계산해 멱등 키 + task 표시에 공유 → "today 이중 계산" 차단.

---

## File Structure

**신규** (`src/autopilot/`):
- `domain/autopilot.type.ts` — 큐명 상수 + `AutopilotJobData`.
- `domain/playbook.type.ts` — `RiskTier`/`CronTrigger`/`EventTrigger`/`PlaybookEntry`.
- `domain/autopilot-task.port.ts` — `AUTOPILOT_TASKS` 토큰 + `AutopilotTaskContext`/`AutopilotTaskResult`/`AutopilotTask`.
- `domain/autopilot.playbook.ts` — `AUTOPILOT_PLAYBOOK`(선언 데이터) + `validatePlaybook()`.
- `infrastructure/tasks/po-eval.autopilot-task.ts` — Daily Eval(PO_EVAL) 이관 task.
- `application/autopilot.orchestrator.ts` — 실행/멱등/idle-skip/티어 전달.
- `application/autopilot.scheduler.ts` — 부팅 시 CRON 항목 repeatable 등록.
- `infrastructure/autopilot.consumer.ts` — `@Processor` 라우팅 + 실패 통지.
- `autopilot.module.ts` — 모듈 + `AUTOPILOT_TASKS` 팩토리.
- spec 파일들(각 위 파일 옆).

**수정/삭제:**
- `src/app.module.ts` — `AutopilotModule` 추가, `DailyEvalModule` 제거.
- `src/config/app.config.ts` — `AUTOPILOT_*` env 추가, `DAILY_EVAL_*` 4개 제거.
- `.env.example` + `README` — env 표 갱신. (`.env` 는 권한 보호로 에이전트 편집 불가 → 사용자가 수동 미러: `DAILY_EVAL_OWNER_SLACK_USER_ID` → `AUTOPILOT_OWNER_SLACK_USER_ID` 등.)
- **삭제**: `src/daily-eval/` 전체(`daily-eval.module.ts`, `application/daily-eval.scheduler.ts`, `domain/daily-eval.type.ts`, `infrastructure/daily-eval.consumer.ts`, `infrastructure/daily-eval.consumer.spec.ts`).

---

## Task 1: Autopilot 도메인 타입 (큐/플레이북/task 포트)

**Files:**
- Create: `src/autopilot/domain/autopilot.type.ts`
- Create: `src/autopilot/domain/playbook.type.ts`
- Create: `src/autopilot/domain/autopilot-task.port.ts`

순수 타입/상수라 별도 테스트 없음(검증 함수는 Task 2 에서 테스트).

- [ ] **Step 1: 큐 상수 + job data**

`src/autopilot/domain/autopilot.type.ts`:
```ts
export const AUTOPILOT_CRON_QUEUE = 'autopilot-cron';

export interface AutopilotJobData {
  ownerSlackUserId: string;
  target: string;
}
```

- [ ] **Step 2: 플레이북 스키마**

`src/autopilot/domain/playbook.type.ts`:
```ts
export type RiskTier = 'T0_AUTO' | 'T1_PREVIEW';

// SP1: CRON 실행만. EVENT 는 스키마만 정의(실행은 SP4).
export interface CronTrigger {
  kind: 'CRON';
  schedule: string; // cron pattern (env override 가능)
  timezone: string; // 예: 'Asia/Seoul'
}

export interface EventTrigger {
  kind: 'EVENT';
  event: string; // 예: 'github.pull_request.opened' — SP4 라우팅
}

export type PlaybookTrigger = CronTrigger | EventTrigger;

export interface PlaybookEntry {
  id: string; // 안정 식별자(job name·멱등 키·로그). 예: 'daily-eval'
  taskId: string; // 실행할 AutopilotTask.id
  trigger: PlaybookTrigger;
  riskTier: RiskTier;
  digestGroup?: string; // SP2+ 다중 전달 묶기용. SP1 미사용.
}
```

- [ ] **Step 3: AutopilotTask 포트**

`src/autopilot/domain/autopilot-task.port.ts`:
```ts
export const AUTOPILOT_TASKS = Symbol('AUTOPILOT_TASKS');

export interface AutopilotTaskContext {
  ownerSlackUserId: string;
  firedAtKst: string; // 오케스트레이터가 getTodayKstDate() 로 1회 계산해 주입.
}

export interface AutopilotTaskResult {
  // 게시할 내용 없으면 skip=true → 오케스트레이터가 전달 안 함(빈 알림 방지).
  skip: boolean;
  slackText?: string; // T0 전달 본문.
}

export interface AutopilotTask {
  readonly id: string;
  run(context: AutopilotTaskContext): Promise<AutopilotTaskResult>;
}
```

- [ ] **Step 4: 타입 컴파일 확인**

Run: `pnpm build 2>&1 | tail -3`
Expected: 에러 없이 종료(신규 파일 타입 OK).

- [ ] **Step 5: Commit**

```bash
git add src/autopilot/domain/autopilot.type.ts src/autopilot/domain/playbook.type.ts src/autopilot/domain/autopilot-task.port.ts
git commit -m "feat(autopilot): 도메인 타입 — 큐/플레이북/task 포트"
```

---

## Task 2: 플레이북 인스턴스 + 검증

**Files:**
- Create: `src/autopilot/domain/autopilot.playbook.ts`
- Test: `src/autopilot/domain/autopilot.playbook.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/autopilot/domain/autopilot.playbook.spec.ts`:
```ts
import { AUTOPILOT_PLAYBOOK, validatePlaybook } from './autopilot.playbook';
import { PlaybookEntry } from './playbook.type';

describe('AUTOPILOT_PLAYBOOK', () => {
  it('SP1 플레이북은 daily-eval CRON 항목을 포함한다', () => {
    const dailyEval = AUTOPILOT_PLAYBOOK.find((e) => e.id === 'daily-eval');
    expect(dailyEval).toBeDefined();
    expect(dailyEval?.trigger.kind).toBe('CRON');
    expect(dailyEval?.taskId).toBe('daily-eval');
    expect(dailyEval?.riskTier).toBe('T0_AUTO');
  });

  it('validatePlaybook 은 정상 플레이북을 통과시킨다', () => {
    expect(() => validatePlaybook(AUTOPILOT_PLAYBOOK)).not.toThrow();
  });

  it('validatePlaybook 은 중복 id 를 거부한다', () => {
    const dup: PlaybookEntry[] = [
      { id: 'x', taskId: 'x', trigger: { kind: 'CRON', schedule: '0 9 * * *', timezone: 'Asia/Seoul' }, riskTier: 'T0_AUTO' },
      { id: 'x', taskId: 'x', trigger: { kind: 'CRON', schedule: '0 9 * * *', timezone: 'Asia/Seoul' }, riskTier: 'T0_AUTO' },
    ];
    expect(() => validatePlaybook(dup)).toThrow(/중복/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- --testPathPattern autopilot.playbook 2>&1 | tail -15`
Expected: FAIL — `Cannot find module './autopilot.playbook'`.

- [ ] **Step 3: 구현**

`src/autopilot/domain/autopilot.playbook.ts`:
```ts
import { DEFAULT_DAILY_EVAL_CRON, DEFAULT_DAILY_EVAL_TIMEZONE } from './autopilot.playbook-defaults';
import { PlaybookEntry } from './playbook.type';

// 자율 워크데이 플레이북 — "무엇이 언제 발화하는지" 단일 선언.
// SP1: Daily Eval 1건만(기존 cron 이관). SP2~4 가 출근/퇴근/주간·이벤트 항목을 여기에 추가.
export const AUTOPILOT_PLAYBOOK: PlaybookEntry[] = [
  {
    id: 'daily-eval',
    taskId: 'daily-eval',
    trigger: { kind: 'CRON', schedule: DEFAULT_DAILY_EVAL_CRON, timezone: DEFAULT_DAILY_EVAL_TIMEZONE },
    riskTier: 'T0_AUTO',
  },
];

// 선언 무결성 — 부팅/테스트 시 빠른 실패. (id/taskId 중복 차단)
export const validatePlaybook = (entries: PlaybookEntry[]): void => {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error(`Autopilot 플레이북 중복 id — ${entry.id}`);
    }
    ids.add(entry.id);
  }
};
```

`src/autopilot/domain/autopilot.playbook-defaults.ts`:
```ts
// Daily Eval 기본 스케줄 — 기존 src/daily-eval/domain/daily-eval.type.ts 에서 승계.
export const DEFAULT_DAILY_EVAL_CRON = '0 19 * * *';
export const DEFAULT_DAILY_EVAL_TIMEZONE = 'Asia/Seoul';
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- --testPathPattern autopilot.playbook 2>&1 | tail -8`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/autopilot/domain/autopilot.playbook.ts src/autopilot/domain/autopilot.playbook-defaults.ts src/autopilot/domain/autopilot.playbook.spec.ts
git commit -m "feat(autopilot): 워크데이 플레이북 선언 + 무결성 검증"
```

---

## Task 3: PoEvalAutopilotTask (Daily Eval 이관)

**Files:**
- Create: `src/autopilot/infrastructure/tasks/po-eval.autopilot-task.ts`
- Test: `src/autopilot/infrastructure/tasks/po-eval.autopilot-task.spec.ts`

기존 `daily-eval.consumer.ts` 의 핵심(PO_EVAL 실행 → 텍스트, NO_SUB_AGENT_RUNS graceful)을 task 로 옮긴다. 전달(Slack 발송)은 오케스트레이터가 하므로 task 는 텍스트만 반환.

- [ ] **Step 1: 실패 테스트 작성**

`src/autopilot/infrastructure/tasks/po-eval.autopilot-task.spec.ts`:
```ts
import { PoEvalException } from '../../../agent/po-eval/domain/po-eval.exception';
import { PoEvalErrorCode } from '../../../agent/po-eval/domain/po-eval-error-code.enum';
import { PoEvalAutopilotTask } from './po-eval.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };

describe('PoEvalAutopilotTask', () => {
  it('id 는 daily-eval', () => {
    const task = new PoEvalAutopilotTask({} as never);
    expect(task.id).toBe('daily-eval');
  });

  it('PO_EVAL 성공 시 slackText 반환(skip=false)', async () => {
    const execute = jest.fn().mockResolvedValue({
      result: { summary: '회고요약' },
      modelUsed: 'claude-cli',
      provider: 'CLAUDE',
    });
    const task = new PoEvalAutopilotTask({ execute } as never);

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.slackText).toContain('Daily Eval');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1', range: 'TODAY' }),
    );
  });

  it('NO_SUB_AGENT_RUNS 면 skip 안내문(skip=false)', async () => {
    const execute = jest.fn().mockRejectedValue(
      new PoEvalException({
        code: PoEvalErrorCode.NO_SUB_AGENT_RUNS,
        message: '없음',
        status: 502,
      } as never),
    );
    const task = new PoEvalAutopilotTask({ execute } as never);

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.slackText).toContain('skip');
  });

  it('그 외 에러는 throw (consumer 가 실패 통지)', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('boom'));
    const task = new PoEvalAutopilotTask({ execute } as never);
    await expect(task.run(CTX)).rejects.toThrow('boom');
  });
});
```

> 참고: `PoEvalException` 생성자 시그니처는 기존 `daily-eval.consumer.spec.ts` 의 사용을 그대로 따른다. 위 mock 형태가 실제와 다르면 기존 spec 의 PoEvalException 생성 방식에 맞춰 조정.

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- --testPathPattern po-eval.autopilot-task 2>&1 | tail -12`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/autopilot/infrastructure/tasks/po-eval.autopilot-task.ts`:
```ts
import { Injectable } from '@nestjs/common';

import { GeneratePoEvaluationUsecase } from '../../../agent/po-eval/application/generate-po-evaluation.usecase';
import { PoEvalException } from '../../../agent/po-eval/domain/po-eval.exception';
import { PoEvalErrorCode } from '../../../agent/po-eval/domain/po-eval-error-code.enum';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { formatModelFooter } from '../../../slack/format/model-footer.formatter';
import { formatEvaluationOutput } from '../../../slack/format/po-evaluation.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// Daily Eval 이관 — 매일 19:00 KST PO_EVAL(range=TODAY) 자동 회고.
// 기존 src/daily-eval/infrastructure/daily-eval.consumer.ts 의 핵심 로직을 task 로 옮김.
// 발송은 오케스트레이터(T0)가 담당 — 여기선 텍스트만 만든다.
@Injectable()
export class PoEvalAutopilotTask implements AutopilotTask {
  readonly id = 'daily-eval';

  constructor(
    private readonly generatePoEvaluation: GeneratePoEvaluationUsecase,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    try {
      const outcome = await this.generatePoEvaluation.execute({
        slackUserId: ownerSlackUserId,
        range: 'TODAY',
        triggerType: TriggerType.DAILY_EVAL_CRON,
      });
      const intro = `🌅 *Daily Eval — ${firedAtKst} (19:00 KST 자동 회고)*\n\n`;
      const text =
        intro +
        formatEvaluationOutput(outcome.result) +
        formatModelFooter(outcome);
      return { skip: false, slackText: text };
    } catch (error) {
      if (
        error instanceof PoEvalException &&
        error.poEvalErrorCode === PoEvalErrorCode.NO_SUB_AGENT_RUNS
      ) {
        return {
          skip: false,
          slackText: `🌙 *Daily Eval — ${firedAtKst} skip*\n_오늘 sub-agent (Work Reviewer / PO Shadow / Impact Reporter) run 부재로 회고 대상 없음. 내일 19:00 KST 에 다시 시도합니다._`,
        };
      }
      throw error;
    }
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- --testPathPattern po-eval.autopilot-task 2>&1 | tail -8`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/autopilot/infrastructure/tasks/po-eval.autopilot-task.ts src/autopilot/infrastructure/tasks/po-eval.autopilot-task.spec.ts
git commit -m "feat(autopilot): PoEvalAutopilotTask — Daily Eval 핵심 이관"
```

---

## Task 4: 오케스트레이터 (실행/멱등/idle-skip/T0 전달)

**Files:**
- Create: `src/autopilot/application/autopilot.orchestrator.ts`
- Test: `src/autopilot/application/autopilot.orchestrator.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/autopilot/application/autopilot.orchestrator.spec.ts`:
```ts
import { PlaybookEntry } from '../domain/playbook.type';
import { AutopilotOrchestrator } from './autopilot.orchestrator';

const T0_ENTRY: PlaybookEntry = {
  id: 'daily-eval',
  taskId: 'daily-eval',
  trigger: { kind: 'CRON', schedule: '0 19 * * *', timezone: 'Asia/Seoul' },
  riskTier: 'T0_AUTO',
};

const makeTask = (id: string, result: unknown) => ({
  id,
  run: jest.fn().mockResolvedValue(result),
});

describe('AutopilotOrchestrator', () => {
  it('T0 정상 → 멱등 획득 후 Slack 게시', async () => {
    const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const postMessage = jest.fn().mockResolvedValue(undefined);
    const acquireOnce = jest.fn().mockResolvedValue(true);
    const o = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce } as never,
    );

    await o.run(T0_ENTRY, 'U1', 'C1');

    expect(task.run).toHaveBeenCalledWith(
      expect.objectContaining({ ownerSlackUserId: 'U1' }),
    );
    expect(postMessage).toHaveBeenCalledWith({ target: 'C1', text: '본문' });
  });

  it('skip=true → 게시 안 함', async () => {
    const task = makeTask('daily-eval', { skip: true });
    const postMessage = jest.fn();
    const o = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce: jest.fn().mockResolvedValue(true) } as never,
    );
    await o.run(T0_ENTRY, 'U1', 'C1');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('멱등 2회차(false) → 게시 skip', async () => {
    const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const postMessage = jest.fn();
    const o = new AutopilotOrchestrator(
      [task] as never,
      { postMessage } as never,
      { acquireOnce: jest.fn().mockResolvedValue(false) } as never,
    );
    await o.run(T0_ENTRY, 'U1', 'C1');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('미등록 taskId → throw', async () => {
    const o = new AutopilotOrchestrator(
      [] as never,
      { postMessage: jest.fn() } as never,
      { acquireOnce: jest.fn().mockResolvedValue(true) } as never,
    );
    await expect(o.run(T0_ENTRY, 'U1', 'C1')).rejects.toThrow(/task 미등록/);
  });

  it('T1_PREVIEW → 미지원 throw (SP4)', async () => {
    const task = makeTask('daily-eval', { skip: false, slackText: '본문' });
    const o = new AutopilotOrchestrator(
      [task] as never,
      { postMessage: jest.fn() } as never,
      { acquireOnce: jest.fn().mockResolvedValue(true) } as never,
    );
    await expect(
      o.run({ ...T0_ENTRY, riskTier: 'T1_PREVIEW' }, 'U1', 'C1'),
    ).rejects.toThrow(/T1_PREVIEW/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- --testPathPattern autopilot.orchestrator 2>&1 | tail -12`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/autopilot/application/autopilot.orchestrator.ts`:
```ts
import { Inject, Injectable, Logger } from '@nestjs/common';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import { CRON_SENT_GUARD_TTL_SECONDS } from '../../common/queue/worker-options.constant';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import {
  AUTOPILOT_TASKS,
  AutopilotTask,
  AutopilotTaskResult,
} from '../domain/autopilot-task.port';
import { PlaybookEntry } from '../domain/playbook.type';

// 플레이북 항목 1건을 실행 → idle skip → 리스크 티어 전달.
// today(KST)를 1회 계산해 멱등 키 + task 표시에 공유한다(이중 계산 방지).
// 멱등 가드는 "전달 직전"에 둔다 — task 실행이 실패하면 BullMQ 재시도(attempts)가 살아있도록.
@Injectable()
export class AutopilotOrchestrator {
  private readonly logger = new Logger(AutopilotOrchestrator.name);
  private readonly tasks: Map<string, AutopilotTask>;

  constructor(
    @Inject(AUTOPILOT_TASKS) tasks: AutopilotTask[],
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
  ) {
    this.tasks = new Map(tasks.map((task) => [task.id, task]));
  }

  async run(
    entry: PlaybookEntry,
    ownerSlackUserId: string,
    target: string,
  ): Promise<void> {
    const firedAtKst = getTodayKstDate();
    const task = this.tasks.get(entry.taskId);
    if (!task) {
      throw new Error(`Autopilot: task 미등록 — taskId=${entry.taskId}`);
    }
    const result = await task.run({ ownerSlackUserId, firedAtKst });
    if (result.skip) {
      this.logger.log(`Autopilot[${entry.id}] — 보고 내용 없음, 전달 skip`);
      return;
    }
    await this.deliver(entry, target, firedAtKst, result);
  }

  private async deliver(
    entry: PlaybookEntry,
    target: string,
    firedAtKst: string,
    result: AutopilotTaskResult,
  ): Promise<void> {
    if (entry.riskTier !== 'T0_AUTO') {
      throw new Error(
        `Autopilot: T1_PREVIEW 전달은 SP4 에서 구현 — 현재 미지원 (entry=${entry.id})`,
      );
    }
    if (!result.slackText) {
      return;
    }
    const firstRun = await this.cronIdempotency.acquireOnce(
      `autopilot:${entry.id}:${firedAtKst}`,
      CRON_SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(
        `Autopilot[${entry.id}] — ${firedAtKst} 이미 발송됨, 중복 차단`,
      );
      return;
    }
    await this.slackNotifier.postMessage({ target, text: result.slackText });
    this.logger.log(`Autopilot[${entry.id}] — 발송 완료 target=${target}`);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- --testPathPattern autopilot.orchestrator 2>&1 | tail -8`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/autopilot/application/autopilot.orchestrator.ts src/autopilot/application/autopilot.orchestrator.spec.ts
git commit -m "feat(autopilot): 오케스트레이터 — 실행/멱등/idle-skip/T0 전달"
```

---

## Task 5: 스케줄러 (CRON 항목 repeatable 등록, owner 게이트)

**Files:**
- Create: `src/autopilot/application/autopilot.scheduler.ts`
- Test: `src/autopilot/application/autopilot.scheduler.spec.ts`

`daily-eval.scheduler.ts` 패턴을 그대로 따르되 플레이북의 모든 CRON 항목을 루프 등록한다.

- [ ] **Step 1: 실패 테스트 작성**

`src/autopilot/application/autopilot.scheduler.spec.ts`:
```ts
import { AutopilotScheduler } from './autopilot.scheduler';

const makeQueue = () => ({
  add: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
});

describe('AutopilotScheduler', () => {
  it('owner 미설정 → 등록 0 + cleanup 호출', async () => {
    const queue = makeQueue();
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const s = new AutopilotScheduler(queue as never, config as never);
    await s.onApplicationBootstrap();
    expect(queue.add).not.toHaveBeenCalled();
    expect(queue.getRepeatableJobs).toHaveBeenCalled();
  });

  it('owner 설정 → CRON 항목 등록(daily-eval)', async () => {
    const queue = makeQueue();
    const config = {
      get: jest.fn((key: string) =>
        key === 'AUTOPILOT_OWNER_SLACK_USER_ID' ? 'U1' : undefined,
      ),
    };
    const s = new AutopilotScheduler(queue as never, config as never);
    await s.onApplicationBootstrap();
    expect(queue.add).toHaveBeenCalledWith(
      'daily-eval',
      { ownerSlackUserId: 'U1', target: 'U1' },
      expect.objectContaining({
        repeat: { pattern: '0 19 * * *', tz: 'Asia/Seoul' },
      }),
    );
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- --testPathPattern autopilot.scheduler 2>&1 | tail -12`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/autopilot/application/autopilot.scheduler.ts`:
```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import { AUTOPILOT_PLAYBOOK } from '../domain/autopilot.playbook';
import { AUTOPILOT_CRON_QUEUE, AutopilotJobData } from '../domain/autopilot.type';
import { PlaybookEntry } from '../domain/playbook.type';

// 부팅 시 플레이북의 CRON 항목을 단일 큐에 named repeatable 로 등록(jobName = entry.id).
// daily-eval.scheduler 패턴 — env 외부화 + cleanup 멱등. owner 미설정이면 전체 비활성.
// EVENT 항목은 등록 skip(실행은 SP4).
@Injectable()
export class AutopilotScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutopilotScheduler.name);

  constructor(
    @InjectQueue(AUTOPILOT_CRON_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const owner = this.readOwnerOrNull();
    if (!owner) {
      this.logger.log(
        'Autopilot 비활성 (AUTOPILOT_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const target = this.readNonEmpty('AUTOPILOT_TARGET', owner);
    await this.cleanupExistingRepeatables();

    for (const entry of AUTOPILOT_PLAYBOOK) {
      if (entry.trigger.kind !== 'CRON') {
        continue; // EVENT 는 SP4
      }
      const envKey = entry.id.toUpperCase().replace(/-/g, '_');
      const schedule = this.readNonEmpty(
        `AUTOPILOT_${envKey}_SCHEDULE`,
        entry.trigger.schedule,
      );
      const tz = this.readNonEmpty(
        `AUTOPILOT_${envKey}_TIMEZONE`,
        entry.trigger.timezone,
      );
      const payload: AutopilotJobData = { ownerSlackUserId: owner, target };
      await this.queue.add(entry.id, payload, {
        repeat: { pattern: schedule, tz },
        jobId: `autopilot:${entry.id}:${owner}`,
        removeOnComplete: 20,
        removeOnFail: 20,
        attempts: 2,
        backoff: { type: 'exponential', delay: 60_000 },
      });
      this.logger.log(
        `Autopilot 항목 활성화 — ${entry.id}, cron="${schedule}" (${tz}), target=${target}`,
      );
    }
  }

  private readOwnerOrNull(): string | null {
    const raw = this.configService.get<string>('AUTOPILOT_OWNER_SLACK_USER_ID');
    if (!raw) {
      return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readNonEmpty(key: string, fallback: string): string {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  private async cleanupExistingRepeatables(): Promise<void> {
    const repeatables = await this.queue.getRepeatableJobs();
    for (const job of repeatables) {
      await this.queue.removeRepeatableByKey(job.key);
    }
  }
}
```

> `PlaybookEntry` import 가 lint unused 면 제거. (타입 추론으로 불필요할 수 있음)

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- --testPathPattern autopilot.scheduler 2>&1 | tail -8`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/autopilot/application/autopilot.scheduler.ts src/autopilot/application/autopilot.scheduler.spec.ts
git commit -m "feat(autopilot): 스케줄러 — 플레이북 CRON 항목 repeatable 등록"
```

---

## Task 6: Consumer (@Processor 라우팅 + 실패 통지)

**Files:**
- Create: `src/autopilot/infrastructure/autopilot.consumer.ts`
- Test: `src/autopilot/infrastructure/autopilot.consumer.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/autopilot/infrastructure/autopilot.consumer.spec.ts`:
```ts
import { AutopilotConsumer } from './autopilot.consumer';

const makeJob = (name: string) => ({
  name,
  data: { ownerSlackUserId: 'U1', target: 'C1' },
}) as never;

describe('AutopilotConsumer', () => {
  it('job.name = 플레이북 id → orchestrator.run 위임', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const consumer = new AutopilotConsumer({ run } as never, undefined);
    await consumer.process(makeJob('daily-eval'));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'daily-eval' }),
      'U1',
      'C1',
    );
  });

  it('미등록 job.name → orchestrator 미호출(로그만)', async () => {
    const run = jest.fn();
    const consumer = new AutopilotConsumer({ run } as never, undefined);
    await consumer.process(makeJob('unknown-x'));
    expect(run).not.toHaveBeenCalled();
  });

  it('실행 실패 → publishCronFailure + rethrow', async () => {
    const run = jest.fn().mockRejectedValue(new Error('boom'));
    const publishCronFailure = jest.fn();
    const consumer = new AutopilotConsumer({ run } as never, {
      publishCronFailure,
    } as never);
    await expect(consumer.process(makeJob('daily-eval'))).rejects.toThrow('boom');
    expect(publishCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: 'Autopilot:daily-eval', ownerSlackUserId: 'U1' }),
    );
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- --testPathPattern autopilot.consumer 2>&1 | tail -12`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`src/autopilot/infrastructure/autopilot.consumer.ts`:
```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { AutopilotOrchestrator } from '../application/autopilot.orchestrator';
import { AUTOPILOT_PLAYBOOK } from '../domain/autopilot.playbook';
import { AUTOPILOT_CRON_QUEUE, AutopilotJobData } from '../domain/autopilot.type';

// 단일 consumer — job.name(=플레이북 entry.id)으로 항목을 찾아 오케스트레이터에 위임.
// 실패 시 owner DM 통지(fire-and-forget) 후 rethrow → BullMQ 재시도.
@Processor(AUTOPILOT_CRON_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class AutopilotConsumer extends WorkerHost {
  private readonly logger = new Logger(AutopilotConsumer.name);

  constructor(
    private readonly orchestrator: AutopilotOrchestrator,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<AutopilotJobData>): Promise<void> {
    const entry = AUTOPILOT_PLAYBOOK.find((candidate) => candidate.id === job.name);
    if (!entry) {
      this.logger.error(`Autopilot — 미등록 job 무시: ${job.name}`);
      return;
    }
    const { ownerSlackUserId, target } = job.data;
    try {
      await this.orchestrator.run(entry, ownerSlackUserId, target);
    } catch (error) {
      this.logger.error(`Autopilot[${entry.id}] 실패 (owner=${ownerSlackUserId})`, error);
      this.notifyOwnerFailure(ownerSlackUserId, entry.id, error);
      throw error;
    }
  }

  private notifyOwnerFailure(
    ownerSlackUserId: string,
    entryId: string,
    error: unknown,
  ): void {
    if (!this.notificationPublisher) {
      return;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.notificationPublisher.publishCronFailure({
      cronName: `Autopilot:${entryId}`,
      ownerSlackUserId,
      errorMessage,
    });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- --testPathPattern autopilot.consumer 2>&1 | tail -8`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/autopilot/infrastructure/autopilot.consumer.ts src/autopilot/infrastructure/autopilot.consumer.spec.ts
git commit -m "feat(autopilot): consumer — job.name 라우팅 + 실패 통지"
```

---

## Task 7: 모듈 배선 + env + Daily Eval 제거

**Files:**
- Create: `src/autopilot/autopilot.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/config/app.config.ts` (DAILY_EVAL_* → AUTOPILOT_*)
- Modify: `.env.example`, `README` (env 표)
- Delete: `src/daily-eval/` 전체

- [ ] **Step 1: Autopilot 모듈 작성**

`src/autopilot/autopilot.module.ts`:
```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { PoEvalModule } from '../agent/po-eval/po-eval.module';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { AutopilotOrchestrator } from './application/autopilot.orchestrator';
import { AutopilotScheduler } from './application/autopilot.scheduler';
import { AUTOPILOT_TASKS } from './domain/autopilot-task.port';
import { AUTOPILOT_CRON_QUEUE } from './domain/autopilot.type';
import { AutopilotConsumer } from './infrastructure/autopilot.consumer';
import { PoEvalAutopilotTask } from './infrastructure/tasks/po-eval.autopilot-task';

// Autopilot 골격 — daily-eval.module 패턴(BullMQ repeatable + SlackNotifierPort useExisting).
// CronIdempotencyService 는 @Global(CronIdempotencyModule) 이라 별도 import 불필요.
@Module({
  imports: [
    BullModule.registerQueue({ name: AUTOPILOT_CRON_QUEUE }),
    PoEvalModule,
    SlackModule,
    NotificationQueueModule,
  ],
  providers: [
    AutopilotScheduler,
    AutopilotConsumer,
    AutopilotOrchestrator,
    PoEvalAutopilotTask,
    {
      // 플레이북 task 레지스트리 — 신규 task 는 여기 inject 에 추가.
      provide: AUTOPILOT_TASKS,
      useFactory: (poEval: PoEvalAutopilotTask) => [poEval],
      inject: [PoEvalAutopilotTask],
    },
    {
      provide: SLACK_NOTIFIER_PORT,
      useExisting: SlackService,
    },
  ],
})
export class AutopilotModule {}
```

> CronIdempotencyService 가 @Global 이 아니라면(확인: `src/common/queue/cron-idempotency.module.ts`), `imports` 에 `CronIdempotencyModule` 추가.

- [ ] **Step 2: app.module 교체 (DailyEvalModule → AutopilotModule)**

`src/app.module.ts` 에서 `DailyEvalModule` import/등록을 제거하고 `AutopilotModule` 추가. 정확 위치는 `grep -n "DailyEvalModule" src/app.module.ts` 로 확인 후 두 줄(import 라인 + imports 배열 라인) 치환:
```ts
// import 라인:
import { AutopilotModule } from './autopilot/autopilot.module';
// (기존 import { DailyEvalModule } from './daily-eval/daily-eval.module'; 제거)

// imports 배열: DailyEvalModule 자리에
AutopilotModule,
```

- [ ] **Step 3: env 검증 교체 (app.config.ts)**

`src/config/app.config.ts` 의 `DAILY_EVAL_*` 4개(`DAILY_EVAL_OWNER_SLACK_USER_ID`, `DAILY_EVAL_TARGET`, `DAILY_EVAL_CRON`, `DAILY_EVAL_TIMEZONE`) 블록을 아래 `AUTOPILOT_*` 로 치환(기존 주석/`@IsOptional()` `@IsString()` 데코레이터 스타일 그대로):
```ts
  // - AUTOPILOT_OWNER_SLACK_USER_ID: Autopilot 전체 게이트. 미설정 시 비활성.
  // - AUTOPILOT_TARGET: 발송 대상 슬랙 user(U...)/channel(C.../G...) ID. 미설정 시 OWNER DM.
  // - AUTOPILOT_DAILY_EVAL_SCHEDULE: daily-eval 항목 cron override (default '0 19 * * *').
  // - AUTOPILOT_DAILY_EVAL_TIMEZONE: 위 cron 해석 기준 (default Asia/Seoul).
  @IsOptional()
  @IsString()
  AUTOPILOT_OWNER_SLACK_USER_ID?: string;

  @IsOptional()
  @IsString()
  AUTOPILOT_TARGET?: string;

  @IsOptional()
  @IsString()
  AUTOPILOT_DAILY_EVAL_SCHEDULE?: string;

  @IsOptional()
  @IsString()
  AUTOPILOT_DAILY_EVAL_TIMEZONE?: string;
```

- [ ] **Step 4: Daily Eval 모듈 삭제**

```bash
git rm -r src/daily-eval
```

- [ ] **Step 5: .env.example + README env 표 갱신**

`.env.example` 의 `DAILY_EVAL_*` 항목을 `AUTOPILOT_*` 로 치환(주석 동일 의미). README 의 env 표도 동일 치환.
**⚠️ `.env` 는 에이전트가 편집 불가(권한 보호)** — 구현 완료 후 사용자에게: `.env` 의 `DAILY_EVAL_OWNER_SLACK_USER_ID`(및 설정돼 있던 `DAILY_EVAL_TARGET/CRON/TIMEZONE`)를 `AUTOPILOT_OWNER_SLACK_USER_ID`(+ `AUTOPILOT_TARGET` / `AUTOPILOT_DAILY_EVAL_SCHEDULE` / `AUTOPILOT_DAILY_EVAL_TIMEZONE`)로 이름만 바꾸도록 안내(값 동일).

- [ ] **Step 6: 3중 게이트**

Run: `pnpm lint:check 2>&1 | tail -3 && pnpm test 2>&1 | grep -E "Tests:|Test Suites:|FAIL " && pnpm build 2>&1 | tail -3`
Expected: lint 0 errors / 전체 test PASS(신규 autopilot spec 포함, daily-eval spec 제거 반영) / build OK.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(autopilot): 모듈 배선 + env(DAILY_EVAL→AUTOPILOT) + Daily Eval 실이관 완료"
```

---

## Self-Review (작성자 체크)

**1. Spec 커버리지** (`2026-06-17-...-design.md`):
- §4.1 플레이북 스키마 → Task 1. §4.2 AutopilotTask 포트 → Task 1. §4.3 오케스트레이터 동작(멱등/idle skip/티어) → Task 4. §4.4 Daily Eval 수직 슬라이스 → Task 3+5+7. §5 효율(idle skip·멱등·today 1회) → Task 4. §6 env → Task 7. §7 테스트 → 각 Task. ✅ 갭 없음.
- 비목표(이벤트 실행/digest 다중/나머지 cron/cleanup)는 의도적으로 plan 에서 제외. ✅

**2. Placeholder 스캔:** TBD/“적절히 처리” 없음. 모든 코드 step 에 실제 코드. ✅

**3. 타입 일관성:** `AutopilotJobData`(Task1)=스케줄러 payload(Task5)=consumer job.data(Task6) ✅. `AUTOPILOT_TASKS` 토큰(Task1)=모듈 팩토리(Task7)=오케스트레이터 inject(Task4) ✅. `AutopilotTask{id,run}`/`AutopilotTaskResult{skip,slackText}` 일관 ✅. `entry.id`=job.name=멱등 키 일관 ✅. `getTodayKstDate`/`CRON_SENT_GUARD_TTL_SECONDS`/`LONG_RUNNING_WORKER_OPTIONS`/`SLACK_NOTIFIER_PORT` 경로는 기존 daily-eval 코드와 동일 import. ✅

**확인 필요(구현 중 1분 검증):**
- `PoEvalException` 생성자/`poEvalErrorCode` getter 형태 → 기존 `daily-eval.consumer.spec.ts`(삭제 전) 참조해 Task3 mock 정합.
- `CronIdempotencyModule` @Global 여부 → 아니면 AutopilotModule imports 추가.
- `app.config.ts` 의 DAILY_EVAL 블록 정확 위치/데코레이터 스타일.
