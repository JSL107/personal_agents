# 이대리 macOS 콘솔 Phase 0+1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이대리 백엔드가 에이전트 회사의 상태를 읽기 API + SSE 스트림으로 노출하고, macOS 네이티브 앱이 그것을 관제 대시보드로 시각화한다.

**Architecture:** NestJS에 read 전용 `console` 모듈을 추가해 agent-registry·agent-run·preview-gate 상태를 조립하고, 상태 5종을 순수 함수로 파생해 REST(`/v1/console/*`) + NestJS 내장 `@Sse()` 스트림으로 내보낸다. macOS 앱은 SwiftPM 패키지로, 부팅 시 스냅샷 1콜 후 SSE 구독으로 실시간 갱신하는 얇은 클라이언트다. LLM 로직은 앱에 없다.

**Tech Stack:** NestJS 10 · Prisma 6 · RxJS(기존) · NestJS `@Sse()`(내장, 신규 의존성 없음) · Swift 6 / SwiftPM · SwiftUI + Combine · XCTest.

## Global Constraints

- 패키지 매니저 `pnpm@9.15.9` 만. `npm`/`yarn` 금지.
- ORM은 Prisma만. `process.env` 직접 참조 금지 → `ConfigService.get(...)`.
- 새 env 추가 시 4곳 동기: `.env.example` + `.env` + `src/config/app.config.ts` + README.
- 백엔드 검증 3중 green: `pnpm lint:check && pnpm test && pnpm build`.
- 단일 파일 테스트는 `pnpm exec jest src/...` (프로젝트 `pnpm test`는 2단계 필터라 경로 인자 안 먹음).
- Swift 빌드·테스트는 `swift build` / `swift test` (이 환경은 CLT만, `xcodebuild` 없음).
- 콘솔 API는 **읽기·알림만**. 에이전트 발화·외부 발송 등 부작용 0. 유료 LLM API 경로 도입 금지.
- commit 은 사용자 명시 요청 후에만. 이 계획의 "Commit" 스텝은 그 승인 하에 실행.
- 코드 스타일: `catch (error)`, 축약 변수명 금지, `if` 단일라인도 중괄호, try-catch 내 `return await`.

---

## 진행 상태 (RESUME — 2026-07-27)

> 새 세션에서 이 계획을 이어갈 때 여기부터 읽으세요.

- **작업 위치**: worktree `/Users/juneseok/worktrees/idaeri-console`, 브랜치 `feat/macos-console-phase0-1` (main 에서 분기). node_modules 설치 + `prisma:generate` + `rebuild` 완료.
- **완료 (PART A 백엔드 전체)**: B1 · A1 · A2 · A3 (이전 세션) + **A4(활성 런 read) · A5(스냅샷 조립 + preview `findAllOpen`) · A6(REST 4종 + SSE + 모듈 등록 + e2e) · A7(런·승인 라이프사이클 이벤트 emit)** (이번 세션). 백엔드 3중 green: `lint:check` 0 err / `test` 1711+40 pass / `build` OK.
- **다음 (PART B macOS Swift 앱)**: B2(계약 Codable 모델 + 디코딩 테스트) → B3(ConsoleStore 이벤트 적용) → B4(ConsoleClient + SSE 라인 파서) → B5(대시보드 뷰 배선). `clients/idaeri-console/` 에 B1 스캐폴드(`swift build` green) 존재.
- **이번 세션 설계 결정 (구현 시 확정한 사항)**:
  - `AgentRunService.findActiveRuns` / preview `findAllOpen` 은 도메인 표현(number id, `endedAt` Date)을 반환하고, 뷰 변환(string id, ISO, `finishedAt`)은 `ConsoleReadService` 가 담당 — 기존 read 메서드 관례와 일치.
  - `ConsoleApproval.agentType` 은 v1 에서 **null** (PreviewAction 에 agentType 필드 없음). `title`=`previewText`. kind→agentType 매핑은 Phase 2. `deriveAgentState` 의 `hasOpenApproval` 파생 구조는 미래 대비해 넣어뒀으나 v1 은 항상 false.
  - `ConsoleEventBus` 는 `ConsoleEventBusModule(@Global)` 로 승격 — agent-run/preview-gate emit 과 SSE 구독의 모듈 순환 회피. usecase 주입은 `@Optional`(기존 episodicMemory 패턴, production 은 global 로 항상 주입).
  - SSE 는 커스텀 `@RawResponse()` + `ResponseInterceptor` 가 Reflector 로 감지해 `{code,message,data}` 래핑을 건너뛴다(SSE 포맷 보존). `main.ts` 만 Reflector 주입, 기존 `new ResponseInterceptor()` 는 하위호환.
  - **A8(공유 시크릿 가드)은 보류** — v1 콘솔은 localhost 전용이라 불필요. 외부 노출 시 재검토.
  - console↔preview-gate 파일 상호 의존으로 백엔드는 **1커밋**(중간 커밋 빌드 보장 불가 → atomic 분리 포기).
