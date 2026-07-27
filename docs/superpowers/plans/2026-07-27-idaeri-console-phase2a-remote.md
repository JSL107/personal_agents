# 이대리 콘솔 Phase 2A — 지시·승인 리모컨 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** macOS 관제 콘솔에서 이대리 에이전트에게 지시하고 PreviewGate 승인/거절을 원격 실행하며, codex 지연 구간을 pending으로 시각화한다.

**Architecture:** 백엔드는 read-only `v1/console`에 write 컨트롤러 3개(`POST /command`, `POST /approvals/:id/apply|cancel`)를 얹되, 로직은 기존 `IdaeriRouterPort.dispatch()`·`Apply/CancelPreviewUsecase`에 위임한다. write는 `ConsoleWriteGuard`(loopback IP + 선택적 토큰)로 보호하고 owner는 env로 고정 주입한다. 앱은 `ConsoleClient`에 POST를, `ConsoleStore`에 낙관적 pending 상태기계를, 뷰에 커맨드바·지시버튼·승인버튼을 추가한다. 지시는 fire-and-forget(202)이고 진행은 기존 SSE(`run.started`/`run.finished`)로 pending에 반영된다.

**Tech Stack:** NestJS 10 + Prisma 6(백엔드, jest), Swift 5 / SwiftPM(macOS 앱, 실행형 테스트 러너 `swift run ConsoleCoreTests`).

## Global Constraints

- 패키지 매니저 `pnpm@9.15.9` (npm/yarn 금지). Node 22+.
- `process.env` 직접 참조 금지 → `ConfigService.get(...)`.
- ORM은 Prisma만. 이 계획은 DB 스키마 변경 없음(`schema.prisma` 무변경).
- 새 env 추가 시 4곳 동기: `.env.example` + `.env` + `src/config/app.config.ts` + `README`.
- 백엔드 검증: `pnpm lint:check && pnpm build` + 단일 파일 테스트는 `pnpm exec jest <경로>` (프로젝트 `pnpm test`는 2단계라 경로 필터가 안 먹음).
- 앱 검증: `cd clients/idaeri-console && swift build` + `swift run ConsoleCoreTests`(exit 0 = green).
- 완료 게이트: `pnpm lint:check && pnpm test && pnpm build` 3중 green + `swift run ConsoleCoreTests` green.
- 커밋은 의미 단위 atomic, 한국어 subject OK(`<type>(<scope>): <subject>`). 각 Task 끝에서 커밋.

## Task별 TDD 적용 여부

| Task | 성격 | TDD |
|---|---|---|
| 1. DispatchSource 확장 | 타입 union 한 줄 | ❌ (배선, 컴파일로 검증) |
| 2. env 2개 추가 | 설정 4곳 동기 | ❌ (부팅 검증) |
| 3. ConsoleWriteGuard | loopback/토큰 분기 로직 | ✅ jest |
| 4. ConsoleWriteService | owner 주입·위임·fire-and-forget | ✅ jest |
| 5. DTO + Controller + 모듈 배선 | 얇은 위임 컨트롤러 | ✅ jest(위임 단위) |
| 6. 앱 Models 확장 | struct/enum 정의 | ❌ (컴파일로 검증) |
| 7. 앱 ConsoleClient POST | 순수 요청 빌더 + actor | ✅ 러너(빌더) |
| 8. 앱 ConsoleStore pending | 상태기계·SSE 매칭 | ✅ 러너(핵심) |
| 9. 앱 뷰 배선 | SwiftUI/AppKit UI | ❌ (swift build + 수동 실행) |

---

## Task 1: DispatchSource에 REMOTE_CONSOLE 추가

**Files:**
- Modify: `src/router/domain/idaeri-router.port.ts:40-44`

**Interfaces:**
- Produces: `DispatchSource` union에 `'REMOTE_CONSOLE'` 값. Task 4가 `dispatch({ source: 'REMOTE_CONSOLE', ... })`로 사용.

- [ ] **Step 1: union에 값 추가**

`src/router/domain/idaeri-router.port.ts`의 `DispatchSource`를 다음으로 교체:

```ts
export type DispatchSource =
  | 'SLACK_MESSAGE'
  | 'SLACK_COMMAND'
  | 'CRON'
  | 'WEBHOOK'
  | 'REMOTE_CONSOLE';
```

- [ ] **Step 2: 컴파일 확인**

Run: `pnpm build`
Expected: 타입 에러 없이 성공(union 확장은 기존 소비처에 안전).

- [ ] **Step 3: 커밋**

```bash
git add src/router/domain/idaeri-router.port.ts
git commit -m "feat(router): DispatchSource 에 REMOTE_CONSOLE 추가"
```

---

## Task 2: 콘솔 write용 env 2개 추가

**Files:**
- Modify: `src/config/app.config.ts` (EnvironmentVariables 클래스 끝, 라인 592 이전)
- Modify: `.env.example`, `.env`
- Modify: `README.md` (env 표)

**Interfaces:**
- Produces: `CONSOLE_OWNER_SLACK_USER_ID`(optional string), `CONSOLE_REMOTE_TOKEN`(optional string). Task 3/4가 `ConfigService.get(...)`로 읽음.

- [ ] **Step 1: app.config.ts에 필드 추가**

`src/config/app.config.ts`의 `SUBCONSCIOUS_PROMOTION_BUDGET_PER_HOUR` 필드 바로 뒤(클래스 닫는 `}` 앞)에 추가:

```ts
  // 콘솔 리모컨 write — 지시/승인 실행 주체 owner. 미설정 시 write 요청은 503(ServiceUnavailable).
  // 1인 봇이라 owner 는 항상 본인. ApplyPreviewUsecase 의 owner 매칭에 이 값을 slackUserId 로 주입.
  @IsOptional()
  @IsString()
  CONSOLE_OWNER_SLACK_USER_ID?: string;

  // 콘솔 리모컨 write 인증 토큰(선택). 설정 시 ConsoleWriteGuard 가 x-console-token 헤더를 검증.
  // 미설정 시 loopback 바인딩만으로 신뢰(부팅 시 경고). 앱은 env IDAERI_CONSOLE_TOKEN 으로 주입.
  @IsOptional()
  @IsString()
  CONSOLE_REMOTE_TOKEN?: string;
```