- **주의**: e2e 는 부분 모듈 + mock 의존성으로 구성해 DB 불필요(계획서의 "DB 필요"는 AppModule 전체 부팅 가정이었으나 부분 e2e 가 더 결정론적). 커밋은 사용자 명시 요청 후에만.

---

## File Structure

**백엔드 (`src/console/`)**
- `domain/console.type.ts` — 뷰 타입·enum (SoT for contract)
- `application/derive-agent-state.ts` — 상태 5종 파생 + bubble 매핑 (순수 함수)
- `application/console-event-bus.service.ts` — RxJS Subject 기반 in-process 이벤트 버스
- `application/console-read.service.ts` — 스냅샷 조립
- `interface/console.controller.ts` — REST 읽기 엔드포인트
- `interface/console-stream.controller.ts` — `@Sse()` 스트림
- `console.module.ts` — 모듈 등록
- Modify `src/app.module.ts` — ConsoleModule import
- Modify `src/agent-run/**` — 활성 런 read 메서드 + 라이프사이클 이벤트 emit
- Modify `src/preview-gate/application/{create,apply,cancel}-preview.usecase.ts` — 승인 이벤트 emit

**앱 (`clients/idaeri-console/`)**
- `Package.swift` — executable `IdaeriConsole` + library `ConsoleCore` + test `ConsoleCoreTests`
- `Sources/ConsoleCore/Models.swift` — Codable 계약 미러
- `Sources/ConsoleCore/ConsoleClient.swift` — 스냅샷 fetch + SSE 파서
- `Sources/ConsoleCore/ConsoleStore.swift` — 이벤트 적용 상태 스토어
- `Sources/IdaeriConsole/main.swift` — NSApplication 부팅
- `Sources/IdaeriConsole/DashboardView.swift` 외 뷰
- `Tests/ConsoleCoreTests/*` — 디코딩·스토어·SSE 파서 테스트

---

## PART A — 백엔드 `console` 모듈 (Phase 0)

### Task A1: 뷰 타입·상태 enum 정의

**Files:**
- Create: `src/console/domain/console.type.ts`

**Interfaces:**
- Produces:
  - `enum ConsoleAgentState { COMPLETED, IN_PROGRESS, AWAITING_APPROVAL, AWAITING_INTEGRATION, WAITING }`
  - `interface ConsoleAgent { agentType: string; displayName: string; slashCommands: readonly string[]; description: string; state: ConsoleAgentState; bubble: string }`
  - `interface ConsoleRun { id: string; agentType: string; status: string; parentId: string | null; startedAt: string; finishedAt: string | null }`
  - `interface ConsoleApproval { id: string; agentType: string | null; title: string; createdAt: string }`
  - `interface ConsoleSnapshot { agents: ConsoleAgent[]; runs: ConsoleRun[]; approvals: ConsoleApproval[]; serverTime: string }`
  - `type ConsoleEvent =` 아래 유니온: `{ type: 'run.started'|'run.finished', run: ConsoleRun }` | `{ type: 'approval.opened'|'approval.resolved', approval: ConsoleApproval }` | `{ type: 'state.changed', agentType: string, state: ConsoleAgentState }`

- [ ] **Step 1: 타입 파일 작성** — 위 Produces 항목을 그대로 정의. enum 값은 문자열 리터럴 형태(`COMPLETED = 'COMPLETED'` …)로.
- [ ] **Step 2: 타입 컴파일 확인** — Run: `pnpm exec tsc --noEmit -p tsconfig.json` · Expected: 에러 없음.
- [ ] **Step 3: Commit** — `git add src/console/domain/console.type.ts && git commit -m "feat(console): 뷰 타입·상태 enum 정의"`

---

### Task A2: 상태 5종 파생 순수 함수

**Files:**
- Create: `src/console/application/derive-agent-state.ts`
- Test: `src/console/application/derive-agent-state.spec.ts`

**Interfaces:**
- Consumes: `ConsoleAgentState` (A1)
- Produces:
  - `interface DeriveInput { hasOpenApproval: boolean; hasActiveRun: boolean; latestFinishedStatus: 'SUCCEEDED'|'FAILED'|null; isIntegrationBlocked: boolean; isQueuedWaiting: boolean }`
  - `function deriveAgentState(input: DeriveInput): ConsoleAgentState`
  - `function bubbleForState(state: ConsoleAgentState): string`

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { ConsoleAgentState } from '../domain/console.type';
import { deriveAgentState, bubbleForState, DeriveInput } from './derive-agent-state';

const base: DeriveInput = {
  hasOpenApproval: false,
  hasActiveRun: false,
  latestFinishedStatus: null,
  isIntegrationBlocked: false,
  isQueuedWaiting: false,
};

describe('deriveAgentState', () => {
  it('승인 대기가 최우선', () => {
    expect(
      deriveAgentState({ ...base, hasOpenApproval: true, hasActiveRun: true }),
    ).toBe(ConsoleAgentState.AWAITING_APPROVAL);
  });

  it('연동 차단은 진행중보다 우선', () => {
    expect(
      deriveAgentState({ ...base, isIntegrationBlocked: true, hasActiveRun: true }),
    ).toBe(ConsoleAgentState.AWAITING_INTEGRATION);
  });

  it('활성 런이면 진행중', () => {
    expect(deriveAgentState({ ...base, hasActiveRun: true })).toBe(
      ConsoleAgentState.IN_PROGRESS,
    );
  });

  it('큐 대기면 대기', () => {
    expect(deriveAgentState({ ...base, isQueuedWaiting: true })).toBe(
      ConsoleAgentState.WAITING,
    );
  });

  it('성공 종료 후 아무 대기 없으면 완료', () => {
    expect(
      deriveAgentState({ ...base, latestFinishedStatus: 'SUCCEEDED' }),
    ).toBe(ConsoleAgentState.COMPLETED);
  });

  it('아무 신호 없으면 대기(기본 안전값)', () => {
    expect(deriveAgentState(base)).toBe(ConsoleAgentState.WAITING);
  });

  it('bubble 은 상태마다 비어있지 않음', () => {
    for (const state of Object.values(ConsoleAgentState)) {
      expect(bubbleForState(state).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm exec jest src/console/application/derive-agent-state.spec.ts` · Expected: FAIL(모듈 없음).
- [ ] **Step 3: 구현 작성**

```ts
import { ConsoleAgentState } from '../domain/console.type';

export interface DeriveInput {
  hasOpenApproval: boolean;
  hasActiveRun: boolean;
  latestFinishedStatus: 'SUCCEEDED' | 'FAILED' | null;
  isIntegrationBlocked: boolean;
  isQueuedWaiting: boolean;
}

export function deriveAgentState(input: DeriveInput): ConsoleAgentState {
  if (input.hasOpenApproval) {
    return ConsoleAgentState.AWAITING_APPROVAL;
  }
  if (input.isIntegrationBlocked) {
    return ConsoleAgentState.AWAITING_INTEGRATION;
  }
  if (input.hasActiveRun) {
    return ConsoleAgentState.IN_PROGRESS;
  }
  if (input.isQueuedWaiting) {
    return ConsoleAgentState.WAITING;
  }
  if (input.latestFinishedStatus === 'SUCCEEDED') {
    return ConsoleAgentState.COMPLETED;
  }
  return ConsoleAgentState.WAITING;
}

const BUBBLES: Record<ConsoleAgentState, string> = {
  [ConsoleAgentState.COMPLETED]: '완료했어요!',
  [ConsoleAgentState.IN_PROGRESS]: '일하는 중…',
  [ConsoleAgentState.AWAITING_APPROVAL]: '확인해주세요',
  [ConsoleAgentState.AWAITING_INTEGRATION]: '연결 기다려요',
  [ConsoleAgentState.WAITING]: '업무 대기중',
};

export function bubbleForState(state: ConsoleAgentState): string {
  return BUBBLES[state];
}
```

- [ ] **Step 4: 통과 확인** — Run: `pnpm exec jest src/console/application/derive-agent-state.spec.ts` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/console/application/derive-agent-state.* && git commit -m "feat(console): 상태 5종 파생 순수 함수"`

---

### Task A3: in-process 이벤트 버스

**Files:**
- Create: `src/console/application/console-event-bus.service.ts`
- Test: `src/console/application/console-event-bus.service.spec.ts`

**Interfaces:**
- Consumes: `ConsoleEvent` (A1)
- Produces:
  - `class ConsoleEventBus` — `publish(event: ConsoleEvent): void`, `stream(): Observable<ConsoleEvent>`
  - RxJS `Subject<ConsoleEvent>` 백킹. `@Injectable()`.

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { ConsoleEventBus } from './console-event-bus.service';
import { ConsoleAgentState } from '../domain/console.type';

describe('ConsoleEventBus', () => {
  it('publish 한 이벤트를 구독자가 받는다', async () => {
    const bus = new ConsoleEventBus();
    const received = firstValueFrom(bus.stream().pipe(take(1)));
    bus.publish({ type: 'state.changed', agentType: 'PM', state: ConsoleAgentState.IN_PROGRESS });
    await expect(received).resolves.toMatchObject({ type: 'state.changed', agentType: 'PM' });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm exec jest src/console/application/console-event-bus.service.spec.ts` · Expected: FAIL.
- [ ] **Step 3: 구현 작성**

```ts
import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { ConsoleEvent } from '../domain/console.type';

@Injectable()
export class ConsoleEventBus {
  private readonly subject = new Subject<ConsoleEvent>();

  publish(event: ConsoleEvent): void {
    this.subject.next(event);
  }

  stream(): Observable<ConsoleEvent> {
    return this.subject.asObservable();
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `pnpm exec jest src/console/application/console-event-bus.service.spec.ts` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/console/application/console-event-bus.service.* && git commit -m "feat(console): in-process 이벤트 버스(RxJS)"`

---

### Task A4: 활성 런 조회 read 메서드 추가

**Files:**
- Modify: `src/agent-run/domain/port/agent-run.repository.port.ts` (read 메서드 시그니처 추가)
- Modify: `src/agent-run/infrastructure/*agent-run*.repository.ts` (Prisma 구현)
- Modify: `src/agent-run/application/agent-run.service.ts` (public wrapper `findActiveRuns`)
- Test: `src/agent-run/application/agent-run.service.spec.ts` (기존) 또는 신규 spec

**Interfaces:**
- Produces: `AgentRunService.findActiveRuns(): Promise<Array<{ id: string; agentType: string; status: string; parentId: string | null; startedAt: Date; finishedAt: Date | null }>>` — `status = IN_PROGRESS` 인 런만.

**주의(기존 교훈):** 포트에 메서드를 추가하면 `jest.Mocked<AgentRunRepositoryPort>` 를 쓰는 기존 spec들이 "Property missing" 으로 깨질 수 있다. 이 Task 마지막에 `pnpm test` 전체를 돌려 mock 누락을 잡고, 깨진 mock에 `findActiveRuns: jest.fn()` 를 채운다.

- [ ] **Step 1: 실패 테스트 작성** — 리포지토리 포트를 목킹해 `findActiveRuns` 가 IN_PROGRESS 필터로 위임하는지 검증하는 테스트.

```ts
it('findActiveRuns 는 IN_PROGRESS 런을 반환한다', async () => {
  repository.findActive.mockResolvedValue([
    { id: 'r1', agentType: 'PM', status: 'IN_PROGRESS', parentId: null, startedAt: new Date(), finishedAt: null },
  ]);
  const result = await service.findActiveRuns();
  expect(result).toHaveLength(1);
  expect(result[0].status).toBe('IN_PROGRESS');
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm exec jest src/agent-run/application/agent-run.service.spec.ts` · Expected: FAIL.
- [ ] **Step 3: 구현** — 포트에 `findActive(): Promise<...>` 추가 → Prisma 리포지토리에서 `where: { status: 'IN_PROGRESS' }` 조회 → 서비스 `findActiveRuns` 가 위임·매핑.
- [ ] **Step 4: 통과 확인** — Run: `pnpm exec jest src/agent-run/application/agent-run.service.spec.ts` · Expected: PASS.
- [ ] **Step 5: 전체 테스트로 mock 누락 확인** — Run: `pnpm test` · Expected: PASS (깨진 mock 있으면 `findActive: jest.fn()` 로 보강 후 재실행).
- [ ] **Step 6: Commit** — `git add src/agent-run && git commit -m "feat(agent-run): 활성 런 조회 read 메서드"`

---

### Task A5: 스냅샷 조립 서비스

**Files:**
- Create: `src/console/application/console-read.service.ts`
- Test: `src/console/application/console-read.service.spec.ts`

**Interfaces:**
- Consumes: `AgentRunService.findActiveRuns` (A4), `FindLatestPendingPreviewUsecase`(기존, preview-gate) 또는 pending 조회 usecase, `AGENT_REGISTRY`(agent-registry), `deriveAgentState`/`bubbleForState`(A2)
- Produces: `ConsoleReadService.getSnapshot(): Promise<ConsoleSnapshot>`

- [ ] **Step 1: 실패 테스트 작성** — 목킹된 의존성으로, 레지스트리 각 에이전트가 파생 상태·bubble 을 갖고, active 런/승인 대기가 스냅샷에 담기는지 검증.

```ts
it('스냅샷은 레지스트리 전원 + 파생 상태를 담는다', async () => {
  agentRunService.findActiveRuns.mockResolvedValue([]);
  pendingPreviews.findAllOpen.mockResolvedValue([]);
  const snapshot = await service.getSnapshot();
  expect(snapshot.agents.length).toBe(AGENT_REGISTRY.length);
  expect(snapshot.agents.every((a) => a.bubble.length > 0)).toBe(true);
  expect(typeof snapshot.serverTime).toBe('string');
});

it('활성 런이 있는 에이전트는 진행중', async () => {
  agentRunService.findActiveRuns.mockResolvedValue([
    { id: 'r1', agentType: 'PM', status: 'IN_PROGRESS', parentId: null, startedAt: new Date(), finishedAt: null },
  ]);
  pendingPreviews.findAllOpen.mockResolvedValue([]);
  const snapshot = await service.getSnapshot();
  const pm = snapshot.agents.find((a) => a.agentType === 'PM');
  expect(pm?.state).toBe('IN_PROGRESS');
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm exec jest src/console/application/console-read.service.spec.ts` · Expected: FAIL.
- [ ] **Step 3: 구현** — 레지스트리를 순회하며 각 에이전트별 active 런 유무·open 승인 유무를 `deriveAgentState` 입력으로 조립. 승인 대기 목록의 `agentType` 매핑은 preview-action 타입의 필드 사용(없으면 null). pending 조회는 preview-gate 에 "열린 승인 전체" 조회가 없으면 `find-latest-pending-preview.usecase` 를 확장하거나 리포지토리에 `findAllOpen` 을 추가(A4와 동일한 mock-보강 주의).
- [ ] **Step 4: 통과 확인** — Run: `pnpm exec jest src/console/application/console-read.service.spec.ts` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/console/application/console-read.service.* && git commit -m "feat(console): 스냅샷 조립 서비스"`

---

### Task A6: REST 컨트롤러 + SSE 스트림 + 모듈 등록

**Files:**
- Create: `src/console/interface/console.controller.ts`
- Create: `src/console/interface/console-stream.controller.ts`
- Create: `src/console/console.module.ts`
- Modify: `src/app.module.ts`
- Test(e2e): `test/console.e2e-spec.ts`

**Interfaces:**
- Consumes: `ConsoleReadService`(A5), `ConsoleEventBus`(A3)
- Produces: HTTP 표면 `GET /v1/console/{snapshot,agents,runs,approvals,stream}`
- REST 컨트롤러는 `@Controller('v1/console')`. SSE 는 `@Sse('stream')` 가 `bus.stream()` 을 `map` 으로 `MessageEvent`(`{ data: event }`) 로 변환해 반환.

- [ ] **Step 1: 실패 e2e 작성**

```ts
it('GET /v1/console/snapshot 는 200 + agents 배열', async () => {
  const res = await request(app.getHttpServer()).get('/v1/console/snapshot');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.data.agents)).toBe(true);
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm exec jest --config test/jest-e2e.json test/console.e2e-spec.ts` · Expected: FAIL.
- [ ] **Step 3: 구현** — 컨트롤러/SSE/모듈 작성, `AppModule` 에 `ConsoleModule` import. `ResponseInterceptor` 가 `data` 로 감싸는 기존 규약 확인.
- [ ] **Step 4: 통과 확인** — Run: `pnpm exec jest --config test/jest-e2e.json test/console.e2e-spec.ts` · Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/console src/app.module.ts test/console.e2e-spec.ts && git commit -m "feat(console): REST + SSE 컨트롤러 + 모듈 등록"`

---

### Task A7: 라이프사이클·승인 이벤트 emit 배선

**Files:**
- Modify: `src/agent-run/application/agent-run.service.ts` (`execute` 시작/종료 지점 emit)
- Modify: `src/preview-gate/application/create-preview.usecase.ts` (approval.opened)
- Modify: `src/preview-gate/application/apply-preview.usecase.ts` + `cancel-preview.usecase.ts` + `expire-previews.usecase.ts` (approval.resolved)
- Modify: `console.module.ts` / 관련 모듈 exports (ConsoleEventBus 공유)
- Test: 각 usecase spec 에 emit 검증 추가

**Interfaces:**
- Consumes: `ConsoleEventBus.publish`(A3)
- ConsoleEventBus 를 공유하려면 `ConsoleModule` 이 `ConsoleEventBus` 를 `exports` 하고, agent-run/preview-gate 모듈이 `ConsoleModule`(또는 버스만 담은 별도 shared 모듈) 을 import. 순환 의존 방지를 위해 **버스를 `src/console/application` 이 아닌 경량 shared 위치**(예: `src/common/console-event-bus`)로 승격하는 것을 우선 검토. 순환이 없으면 그대로 둔다.

- [ ] **Step 1: 실패 테스트** — `create-preview.usecase.spec.ts` 에 "생성 시 bus.publish 가 approval.opened 로 호출" 검증(목 버스 주입).

```ts
it('프리뷰 생성 시 approval.opened 발행', async () => {
  await usecase.execute(validInput);
  expect(bus.publish).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'approval.opened' }),
  );
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm exec jest src/preview-gate/application/create-preview.usecase.spec.ts` · Expected: FAIL.
- [ ] **Step 3: 구현** — 각 지점에 `this.bus.publish(...)` 추가. 버스 주입은 **선택적(optional)** 이 아니라 정식 DI. run 시작/종료에서 `run.started`/`run.finished` + `state.changed` 발행.
- [ ] **Step 4: 통과 확인 + 전체** — Run: `pnpm exec jest src/preview-gate` 후 `pnpm test` · Expected: PASS(포트/생성자 변경으로 깨진 mock 보강).
- [ ] **Step 5: 3중 green** — Run: `pnpm lint:check && pnpm test && pnpm build` · Expected: 모두 exit 0.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(console): 런·승인 라이프사이클 이벤트 emit 배선"`

---

### Task A8: (선택) 공유 시크릿 가드 + env 4곳 동기

**Files:**
- Modify: `src/config/app.config.ts` (`CONSOLE_API_TOKEN?` optional)
- Modify: `.env.example`, `.env`, `README`
- Modify: `src/console/interface/*` (헤더 가드)
- Test: e2e 에 토큰 유/무 케이스

**Interfaces:**
- 토큰이 설정돼 있으면 `X-Console-Token` 불일치 시 401. 미설정이면 localhost 신뢰(통과).

- [ ] **Step 1: 실패 e2e** — 토큰 설정 시 헤더 없으면 401.
- [ ] **Step 2: 실패 확인** — Run: `pnpm exec jest --config test/jest-e2e.json test/console.e2e-spec.ts`.
- [ ] **Step 3: 구현 + env 4곳 동기.**
- [ ] **Step 4: 3중 green** — `pnpm lint:check && pnpm test && pnpm build`.
- [ ] **Step 5: `pnpm docs:check`** (에이전트/env 변경 시 CI가 요구 — 로컬 선제 확인).
- [ ] **Step 6: Commit** — `git commit -m "feat(console): 선택적 공유 시크릿 가드 + env 동기"`

---

## PART B — macOS 앱 (Phase 1)

### Task B1: SwiftPM 스캐폴드 + GUI 빈 창 스파이크 (리스크 선해소)

**Files:**
- Create: `clients/idaeri-console/Package.swift`
- Create: `clients/idaeri-console/Sources/IdaeriConsole/main.swift`
- Create: `clients/idaeri-console/Sources/ConsoleCore/Placeholder.swift`

**Interfaces:**
- `Package.swift`: executable target `IdaeriConsole`(deps: `ConsoleCore`) + library `ConsoleCore` + test `ConsoleCoreTests`. `platforms: [.macOS(.v13)]`.
- Produces: `swift build` 성공 + 실행 시 빈 SwiftUI 창이 뜨는 최소 앱.

- [ ] **Step 1: Package.swift + main.swift 작성** — `main.swift` 는 `NSApplication.shared` + `setActivationPolicy(.regular)` + `NSHostingController` 로 빈 `Text("이대리 콘솔")` 창을 띄우고 `app.run()`.
- [ ] **Step 2: 빌드** — Run: `cd clients/idaeri-console && swift build` · Expected: 성공.
- [ ] **Step 3: 실행 확인(수동)** — Run: `swift run IdaeriConsole` · Expected: 창이 뜬다. **뜨지 않으면 여기서 멈추고 대체안(Xcode 프로젝트 필요→사용자 설치)으로 에스컬레이션.** 이 스텝이 spec §6 최대 리스크의 게이트.
- [ ] **Step 4: Commit** — `git add clients/idaeri-console && git commit -m "feat(console-app): SwiftPM 스캐폴드 + 빈 창 스파이크"`

---

### Task B2: 계약 모델 + 디코딩 테스트

**Files:**
- Create: `clients/idaeri-console/Sources/ConsoleCore/Models.swift`
- Test: `clients/idaeri-console/Tests/ConsoleCoreTests/ModelsTests.swift`

**Interfaces:**
- Consumes: 백엔드 계약(§3.3 / Task A1). `ConsoleSnapshot`, `ConsoleAgent`, `ConsoleRun`, `ConsoleApproval`, `ConsoleAgentState`(Swift enum: `completed|inProgress|awaitingApproval|awaitingIntegration|waiting`, `String` rawValue = 백엔드 enum 문자열).
- Produces: `Codable` 구조체들.

- [ ] **Step 1: 실패 테스트 작성** — A1 응답 형태의 JSON 픽스처 문자열을 디코딩해 필드 검증.

```swift
func testDecodeSnapshot() throws {
    let json = """
    {"agents":[{"agentType":"PM","displayName":"PM","slashCommands":["/today"],"description":"","state":"IN_PROGRESS","bubble":"일하는 중…"}],"runs":[],"approvals":[],"serverTime":"2026-07-27T00:00:00Z"}
    """.data(using: .utf8)!
    let snapshot = try JSONDecoder().decode(ConsoleSnapshot.self, from: json)
    XCTAssertEqual(snapshot.agents.first?.state, .inProgress)
}
```

- [ ] **Step 2: 실패 확인** — Run: `swift test --filter ModelsTests` · Expected: FAIL(타입 없음).
- [ ] **Step 3: 구현** — Codable 구조체 + `ConsoleAgentState: String, Codable` (rawValue 매핑).
- [ ] **Step 4: 통과 확인** — Run: `swift test --filter ModelsTests` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(console-app): 계약 Codable 모델 + 디코딩 테스트"`

---

### Task B3: ConsoleStore (이벤트 적용) + 테스트

**Files:**
- Create: `clients/idaeri-console/Sources/ConsoleCore/ConsoleStore.swift`
- Test: `clients/idaeri-console/Tests/ConsoleCoreTests/ConsoleStoreTests.swift`

**Interfaces:**
- Consumes: `Models`(B2)
- Produces: `final class ConsoleStore: ObservableObject` — `@Published var agents`, `apply(snapshot:)`, `apply(event:)`. `state.changed` 이벤트가 해당 agent 상태를 갱신.

- [ ] **Step 1: 실패 테스트** — 스냅샷 적용 후 `state.changed` 적용 시 해당 에이전트 상태가 바뀌는지.
- [ ] **Step 2: 실패 확인** — Run: `swift test --filter ConsoleStoreTests` · Expected: FAIL.
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 통과 확인** — Run: `swift test --filter ConsoleStoreTests` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(console-app): ConsoleStore 이벤트 적용"`

---

### Task B4: ConsoleClient (스냅샷 fetch + SSE 라인 파서) + 테스트

**Files:**
- Create: `clients/idaeri-console/Sources/ConsoleCore/ConsoleClient.swift`
- Test: `clients/idaeri-console/Tests/ConsoleCoreTests/SSEParserTests.swift`

**Interfaces:**
- Produces:
  - `func parseSSELine(_ buffer: inout String) -> [ConsoleEvent]` — `data:` 라인을 잘라 이벤트 디코딩(순수, 테스트 대상).
  - `actor ConsoleClient` — `fetchSnapshot() async throws -> ConsoleSnapshot`, `events() -> AsyncStream<ConsoleEvent>` (URLSession bytes 스트림 기반).

- [ ] **Step 1: 실패 테스트** — SSE 텍스트 청크(`data: {...}\n\n`)를 파서에 넣으면 이벤트 배열이 나오는지, 부분 청크는 버퍼에 남는지.
- [ ] **Step 2: 실패 확인** — Run: `swift test --filter SSEParserTests` · Expected: FAIL.
- [ ] **Step 3: 구현** — 파서(순수) + URLSession 기반 fetch/stream. 네트워크 자체는 테스트하지 않고 파서만 단위 테스트.
- [ ] **Step 4: 통과 확인** — Run: `swift test --filter SSEParserTests` · Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(console-app): ConsoleClient + SSE 파서"`

---

### Task B5: 대시보드 뷰 배선 (부팅 스냅샷 → SSE 구독)

**Files:**
- Create: `clients/idaeri-console/Sources/IdaeriConsole/DashboardView.swift`
- Create: `clients/idaeri-console/Sources/IdaeriConsole/AgentCardView.swift`
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/main.swift` (DashboardView 로 교체)

**Interfaces:**
- Consumes: `ConsoleStore`(B3), `ConsoleClient`(B4)
- 뷰: 헤더(회사명·시각·진행률) + 부서 그리드(AgentCard, 5종 색·bubble) + 승인 대기 패널 + 병목 배너. 색은 Notion 팔레트(민트/노랑/진핑크/라벤더/흰색).
- 부팅 시 `fetchSnapshot()` → store 적용, 이후 `events()` AsyncStream 구독. 실패 시 지수 백오프 재연결 후 스냅샷 재동기화.

- [ ] **Step 1: 뷰 + 배선 구현** (SwiftUI 뷰는 로직 최소, 데이터는 store 바인딩).
- [ ] **Step 2: 빌드** — Run: `swift build` · Expected: 성공.
- [ ] **Step 3: 전체 테스트** — Run: `swift test` · Expected: PASS.
- [ ] **Step 4: 수동 실행 확인** — 백엔드 기동 상태에서 `swift run IdaeriConsole` → 카드에 실제 상태·색이 뜨는지(정직히: 자동 검증 아님, 사용자 확인).
- [ ] **Step 5: Commit** — `git commit -m "feat(console-app): 관제 대시보드 뷰 + 실시간 배선"`

---

## Self-Review

**Spec coverage:**
- §3.2 상태 5종 파생 → A2 ✅
- §3.3 REST 4종 → A5(조립)+A6(노출) ✅
- §3.4 SSE 스트림 + 이벤트 소스 → A3(버스)+A6(@Sse)+A7(emit 배선) ✅
- §3.5 공유 시크릿·env → A8 ✅
- §4.1 SwiftPM 빌드/CLT 제약 → B1(스파이크) ✅
- §4.2 화면 4요소 → B5 ✅
- §4.3 스냅샷→SSE 흐름·재연결 → B4+B5 ✅
- §4.4 디코딩/상태매핑 테스트 → B2/B3/B4 ✅
- §6 SwiftPM GUI 리스크 → B1 Step3 게이트 ✅

**Placeholder scan:** 코드 스텝은 실제 코드 포함. A5/A7의 일부(preview-gate 열린 승인 전체 조회 유무)는 "있으면 사용, 없으면 `findAllOpen` 추가 + mock 보강" 으로 분기를 명시 — 구현 시점 실제 코드 확인 필요 지점으로 표시함(placeholder 아님, 조건부 실행 지시).

**Type consistency:** `ConsoleAgentState`(TS enum 문자열) ↔ Swift `ConsoleAgentState`(String rawValue) 매핑 일치. `ConsoleEvent` 유니온 필드명(run/approval/agentType/state) A1↔A7↔B4 동일.

## 알려진 미결(구현 중 확정)
- A5/A7: preview-gate 에 "열린 승인 전체 조회" 메서드 존재 여부 — 구현 첫 스텝에서 `find-latest-pending-preview.usecase` 및 리포지토리 확인 후 `findAllOpen` 추가 여부 결정.
- B1 Step3: SwiftPM 단독 GUI 기동 가능 여부 — 불가 시 사용자에게 Xcode 설치 에스컬레이션.
- `연동대기` 판별 신호는 v1 보수적(런 실패 사유 기반), Phase 2에서 확장.