- [ ] **Step 2: .env.example / .env에 항목 추가**

두 파일 모두에 추가(값은 비워둠):

```
# 콘솔 리모컨(macOS 앱) write — 지시/승인 주체. 미설정 시 콘솔 write 비활성(503).
CONSOLE_OWNER_SLACK_USER_ID=
# 콘솔 리모컨 write 토큰(선택). 설정 시 x-console-token 헤더 검증.
CONSOLE_REMOTE_TOKEN=
```

- [ ] **Step 3: README env 표에 2줄 추가**

README의 환경변수 표에 `CONSOLE_OWNER_SLACK_USER_ID`(콘솔 리모컨 지시/승인 주체, 미설정 시 write 비활성), `CONSOLE_REMOTE_TOKEN`(콘솔 write 인증 토큰, 선택) 행을 추가.

- [ ] **Step 4: 부팅/빌드 확인**

Run: `pnpm build`
Expected: 성공. (선택) `pnpm start` 부팅 시 class-validator가 optional이라 미설정에도 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/config/app.config.ts .env.example .env README.md
git commit -m "feat(console): 리모컨 write env(owner/token) 추가"
```

---

## Task 3: ConsoleWriteGuard (loopback + 토큰)

**Files:**
- Create: `src/console/interface/console-write.guard.ts`
- Test: `src/console/interface/console-write.guard.spec.ts`

**Interfaces:**
- Produces: `ConsoleWriteGuard implements CanActivate`. `canActivate(context)`가 loopback 아니면 `ForbiddenException`, 토큰 설정+불일치면 `UnauthorizedException`, 그 외 `true`. Task 5가 `@UseGuards(ConsoleWriteGuard)`로 사용.
- Consumes: `ConfigService`(`CONSOLE_REMOTE_TOKEN`).

- [ ] **Step 1: 실패 테스트 작성**

Create `src/console/interface/console-write.guard.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { ConsoleWriteGuard } from './console-write.guard';

function contextWith(ip: string, headerToken?: string): ExecutionContext {
  const request = {
    ip,
    header: (name: string) =>
      name.toLowerCase() === 'x-console-token' ? headerToken : undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardWith(token?: string): ConsoleWriteGuard {
  const config = { get: (key: string) => (key === 'CONSOLE_REMOTE_TOKEN' ? token : undefined) };
  return new ConsoleWriteGuard(config as unknown as ConfigService);
}

describe('ConsoleWriteGuard', () => {
  it('loopback + 토큰 미설정이면 통과한다', () => {
    expect(guardWith(undefined).canActivate(contextWith('127.0.0.1'))).toBe(true);
  });

  it('loopback 이 아니면 ForbiddenException', () => {
    expect(() => guardWith(undefined).canActivate(contextWith('192.168.0.5'))).toThrow(
      ForbiddenException,
    );
  });

  it('토큰 설정 + 일치하면 통과한다', () => {
    expect(guardWith('secret').canActivate(contextWith('::1', 'secret'))).toBe(true);
  });

  it('토큰 설정 + 불일치면 UnauthorizedException', () => {
    expect(() => guardWith('secret').canActivate(contextWith('127.0.0.1', 'nope'))).toThrow(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec jest src/console/interface/console-write.guard.spec.ts`
Expected: FAIL — `Cannot find module './console-write.guard'`.

- [ ] **Step 3: 가드 구현**

Create `src/console/interface/console-write.guard.ts`:

```ts
import { timingSafeEqual } from 'crypto';

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

// 콘솔 리모컨 write 게이트. read 경로(ConsoleController/SSE)는 대상 아님.
// 1차 방어: loopback 바인딩(같은 머신만). 2차(선택): CONSOLE_REMOTE_TOKEN 헤더.
@Injectable()
export class ConsoleWriteGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!this.isLoopback(request.ip)) {
      throw new ForbiddenException('콘솔 write 는 localhost 에서만 허용됩니다.');
    }
    const expected = this.config.get<string>('CONSOLE_REMOTE_TOKEN');
    if (!expected) {
      return true;
    }
    const provided = request.header('x-console-token') ?? '';
    if (!this.safeEqual(provided, expected)) {
      throw new UnauthorizedException('콘솔 토큰이 유효하지 않습니다.');
    }
    return true;
  }

  private isLoopback(ip: string | undefined): boolean {
    if (!ip) {
      return false;
    }
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  }

  private safeEqual(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    if (bufferA.length !== bufferB.length) {
      return false;
    }
    return timingSafeEqual(bufferA, bufferB);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec jest src/console/interface/console-write.guard.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: lint + 커밋**

```bash
pnpm lint:check
git add src/console/interface/console-write.guard.ts src/console/interface/console-write.guard.spec.ts
git commit -m "feat(console): ConsoleWriteGuard(loopback+토큰) 추가"
```

---

## Task 4: ConsoleWriteService (owner 주입 · 위임 · fire-and-forget)

**Files:**
- Create: `src/console/application/console-write.service.ts`
- Test: `src/console/application/console-write.service.spec.ts`

**Interfaces:**
- Consumes: `ConfigService`(`CONSOLE_OWNER_SLACK_USER_ID`), `IDAERI_ROUTER_PORT`(`IdaeriRouterPort.dispatch`), `ApplyPreviewUsecase`, `CancelPreviewUsecase`.
- Produces:
  - `sendCommand(input: { text: string; agentTypeHint?: AgentType }): void` — dispatch를 await 없이 백그라운드 실행.
  - `applyApproval(previewId: string): Promise<void>`
  - `cancelApproval(previewId: string): Promise<void>`
  - owner 미설정 시 세 메서드 모두 `ServiceUnavailableException`.

- [ ] **Step 1: 실패 테스트 작성**

Create `src/console/application/console-write.service.spec.ts`:

```ts
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConsoleWriteService } from './console-write.service';

const OWNER = 'U_OWNER';

function makeService(owner?: string) {
  const config = {
    get: (key: string) => (key === 'CONSOLE_OWNER_SLACK_USER_ID' ? owner : undefined),
  } as unknown as ConfigService;
  const router = { dispatch: jest.fn() };
  const applyPreview = { execute: jest.fn().mockResolvedValue(undefined) };
  const cancelPreview = { execute: jest.fn().mockResolvedValue(undefined) };
  const service = new ConsoleWriteService(
    config,
    router as never,
    applyPreview as never,
    cancelPreview as never,
  );
  return { service, router, applyPreview, cancelPreview };
}

describe('ConsoleWriteService', () => {
  it('owner 설정 시 dispatch 를 REMOTE_CONSOLE source 로 위임한다', () => {
    const { service, router } = makeService(OWNER);
    router.dispatch.mockReturnValue(new Promise(() => {})); // 영원히 pending
    service.sendCommand({ text: '오늘 할 일 정리', agentTypeHint: 'PM' as never });
    expect(router.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'REMOTE_CONSOLE', slackUserId: OWNER, text: '오늘 할 일 정리', agentTypeHint: 'PM' }),
    );
  });

  it('sendCommand 는 dispatch 완료를 기다리지 않고 즉시 반환한다(fire-and-forget)', () => {
    const { service, router } = makeService(OWNER);
    router.dispatch.mockReturnValue(new Promise(() => {}));
    expect(() => service.sendCommand({ text: 'x' })).not.toThrow();
  });

  it('owner 미설정 시 sendCommand 는 ServiceUnavailableException', () => {
    const { service } = makeService(undefined);
    expect(() => service.sendCommand({ text: 'x' })).toThrow(ServiceUnavailableException);
  });

  it('applyApproval 은 owner 를 slackUserId 로 usecase 에 위임한다', async () => {
    const { service, applyPreview } = makeService(OWNER);
    await service.applyApproval('p1');
    expect(applyPreview.execute).toHaveBeenCalledWith({ previewId: 'p1', slackUserId: OWNER });
  });

  it('cancelApproval 은 owner 를 slackUserId 로 usecase 에 위임한다', async () => {
    const { service, cancelPreview } = makeService(OWNER);
    await service.cancelApproval('p2');
    expect(cancelPreview.execute).toHaveBeenCalledWith({ previewId: 'p2', slackUserId: OWNER });
  });

  it('owner 미설정 시 applyApproval 은 ServiceUnavailableException', async () => {
    const { service } = makeService(undefined);
    await expect(service.applyApproval('p1')).rejects.toThrow(ServiceUnavailableException);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm exec jest src/console/application/console-write.service.spec.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 서비스 구현**

Create `src/console/application/console-write.service.ts`:

```ts
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentType } from '../../model-router/domain/model-router.type';
import { ApplyPreviewUsecase } from '../../preview-gate/application/apply-preview.usecase';
import { CancelPreviewUsecase } from '../../preview-gate/application/cancel-preview.usecase';
import {
  IDAERI_ROUTER_PORT,
  IdaeriRouterPort,
} from '../../router/domain/idaeri-router.port';

// 콘솔 리모컨 write 위임 서비스. 새 로직 없이 owner 를 주입해 기존 usecase 로 넘긴다.
// 지시는 codex 지연(10~40s) 때문에 await 하지 않고 백그라운드 실행 → 진행은 SSE 로 반영.
@Injectable()
export class ConsoleWriteService {
  private readonly logger = new Logger(ConsoleWriteService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(IDAERI_ROUTER_PORT)
    private readonly router: IdaeriRouterPort,
    private readonly applyPreview: ApplyPreviewUsecase,
    private readonly cancelPreview: CancelPreviewUsecase,
  ) {}

  sendCommand(input: { text: string; agentTypeHint?: AgentType }): void {
    const slackUserId = this.requireOwner();
    void this.router
      .dispatch({
        source: 'REMOTE_CONSOLE',
        slackUserId,
        text: input.text,
        agentTypeHint: input.agentTypeHint,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `리모컨 지시 실패: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  async applyApproval(previewId: string): Promise<void> {
    const slackUserId = this.requireOwner();
    await this.applyPreview.execute({ previewId, slackUserId });
  }

  async cancelApproval(previewId: string): Promise<void> {
    const slackUserId = this.requireOwner();
    await this.cancelPreview.execute({ previewId, slackUserId });
  }

  private requireOwner(): string {
    const owner = this.config.get<string>('CONSOLE_OWNER_SLACK_USER_ID');
    if (!owner) {
      throw new ServiceUnavailableException(
        'CONSOLE_OWNER_SLACK_USER_ID 가 설정되지 않아 콘솔 지시/승인을 처리할 수 없습니다.',
      );
    }
    return owner;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm exec jest src/console/application/console-write.service.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: lint + 커밋**

```bash
pnpm lint:check
git add src/console/application/console-write.service.ts src/console/application/console-write.service.spec.ts
git commit -m "feat(console): ConsoleWriteService(owner 주입·위임·fire-and-forget) 추가"
```

---

## Task 5: DTO + ConsoleWriteController + 모듈 배선

**Files:**
- Create: `src/console/interface/dto/console-command.dto.ts`
- Create: `src/console/interface/console-write.controller.ts`
- Create: `src/console/interface/console-write.controller.spec.ts`
- Modify: `src/console/console.module.ts`

**Interfaces:**
- Consumes: `ConsoleWriteService`(Task 4), `ConsoleWriteGuard`(Task 3), `RouterModule`(`IDAERI_ROUTER_PORT` 제공).
- Produces: `POST /v1/console/command`(202 `{ accepted: true }`), `POST /v1/console/approvals/:id/apply`(200 `{ ok: true }`), `POST /v1/console/approvals/:id/cancel`(200 `{ ok: true }`).

**주의(순환 의존):** `ConsoleModule`이 `RouterModule`을 import한다. `RouterModule`이 `ConsoleModule`을 import하지 않는지 확인(현재 안 함). `ApplyPreviewUsecase`/`CancelPreviewUsecase`는 `PreviewGateModule.forRoot`가 global로 export하므로 별도 import 없이 주입된다 — 주입 실패(Nest DI 에러) 시에만 `ConsoleModule` imports에 해당 모듈을 추가한다.

- [ ] **Step 1: DTO 작성**

Create `src/console/interface/dto/console-command.dto.ts`:

```ts
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// 리모컨 자연어/힌트 지시 요청. agentTypeHint 는 문자열로 받고 service 에서 AgentType 으로 취급한다
// (미지 hint 는 dispatch 의 intent classifier 가 자연스럽게 걸러냄).
export class ConsoleCommandDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  agentTypeHint?: string;
}
```

- [ ] **Step 2: 컨트롤러 위임 테스트 작성**

Create `src/console/interface/console-write.controller.spec.ts`:

```ts
import { ConsoleWriteController } from './console-write.controller';
import { ConsoleWriteService } from '../application/console-write.service';

function makeController() {
  const service = {
    sendCommand: jest.fn(),
    applyApproval: jest.fn().mockResolvedValue(undefined),
    cancelApproval: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new ConsoleWriteController(service as unknown as ConsoleWriteService);
  return { controller, service };
}

describe('ConsoleWriteController', () => {
  it('command 는 service.sendCommand 위임 후 accepted 반환', () => {
    const { controller, service } = makeController();
    const result = controller.sendCommand({ text: '분배해줘', agentTypeHint: 'CTO' });
    expect(service.sendCommand).toHaveBeenCalledWith({ text: '분배해줘', agentTypeHint: 'CTO' });
    expect(result).toEqual({ accepted: true });
  });

  it('apply 는 service.applyApproval 위임', async () => {
    const { controller, service } = makeController();
    const result = await controller.apply('p1');
    expect(service.applyApproval).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ ok: true });
  });

  it('cancel 은 service.cancelApproval 위임', async () => {
    const { controller, service } = makeController();
    const result = await controller.cancel('p2');
    expect(service.cancelApproval).toHaveBeenCalledWith('p2');
    expect(result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm exec jest src/console/interface/console-write.controller.spec.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 4: 컨트롤러 구현**

Create `src/console/interface/console-write.controller.ts`:

```ts
import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import { ConsoleWriteService } from '../application/console-write.service';
import { ConsoleCommandDto } from './dto/console-command.dto';
import { ConsoleWriteGuard } from './console-write.guard';

// 콘솔 리모컨 write 표면 — 지시(fire-and-forget 202) + 승인/거절(await 200).
// 모든 경로는 ConsoleWriteGuard(loopback+토큰) 뒤에 있다.
@Controller('v1/console')
@UseGuards(ConsoleWriteGuard)
export class ConsoleWriteController {
  constructor(private readonly consoleWrite: ConsoleWriteService) {}

  @Post('command')
  @HttpCode(202)
  sendCommand(@Body() dto: ConsoleCommandDto): { accepted: true } {
    this.consoleWrite.sendCommand({
      text: dto.text,
      agentTypeHint: dto.agentTypeHint as AgentType | undefined,
    });
    return { accepted: true };
  }

  @Post('approvals/:id/apply')
  async apply(@Param('id') id: string): Promise<{ ok: true }> {
    await this.consoleWrite.applyApproval(id);
    return { ok: true };
  }

  @Post('approvals/:id/cancel')
  async cancel(@Param('id') id: string): Promise<{ ok: true }> {
    await this.consoleWrite.cancelApproval(id);
    return { ok: true };
  }
}
```

- [ ] **Step 5: 모듈 배선**

`src/console/console.module.ts`를 다음으로 교체:

```ts
import { Module } from '@nestjs/common';

import { AgentRunModule } from '../agent-run/agent-run.module';
import { RouterModule } from '../router/router.module';
import { ConsoleReadService } from './application/console-read.service';
import { ConsoleWriteService } from './application/console-write.service';
import { ConsoleController } from './interface/console.controller';
import { ConsoleStreamController } from './interface/console-stream.controller';
import { ConsoleWriteController } from './interface/console-write.controller';
import { ConsoleWriteGuard } from './interface/console-write.guard';

// 콘솔 관제 모듈 — 읽기(REST) + 실시간(SSE) + 리모컨 write(지시/승인).
// read 경로는 부작용 0. write 경로는 ConsoleWriteGuard 뒤에서 기존 usecase 에 위임한다.
// FindAllOpenPreviewsUsecase·ApplyPreviewUsecase·CancelPreviewUsecase 는 PreviewGateModule.forRoot(global) 가,
// ConsoleEventBus 는 ConsoleEventBusModule(@Global) 이, IDAERI_ROUTER_PORT 는 RouterModule 이 제공한다.
@Module({
  imports: [AgentRunModule, RouterModule],
  controllers: [ConsoleController, ConsoleStreamController, ConsoleWriteController],
  providers: [ConsoleReadService, ConsoleWriteService, ConsoleWriteGuard],
})
export class ConsoleModule {}
```

- [ ] **Step 6: 테스트 + 빌드 확인**

Run: `pnpm exec jest src/console/interface/console-write.controller.spec.ts && pnpm build`
Expected: 컨트롤러 3 tests PASS + 빌드 성공(DI 순환/미주입 없음). 빌드가 `IDAERI_ROUTER_PORT`/`ApplyPreviewUsecase` 주입 에러를 내면 위 "주의"대로 imports 보강.

- [ ] **Step 7: lint + 커밋**

```bash
pnpm lint:check
git add src/console/interface/dto/console-command.dto.ts src/console/interface/console-write.controller.ts src/console/interface/console-write.controller.spec.ts src/console/console.module.ts
git commit -m "feat(console): 리모컨 write 컨트롤러 3종 + 모듈 배선"
```

---

## Task 6: 앱 Models — CommandRequest + PendingCommand

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/Models.swift` (끝에 추가)

**Interfaces:**
- Produces:
  - `CommandRequest: Encodable { text: String; agentTypeHint: String? }` — Task 7이 body로 인코딩.
  - `PendingPhase: String enum { sent, running, done, failed }`.
  - `PendingCommand: Identifiable { id: UUID; text; agentTypeHint: String?; resolvedAgentType: String?; boundRunId: String?; sentAt: Date; phase: PendingPhase }` + `effectiveAgentType` 계산 프로퍼티. Task 8이 상태로, Task 9가 표시에 사용.

- [ ] **Step 1: Models.swift 끝에 타입 추가**

`clients/idaeri-console/Sources/ConsoleCore/Models.swift` 맨 끝에 추가:

```swift
/// 리모컨 지시 요청 body. 백엔드 `POST /v1/console/command` 계약(text + 선택 힌트).
public struct CommandRequest: Encodable, Sendable {
    public let text: String
    public let agentTypeHint: String?

    public init(text: String, agentTypeHint: String?) {
        self.text = text
        self.agentTypeHint = agentTypeHint
    }
}

/// 리모컨 명령의 낙관적 진행 단계.
public enum PendingPhase: String, Sendable, Equatable {
    case sent      // 전송·접수(202) — codex 준비 대기
    case running   // run.started 매칭됨
    case done      // run.finished 매칭됨(곧 제거)
    case failed    // 전송 실패 또는 타임아웃
}

/// 전송한 지시의 로컬 추적 항목. SSE run 이벤트로 phase 를 전이한다.
public struct PendingCommand: Identifiable, Sendable, Equatable {
    public let id: UUID
    public let text: String
    public let agentTypeHint: String?
    public var resolvedAgentType: String?
    public var boundRunId: String?
    public let sentAt: Date
    public var phase: PendingPhase

    public init(
        id: UUID,
        text: String,
        agentTypeHint: String?,
        resolvedAgentType: String? = nil,
        boundRunId: String? = nil,
        sentAt: Date,
        phase: PendingPhase
    ) {
        self.id = id
        self.text = text
        self.agentTypeHint = agentTypeHint
        self.resolvedAgentType = resolvedAgentType
        self.boundRunId = boundRunId
        self.sentAt = sentAt
        self.phase = phase
    }

    /// 카드 매칭용 — 확정된 agentType 우선, 없으면 최초 힌트.
    public var effectiveAgentType: String? { resolvedAgentType ?? agentTypeHint }
}
```

- [ ] **Step 2: 빌드 확인**

Run: `cd clients/idaeri-console && swift build`
Expected: 성공.

- [ ] **Step 3: 커밋**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/Models.swift
git commit -m "feat(console): 앱 CommandRequest·PendingCommand 모델 추가"
```

---

## Task 7: 앱 ConsoleClient — POST 메서드 + 순수 요청 빌더

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/ConsoleClient.swift`
- Create: `clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleClientTests.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift`

**Interfaces:**
- Consumes: `CommandRequest`(Task 6).
- Produces:
  - 순수 함수 `buildCommandRequest(baseURL:body:token:) throws -> URLRequest`, `buildApprovalRequest(baseURL:previewId:action:token:) -> URLRequest`.
  - actor 메서드 `postCommand(text:agentTypeHint:) async throws`, `applyApproval(id:) async throws`, `cancelApproval(id:) async throws`.
  - `ConsoleClient.init(baseURL:token:session:)` — token 파라미터 추가(기본 nil).

- [ ] **Step 1: 실패 테스트 작성**

Create `clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleClientTests.swift`:

```swift
import Foundation

@testable import ConsoleCore

/// POST 요청 빌더가 method/헤더/경로/body 를 계약대로 만드는지 검증(네트워크 없이 순수 함수).
func runConsoleClientTests(_ t: TestRunner) {
    t.suite("ConsoleClient")

    let base = URL(string: "http://127.0.0.1:3002")!

    // command: POST + JSON body + 토큰 헤더
    let commandRequest = try! buildCommandRequest(
        baseURL: base,
        body: CommandRequest(text: "오늘 계획", agentTypeHint: "PM"),
        token: "secret"
    )
    t.expectEqual(commandRequest.httpMethod, "POST", "command method")
    t.expectEqual(
        commandRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/command",
        "command 경로"
    )
    t.expectEqual(
        commandRequest.value(forHTTPHeaderField: "Content-Type"),
        "application/json",
        "command content-type"
    )
    t.expectEqual(
        commandRequest.value(forHTTPHeaderField: "x-console-token"),
        "secret",
        "command 토큰 헤더"
    )
    let decoded = try! JSONDecoder().decode(
        CommandRequestEcho.self,
        from: commandRequest.httpBody ?? Data()
    )
    t.expectEqual(decoded.text, "오늘 계획", "command body text")
    t.expectEqual(decoded.agentTypeHint, "PM", "command body hint")

    // 토큰 미설정이면 헤더 없음
    let noToken = try! buildCommandRequest(
        baseURL: base,
        body: CommandRequest(text: "x", agentTypeHint: nil),
        token: nil
    )
    t.expectNil(noToken.value(forHTTPHeaderField: "x-console-token"), "토큰 미설정 시 헤더 없음")

    // approval: 경로에 action 반영
    let applyRequest = buildApprovalRequest(baseURL: base, previewId: "p1", action: "apply", token: nil)
    t.expectEqual(applyRequest.httpMethod, "POST", "apply method")
    t.expectEqual(
        applyRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/approvals/p1/apply",
        "apply 경로"
    )
    let cancelRequest = buildApprovalRequest(baseURL: base, previewId: "p2", action: "cancel", token: nil)
    t.expectEqual(
        cancelRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/approvals/p2/cancel",
        "cancel 경로"
    )
}

/// 테스트 전용 — 인코딩된 body 를 되읽기 위한 미러 타입.
private struct CommandRequestEcho: Decodable {
    let text: String
    let agentTypeHint: String?
}
```

- [ ] **Step 2: main.swift에 스위트 등록**

`clients/idaeri-console/Sources/ConsoleCoreTests/main.swift`의 `runner.finish()` 앞에 한 줄 추가:

```swift
runConsoleClientTests(runner)
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd clients/idaeri-console && swift run ConsoleCoreTests`
Expected: 컴파일 실패 — `buildCommandRequest`/`buildApprovalRequest` 미정의.

- [ ] **Step 4: 빌더 + actor 메서드 구현**

`ConsoleClient.swift`에서 (a) 파일 상단(actor 밖, `parseSSELine` 근처)에 순수 빌더 2개 추가:

```swift
/// `POST /v1/console/command` 요청을 구성하는 순수 함수(테스트를 위해 actor 밖).
public func buildCommandRequest(
    baseURL: URL,
    body: CommandRequest,
    token: String?
) throws -> URLRequest {
    let url = baseURL.appendingPathComponent("v1/console/command")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token {
        request.setValue(token, forHTTPHeaderField: "x-console-token")
    }
    request.httpBody = try JSONEncoder().encode(body)
    return request
}

/// `POST /v1/console/approvals/:id/:action`(action = apply|cancel) 요청을 구성하는 순수 함수.
public func buildApprovalRequest(
    baseURL: URL,
    previewId: String,
    action: String,
    token: String?
) -> URLRequest {
    let url = baseURL
        .appendingPathComponent("v1/console/approvals")
        .appendingPathComponent(previewId)
        .appendingPathComponent(action)
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    if let token {
        request.setValue(token, forHTTPHeaderField: "x-console-token")
    }
    return request
}
```

(b) `ConsoleClient` actor에 `token` 저장 프로퍼티 + init 파라미터 추가, POST 메서드 추가:

```swift
public actor ConsoleClient {
    private let baseURL: URL
    private let token: String?
    private let session: URLSession

    public init(baseURL: URL, token: String? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }
```

그리고 `events()` 아래에 write 메서드 추가:

```swift
    /// `POST /v1/console/command` — 지시. 백엔드는 202 로 접수만 하고 진행은 SSE 로 온다.
    public func postCommand(text: String, agentTypeHint: String?) async throws {
        let request = try buildCommandRequest(
            baseURL: baseURL,
            body: CommandRequest(text: text, agentTypeHint: agentTypeHint),
            token: token
        )
        try await sendExpectingSuccess(request)
    }

    /// `POST /v1/console/approvals/:id/apply` — 승인.
    public func applyApproval(id: String) async throws {
        try await sendExpectingSuccess(
            buildApprovalRequest(baseURL: baseURL, previewId: id, action: "apply", token: token)
        )
    }

    /// `POST /v1/console/approvals/:id/cancel` — 거절.
    public func cancelApproval(id: String) async throws {
        try await sendExpectingSuccess(
            buildApprovalRequest(baseURL: baseURL, previewId: id, action: "cancel", token: token)
        )
    }

    private func sendExpectingSuccess(_ request: URLRequest) async throws {
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ConsoleClientError.notHTTP
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ConsoleClientError.badStatus(http.statusCode)
        }
    }
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd clients/idaeri-console && swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과` (ConsoleClient 스위트 포함).

- [ ] **Step 6: 커밋**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/ConsoleClient.swift clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleClientTests.swift clients/idaeri-console/Sources/ConsoleCoreTests/main.swift
git commit -m "feat(console): 앱 ConsoleClient POST(지시/승인/거절) + 요청 빌더"
```

---

## Task 8: 앱 ConsoleStore — pending 상태기계 + SSE 매칭

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/ConsoleStore.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleStoreTests.swift` (스위트 끝에 추가)

**Interfaces:**
- Consumes: `PendingCommand`/`PendingPhase`(Task 6), 기존 `ConsoleRun`/`ConsoleEvent`.
- Produces (ConsoleStore 신규 API):
  - `@Published private(set) var pendingCommands: [PendingCommand]`
  - `enqueueCommand(text:agentTypeHint:id:sentAt:) -> UUID`
  - `markCommandFailed(id: UUID)`, `removeCommand(id: UUID)`
  - `expireStalePendings(now:timeout:)`
  - `apply(event:)`가 `.runStarted`에서 미매칭 pending을 `.running`으로 바인딩, `.runFinished`에서 바인딩된 pending을 `.done`으로 전이.

- [ ] **Step 1: 실패 테스트 작성**

`ConsoleStoreTests.swift`의 `runConsoleStoreTests` 함수 맨 끝(마지막 `}` 앞)에 추가:

```swift
    // ===== pending 상태기계 =====
    let pendingStore = ConsoleStore()
    pendingStore.apply(snapshot: snapshot) // pm, be

    // enqueue → .sent
    let base = Date(timeIntervalSince1970: 1_000_000)
    let cmdId = pendingStore.enqueueCommand(text: "오늘 계획", agentTypeHint: "PM", sentAt: base)
    t.expectEqual(pendingStore.pendingCommands.count, 1, "pending 추가")
    t.expectEqual(pendingStore.pendingCommands.first?.phase, .sent, "초기 phase sent")

    // run.started(PM) → 힌트 일치 pending 을 .running 으로 바인딩
    let pmRun = ConsoleRun(id: "run-pm", agentType: "PM", status: "IN_PROGRESS", parentId: nil, startedAt: "t", finishedAt: nil)
    pendingStore.apply(event: .runStarted(pmRun))
    t.expectEqual(pendingStore.pendingCommands.first?.phase, .running, "sent→running")
    t.expectEqual(pendingStore.pendingCommands.first?.boundRunId, "run-pm", "runId 바인딩")
    t.expectEqual(pendingStore.pendingCommands.first?.resolvedAgentType, "PM", "resolvedAgentType 확정")

    // run.finished(같은 run) → .done
    let pmDone = ConsoleRun(id: "run-pm", agentType: "PM", status: "SUCCEEDED", parentId: nil, startedAt: "t", finishedAt: "t2")
    pendingStore.apply(event: .runFinished(pmDone))
    t.expectEqual(pendingStore.pendingCommands.first?.phase, .done, "running→done")

    // 힌트 없는 전역 명령 → run.started 의 agentType 으로 카드 확정
    let globalStore = ConsoleStore()
    let gid = globalStore.enqueueCommand(text: "리뷰 좀", agentTypeHint: nil, sentAt: base)
    let beRun = ConsoleRun(id: "run-be", agentType: "BE", status: "IN_PROGRESS", parentId: nil, startedAt: "t", finishedAt: nil)
    globalStore.apply(event: .runStarted(beRun))
    t.expectEqual(globalStore.pendingCommands.first?.resolvedAgentType, "BE", "전역→카드 이동")
    t.expectEqual(globalStore.pendingCommands.first?.effectiveAgentType, "BE", "effectiveAgentType")
    _ = gid

    // 다발: 힌트 PM 2개 + run.started PM 1개 → 가장 오래된 것만 바인딩
    let multiStore = ConsoleStore()
    let older = multiStore.enqueueCommand(text: "a", agentTypeHint: "PM", sentAt: base)
    let newer = multiStore.enqueueCommand(text: "b", agentTypeHint: "PM", sentAt: base.addingTimeInterval(10))
    multiStore.apply(event: .runStarted(ConsoleRun(id: "r", agentType: "PM", status: "IN_PROGRESS", parentId: nil, startedAt: "t", finishedAt: nil)))
    t.expectEqual(multiStore.pendingCommands.first(where: { $0.id == older })?.phase, .running, "오래된 것 바인딩")
    t.expectEqual(multiStore.pendingCommands.first(where: { $0.id == newer })?.phase, .sent, "새 것 미바인딩 유지")

    // 타임아웃: 60초 이상 .sent → .failed
    let timeoutStore = ConsoleStore()
    let tid = timeoutStore.enqueueCommand(text: "x", agentTypeHint: "PM", sentAt: base)
    timeoutStore.expireStalePendings(now: base.addingTimeInterval(61), timeout: 60)
    t.expectEqual(timeoutStore.pendingCommands.first?.phase, .failed, "타임아웃 → failed")

    // markCommandFailed / removeCommand
    let opStore = ConsoleStore()
    let oid = opStore.enqueueCommand(text: "y", agentTypeHint: nil, sentAt: base)
    opStore.markCommandFailed(id: oid)
    t.expectEqual(opStore.pendingCommands.first?.phase, .failed, "markCommandFailed")
    opStore.removeCommand(id: oid)
    t.expectEqual(opStore.pendingCommands.count, 0, "removeCommand")

    // 매칭 안 되는 run.started(힌트 다르고 힌트없음 없음) → pending 불변
    let noMatchStore = ConsoleStore()
    _ = noMatchStore.enqueueCommand(text: "z", agentTypeHint: "PM", sentAt: base)
    noMatchStore.apply(event: .runStarted(ConsoleRun(id: "r2", agentType: "BE", status: "IN_PROGRESS", parentId: nil, startedAt: "t", finishedAt: nil)))
    t.expectEqual(noMatchStore.pendingCommands.first?.phase, .sent, "미매칭 시 sent 유지")
    _ = tid
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd clients/idaeri-console && swift run ConsoleCoreTests`
Expected: 컴파일 실패 — `pendingCommands`/`enqueueCommand` 등 미정의.

- [ ] **Step 3: ConsoleStore 확장 구현**

`ConsoleStore.swift`에서 (a) `@Published` 프로퍼티 4개 아래에 추가:

```swift
    @Published public private(set) var pendingCommands: [PendingCommand] = []
```

(b) `apply(event:)`의 `.runStarted`/`.runFinished` case를 다음으로 교체:

```swift
        case let .runStarted(run):
            upsertRun(run)
            bindPendingOnRunStarted(run)
        case let .runFinished(run):
            upsertRun(run)
            completePendingOnRunFinished(run)
```

(c) 파일 끝(클래스 닫는 `}` 앞)에 pending 메서드 추가:

```swift
    /// 낙관적 지시 추가. 반환한 id 로 뷰가 client POST 후 실패 시 markCommandFailed 를 호출한다.
    @discardableResult
    public func enqueueCommand(
        text: String,
        agentTypeHint: String?,
        id: UUID = UUID(),
        sentAt: Date = Date()
    ) -> UUID {
        pendingCommands.append(
            PendingCommand(id: id, text: text, agentTypeHint: agentTypeHint, sentAt: sentAt, phase: .sent)
        )
        return id
    }

    /// 전송 실패(네트워크/4xx) 처리.
    public func markCommandFailed(id: UUID) {
        guard let index = pendingCommands.firstIndex(where: { $0.id == id }) else {
            return
        }
        pendingCommands[index].phase = .failed
    }

    /// pending 제거(완료 후 뷰 타이머 또는 사용자 dismiss).
    public func removeCommand(id: UUID) {
        pendingCommands.removeAll { $0.id == id }
    }

    /// timeout 초 이상 .sent 로 남은 pending 을 .failed 로 강등(codex 무응답 감지). 뷰 타이머가 주기 호출.
    public func expireStalePendings(now: Date = Date(), timeout: TimeInterval = 60) {
        for index in pendingCommands.indices where pendingCommands[index].phase == .sent {
            if now.timeIntervalSince(pendingCommands[index].sentAt) >= timeout {
                pendingCommands[index].phase = .failed
            }
        }
    }

    /// run.started 를 미매칭 pending 에 바인딩. 힌트 일치 우선, 없으면 힌트 없는(전역) 가장 오래된 .sent.
    private func bindPendingOnRunStarted(_ run: ConsoleRun) {
        let unbound = pendingCommands.indices
            .filter { pendingCommands[$0].phase == .sent && pendingCommands[$0].boundRunId == nil }
            .sorted { pendingCommands[$0].sentAt < pendingCommands[$1].sentAt }
        let matched = unbound.first { pendingCommands[$0].agentTypeHint == run.agentType }
            ?? unbound.first { pendingCommands[$0].agentTypeHint == nil }
        guard let index = matched else {
            return
        }
        pendingCommands[index].boundRunId = run.id
        pendingCommands[index].resolvedAgentType = run.agentType
        pendingCommands[index].phase = .running
    }

    /// 바인딩된 run 이 끝나면 해당 pending 을 .done 으로. 제거는 뷰가 관장(완료 표시 후 removeCommand).
    private func completePendingOnRunFinished(_ run: ConsoleRun) {
        guard let index = pendingCommands.firstIndex(where: { $0.boundRunId == run.id }) else {
            return
        }
        pendingCommands[index].phase = .done
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd clients/idaeri-console && swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과`.

- [ ] **Step 5: 커밋**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/ConsoleStore.swift clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleStoreTests.swift
git commit -m "feat(console): 앱 ConsoleStore pending 상태기계 + SSE 매칭"
```

---

## Task 9: 앱 뷰 배선 — 커맨드바 · 지시 버튼 · 승인 버튼

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/AppRootView.swift` (client POST 배선 + pending 타이머)
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/DashboardView.swift` (커맨드바 + approvalPanel 버튼)
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/AgentCardView.swift` (지시 버튼 + 시트)
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/main.swift` (token 주입)

**Interfaces:**
- Consumes: `ConsoleStore`의 `enqueueCommand`/`markCommandFailed`/`removeCommand`/`expireStalePendings`/`pendingCommands`(Task 8), `ConsoleClient.postCommand`/`applyApproval`/`cancelApproval`(Task 7).

**참고:** UI 계층이라 자동 테스트 없음. `swift build` 성공 + 실제 실행(수동)으로 검증한다. 상태 로직은 Task 8에서 이미 커버됨.

- [ ] **Step 1: main.swift에서 token 주입**

`main.swift`의 `ConsoleClient(baseURL:...)` 생성부를 찾아 token 파라미터 추가:

```swift
let token = ProcessInfo.processInfo.environment["IDAERI_CONSOLE_TOKEN"]
let client = ConsoleClient(baseURL: baseURL, token: token)
```

- [ ] **Step 2: AppRootView에 write 배선 + pending 타이머 추가**

`AppRootView`에 client를 사용하는 액션 메서드와 주기 타이머를 추가:

```swift
    /// 지시 전송 — 낙관적 pending 후 POST, 실패 시 롤백 표시.
    func sendCommand(text: String, agentTypeHint: String?) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let id = store.enqueueCommand(text: trimmed, agentTypeHint: agentTypeHint)
        Task {
            do {
                try await client.postCommand(text: trimmed, agentTypeHint: agentTypeHint)
            } catch {
                await MainActor.run { store.markCommandFailed(id: id) }
            }
        }
    }

    func approve(id: String) {
        Task { try? await client.applyApproval(id: id) }
    }

    func reject(id: String) {
        Task { try? await client.cancelApproval(id: id) }
    }
```

그리고 `connect()` 근처(뷰 `.onAppear` 또는 `.task`)에 pending 정리 타이머를 건다. 5초 주기로 `expireStalePendings()`를 호출하고, `.done` 상태가 2초 이상이면 `removeCommand`:

```swift
    /// pending 유지보수 루프 — 타임아웃 강등 + 완료건 정리. 뷰 lifetime 동안 5초 주기.
    func startPendingJanitor() {
        Task { @MainActor in
            while !Task.isCancelled {
                store.expireStalePendings()
                for command in store.pendingCommands where command.phase == .done {
                    store.removeCommand(id: command.id)
                }
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }
```

`connect()`를 호출하는 자리에서 `startPendingJanitor()`도 함께 호출한다.

- [ ] **Step 3: DashboardView에 커맨드바 + 승인 버튼 추가**

(a) `DashboardView` 상단(헤더 아래)에 전역 커맨드 바를 추가한다. `@State private var commandText = ""`를 두고, `TextField`("에이전트에게 지시…") + 전송 `Button`이 `onSend(commandText, nil)` 클로저를 호출하도록 한다(전송 후 `commandText = ""`). `DashboardView`에 `let onSend: (String, String?) -> Void`, `let onApprove: (String) -> Void`, `let onReject: (String) -> Void` 프로퍼티를 추가하고 `AppRootView`에서 위 메서드를 주입한다.

(b) approvalPanel의 각 승인 행(현재 제목·시각만 표시, `DashboardView.swift:117-131`)에 승인/거절 버튼을 추가:

```swift
HStack {
    Button("승인") { onApprove(approval.id) }
    Button("거절") { onReject(approval.id) }
}
```

(c) 진행 중 pending을 헤더 근처에 표시(전역/미확정 힌트 명령): `store.pendingCommands`를 순회해 `phase`별 배지(전송됨 ⏳ / 진행중 🔄 / 실패 ⚠️)를 보여준다.

- [ ] **Step 4: AgentCardView에 지시 버튼 + 시트 추가**

`AgentCardView`에 `let onSend: (String, String?) -> Void`를 추가하고, 카드에 "지시" 버튼을 둔다. 버튼은 `@State private var showSheet`를 토글해 텍스트 입력 시트를 띄우고, 전송 시 `onSend(inputText, agent.agentType)`(해당 에이전트를 힌트로 고정)를 호출한다. 카드에 자신의 `effectiveAgentType == agent.agentType`인 pending이 있으면 phase 배지를 카드에 표시한다.

- [ ] **Step 5: 빌드 + 수동 실행 확인**

Run: `cd clients/idaeri-console && swift build`
Expected: 성공.

수동 검증(백엔드 실행 + `CONSOLE_OWNER_SLACK_USER_ID` 설정 상태에서):
- `swift run IdaeriConsole` → 커맨드바에 "PM 오늘 계획" 입력·전송 → PM 카드에 전송됨 ⏳ → (codex 후) 진행중 🔄 → 완료 후 배지 사라짐.
- 승인 대기 카드에서 승인/거절 클릭 → 목록에서 사라짐.

- [ ] **Step 6: 전체 게이트 + 커밋**

```bash
pnpm lint:check && pnpm test && pnpm build
cd clients/idaeri-console && swift run ConsoleCoreTests && swift build && cd ../..
git add clients/idaeri-console/Sources/IdaeriConsole/
git commit -m "feat(console): 앱 리모컨 UI(커맨드바·지시버튼·승인버튼) 배선"
```

---

## Self-Review 결과

**Spec 커버리지:** spec §5(백엔드: 모듈/엔드포인트/가드/owner/env/DispatchSource) → Task 1~5. spec §6(앱 3계층) → Task 6~9. spec §7(pending 상태기계) → Task 8. spec §9(테스트) → 각 Task의 TDD step + Task 9 수동. spec §5.2의 fire-and-forget → Task 4 테스트로 명시 검증. **spec §5.5의 ResponseCode 추가는 의도적으로 제외** — 승인 예외는 기존 `PreviewActionException` + `AllExceptionsFilter`가 처리하고, owner 미설정은 `ServiceUnavailableException`으로 충분(YAGNI). spec을 이 결정으로 갱신 필요(구현 시 spec §5.5 각주 수정).

**Placeholder 스캔:** "적절히 처리" 류 없음. 모든 코드 스텝에 실제 코드 포함. Task 9만 UI 서술형(자동 테스트 불가 영역, swift build+수동으로 대체) — 상태 로직은 Task 8이 커버.

**타입 일관성:** `enqueueCommand`(Task 8) ↔ 테스트/뷰 호출 시그니처 일치. `buildCommandRequest`/`buildApprovalRequest`(Task 7) ↔ 테스트 일치. `sendCommand`/`applyApproval`/`cancelApproval`이 service(Task 4)·controller(Task 5)·client(Task 7)에서 이름 일관. `PendingPhase` 값(sent/running/done/failed)이 Task 6 정의 ↔ Task 8 사용 일치.
