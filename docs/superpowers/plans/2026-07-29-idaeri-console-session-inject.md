# 이대리 콘솔 Phase 2 — 로컬 세션 inject 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이대리 macOS 콘솔 앱에서 내 로컬 Claude/Codex 세션 하나를 골라 작업 텍스트를 주입하면, 그 세션이 다음 턴을 끝낼 때 이대리 자체 Stop 훅이 지시를 이어받게 한다.

**Architecture:** mds(`~/Desktop/backend/기타/my-desktop`)가 검증한 inject 계약(pid로 키잉한 파일 큐 + 동기 Stop 훅 + `decision:block`)의 순수 로직을 이대리로 이식한다. 백엔드는 `POST /v1/console/sessions/:sessionId/inject`로 sessionId→(pid,source)를 확인하고 `~/.idaeri/inject/<pid>/`에 지시 파일 1건을 쓴다. 이대리 자체 Stop 훅이 그 파일을 consume해 stdout으로 `{decision:'block',reason}`을 낸다. 전달은 동기가 아니라 "대상 세션의 다음 Stop" 시점이다.

**Tech Stack:** NestJS 10 · TypeScript(CommonJS) · Prisma(무관) · Node fs · Swift(SwiftPM, CLT) · Jest · ts-node(scripts)

**설계 문서:** [2026-07-29-idaeri-console-session-inject-design.md](../specs/2026-07-29-idaeri-console-session-inject-design.md)

## Global Constraints

- 패키지 매니저 `pnpm@9.15.9` 고정. `npm`/`yarn` 금지.
- **커밋은 사용자 명시 승인 후에만**(레포 CLAUDE.md §2 #1). 아래 각 태스크의 "Commit" 스텝은 원자 경계를 표시할 뿐, 실제 커밋은 사용자 승인 시 수행한다.
- **3중 게이트 green 필수**: `pnpm lint:check && pnpm test && pnpm build`. Swift는 `swift build` + `swift run ConsoleCoreTests`.
- **단일 파일 jest는 `pnpm exec jest <경로>`** — `pnpm test`는 jest를 2회 실행해 경로 필터가 안 먹는다(전체가 돎).
- **CODE_RULES**: 모든 `if`에 중괄호. 줄임말 금지(`error`/`found`/`record`/`request`, `err`/`existing`/`rec`/`req` 금지). 인라인 반환 타입 금지(별도 type 추출). try-catch 내 `return await`.
- **process.env 직접 참조 금지** → 주입 토큰/기본값 함수. 파일 경로는 `os.homedir()` 기반(이건 process.env가 아니라 허용).
- **NestJS 생성자에 원시/객체 타입 default 금지**(reflection이 Number/Object provider로 오인) → `@Inject(TOKEN)` 명시.
- **신규 env 0.** injectDir는 `os.homedir()/.idaeri/inject` 상수(주입 토큰으로만 override).
- **base 브랜치 main**(4dc242d, session-catch 병합됨). 구현은 **ASCII 경로 worktree**에서(예: `~/worktrees/idaeri-console-inject`) — 한글 "기타" 경로는 codex/worktree 이슈 유발.

## File Structure

**백엔드 신규**
- `src/local-sessions/domain/inject-queue.ts` — `enqueueInject`/`consumeInject`(fs deps 주입, 순수)
- `src/local-sessions/domain/inject-queue.spec.ts`
- `src/local-sessions/domain/stop-decision.ts` — `buildStopDecision`(순수)
- `src/local-sessions/domain/stop-decision.spec.ts`
- `src/local-sessions/domain/inject-hook-install.ts` — `installInjectHooks`/`uninstallInjectHooks`(fs deps 주입, 순수)
- `src/local-sessions/domain/inject-hook-install.spec.ts`
- `src/local-sessions/application/session-inject.service.ts` — sessionId→(pid,source) 확인 + enqueue
- `src/local-sessions/application/session-inject.service.spec.ts`
- `src/local-sessions/infrastructure/inject-hook.entry.ts` — 독립 실행 Stop 훅 entry(얇음)
- `src/console/interface/dto/session-inject.dto.ts` — `{ text }`
- `scripts/console-hooks.ts` — 설치/제거 CLI(실 fs wiring)

**백엔드 수정**
- `src/local-sessions/local-sessions.module.ts` — `SessionInjectService` + `INJECT_ENQUEUE_DEPS` provider 추가·export
- `src/console/interface/console-write.controller.ts` — inject 라우트 추가
- `src/console/interface/console-write.controller.spec.ts` — inject 케이스 추가
- `package.json` — `console:install-hooks`/`console:uninstall-hooks` 스크립트

**Swift 신규/수정** (`clients/idaeri-console`)
- `Sources/ConsoleCore/Models.swift` — `InjectRequestBody` 추가
- `Sources/ConsoleCore/ConsoleClient.swift` — `buildInjectRequest`·`injectOutcome`·`postInject` 추가
- `Sources/ConsoleCoreTests/ConsoleClientTests.swift` — inject 케이스 추가
- `Sources/IdaeriConsole/SessionRowView.swift` — "작업 주입" 버튼
- 세션 시트 배선(뷰 소유자, 아래 Task 9)

---

## Task 1: inject 파일 큐 도메인 (enqueue/consume)

**Files:**
- Create: `src/local-sessions/domain/inject-queue.ts`
- Test: `src/local-sessions/domain/inject-queue.spec.ts`

**Interfaces:**
- Consumes: 없음(순수 도메인).
- Produces:
  - `interface EnqueueDeps { injectDir: string; now: () => number; seq: () => string; mkdir: (dir: string) => void; writeFile: (path: string, data: string) => void; }`
  - `interface ConsumeDeps { injectDir: string; readdir: (dir: string) => string[]; readFile: (path: string) => string | null; removeFile: (path: string) => void; rmdir: (dir: string) => void; }`
  - `interface InjectRecordInput { instruction: string; sessionId: string; source: 'claude' | 'codex'; }`
  - `function enqueueInject(pid: number, record: InjectRecordInput, deps: EnqueueDeps): void`
  - `function consumeInject(pid: number, sessionId: string, deps: ConsumeDeps): string | null`

- [ ] **Step 1: 실패 테스트 작성**

`src/local-sessions/domain/inject-queue.spec.ts`:

```ts
import { enqueueInject, consumeInject } from './inject-queue';
import type { EnqueueDeps, ConsumeDeps } from './inject-queue';

function memoryFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const enqueue: EnqueueDeps = {
    injectDir: '/q',
    now: () => 1000,
    seq: (() => {
      let n = 0;
      return () => String(n++);
    })(),
    mkdir: (dir) => {
      dirs.add(dir);
    },
    writeFile: (path, data) => {
      files.set(path, data);
    },
  };
  const consume: ConsumeDeps = {
    injectDir: '/q',
    readdir: (dir) => {
      const prefix = `${dir}/`;
      return [...files.keys()]
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length));
    },
    readFile: (path) => files.get(path) ?? null,
    removeFile: (path) => {
      files.delete(path);
    },
    rmdir: (dir) => {
      dirs.delete(dir);
    },
  };
  return { files, dirs, enqueue, consume };
}

describe('inject-queue', () => {
  it('enqueue 후 같은 sessionId 로 consume 하면 지시 반환', () => {
    const fs = memoryFs();
    enqueueInject(
      4242,
      { instruction: '테스트 고쳐', sessionId: 's1', source: 'claude' },
      fs.enqueue,
    );
    const result = consumeInject(4242, 's1', fs.consume);
    expect(result).toBe('테스트 고쳐');
  });

  it('consume 는 once — 두 번째 호출은 null', () => {
    const fs = memoryFs();
    enqueueInject(
      4242,
      { instruction: '한 번만', sessionId: 's1', source: 'claude' },
      fs.enqueue,
    );
    expect(consumeInject(4242, 's1', fs.consume)).toBe('한 번만');
    expect(consumeInject(4242, 's1', fs.consume)).toBeNull();
  });

  it('sessionId 불일치 항목은 전달 안 하고 정리', () => {
    const fs = memoryFs();
    enqueueInject(
      4242,
      { instruction: '남의 것', sessionId: 'other', source: 'claude' },
      fs.enqueue,
    );
    expect(consumeInject(4242, 's1', fs.consume)).toBeNull();
    expect(fs.files.size).toBe(0);
  });

  it('잘못된 pid/빈 instruction 은 조용히 무시', () => {
    const fs = memoryFs();
    enqueueInject(
      0,
      { instruction: 'x', sessionId: 's1', source: 'claude' },
      fs.enqueue,
    );
    enqueueInject(
      4242,
      { instruction: '', sessionId: 's1', source: 'claude' },
      fs.enqueue,
    );
    expect(fs.files.size).toBe(0);
  });

  it('오래된 항목부터 FIFO 로 consume', () => {
    const fs = memoryFs();
    enqueueInject(
      4242,
      { instruction: '먼저', sessionId: 's1', source: 'claude' },
      fs.enqueue,
    );
    enqueueInject(
      4242,
      { instruction: '나중', sessionId: 's1', source: 'claude' },
      fs.enqueue,
    );
    expect(consumeInject(4242, 's1', fs.consume)).toBe('먼저');
    expect(consumeInject(4242, 's1', fs.consume)).toBe('나중');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec jest src/local-sessions/domain/inject-queue.spec.ts`
Expected: FAIL (`Cannot find module './inject-queue'`)

- [ ] **Step 3: 구현**

`src/local-sessions/domain/inject-queue.ts`:

```ts
import { join } from 'node:path';

export interface EnqueueDeps {
  readonly injectDir: string;
  readonly now: () => number;
  readonly seq: () => string;
  readonly mkdir: (dir: string) => void;
  readonly writeFile: (path: string, data: string) => void;
}

export interface ConsumeDeps {
  readonly injectDir: string;
  readonly readdir: (dir: string) => string[];
  readonly readFile: (path: string) => string | null;
  readonly removeFile: (path: string) => void;
  readonly rmdir: (dir: string) => void;
}

export interface InjectRecordInput {
  readonly instruction: string;
  readonly sessionId: string;
  readonly source: 'claude' | 'codex';
}

interface StoredRecord {
  readonly instruction: string;
  readonly sessionId: string;
  readonly source: 'claude' | 'codex';
  readonly enqueuedAt: number;
}

// pid 로 키잉한 파일 큐에 지시 1건을 기록한다. 지시 1건=파일 1개라 백엔드 쓰기와
// 훅 consume 이 공유 파일 RMW 경쟁을 하지 않는다. 잘못된 입력은 조용히 무시(무해).
export function enqueueInject(
  pid: number,
  record: InjectRecordInput,
  deps: EnqueueDeps,
): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return;
  }
  if (typeof record.instruction !== 'string' || record.instruction.length === 0) {
    return;
  }
  if (typeof record.sessionId !== 'string' || record.sessionId.length === 0) {
    return;
  }
  const dir = join(deps.injectDir, String(pid));
  deps.mkdir(dir);
  const enqueuedAt = deps.now();
  const stored: StoredRecord = {
    instruction: record.instruction,
    sessionId: record.sessionId,
    source: record.source,
    enqueuedAt,
  };
  deps.writeFile(join(dir, `${enqueuedAt}-${deps.seq()}.json`), JSON.stringify(stored));
}

// pid 큐에서 가장 오래된 sessionId 일치 항목 1건을 consume-once 로 반환한다.
// 불일치/오염 항목은 정리(같은 pid 를 쓰는 살아있는 세션은 유일하므로 죽은 소유자 것 = 삭제 안전).
// 삭제에 실패하면 그 항목은 전달하지 않는다(재전달 루프 방지).
export function consumeInject(
  pid: number,
  sessionId: string,
  deps: ConsumeDeps,
): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return null;
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return null;
  }
  const dir = join(deps.injectDir, String(pid));
  let files: string[];
  try {
    files = deps.readdir(dir);
  } catch {
    return null;
  }
  const jsonFiles = files.filter((file) => file.endsWith('.json')).sort();
  let delivered: string | null = null;
  for (const file of jsonFiles) {
    const fullPath = join(dir, file);
    const raw = deps.readFile(fullPath);
    let parsed: unknown = null;
    if (raw !== null) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    const stored = parsed as { instruction?: unknown; sessionId?: unknown } | null;
    const corrupt = stored === null || typeof stored.instruction !== 'string';
    const mismatch = !corrupt && stored!.sessionId !== sessionId;
    if (corrupt || mismatch) {
      try {
        deps.removeFile(fullPath);
      } catch {
        // 정리 실패는 무해.
      }
      continue;
    }
    try {
      deps.removeFile(fullPath);
    } catch {
      continue;
    }
    delivered = stored!.instruction as string;
    break;
  }
  try {
    deps.rmdir(dir);
  } catch {
    // 비어있지 않으면 실패 — 무해.
  }
  return delivered;
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm exec jest src/local-sessions/domain/inject-queue.spec.ts`
Expected: PASS (5건)

- [ ] **Step 5: Commit**

```bash
git add src/local-sessions/domain/inject-queue.ts src/local-sessions/domain/inject-queue.spec.ts
git commit -m "feat(local-sessions): inject 파일 큐 도메인(enqueue/consume) 이식"
```

---

## Task 2: Stop 훅 결정 로직 (buildStopDecision)

**Files:**
- Create: `src/local-sessions/domain/stop-decision.ts`
- Test: `src/local-sessions/domain/stop-decision.spec.ts`

**Interfaces:**
- Consumes: 없음(순수. consume 함수는 인자로 주입받음).
- Produces: `function buildStopDecision(payloadRaw: string | null, ppid: number, consume: (pid: number, sessionId: string) => string | null): string`

- [ ] **Step 1: 실패 테스트 작성**

`src/local-sessions/domain/stop-decision.spec.ts`:

```ts
import { buildStopDecision } from './stop-decision';

describe('buildStopDecision', () => {
  it('지시가 있으면 decision:block JSON 반환', () => {
    const out = buildStopDecision(
      JSON.stringify({ session_id: 's1' }),
      4242,
      (pid, sessionId) => (pid === 4242 && sessionId === 's1' ? '고쳐줘' : null),
    );
    expect(JSON.parse(out)).toEqual({ decision: 'block', reason: '고쳐줘' });
  });

  it('지시가 없으면 빈 문자열(정상 종료 허용)', () => {
    const out = buildStopDecision(
      JSON.stringify({ session_id: 's1' }),
      4242,
      () => null,
    );
    expect(out).toBe('');
  });

  it('payload 없음/빈 값이면 빈 문자열', () => {
    expect(buildStopDecision(null, 4242, () => 'x')).toBe('');
    expect(buildStopDecision('   ', 4242, () => 'x')).toBe('');
  });

  it('session_id 없으면 빈 문자열', () => {
    expect(buildStopDecision(JSON.stringify({}), 4242, () => 'x')).toBe('');
  });

  it('잘못된 ppid 면 빈 문자열', () => {
    expect(buildStopDecision(JSON.stringify({ session_id: 's1' }), 0, () => 'x')).toBe('');
  });

  it('consume 가 throw 해도 빈 문자열(세션을 멈추지 않는다)', () => {
    const out = buildStopDecision(JSON.stringify({ session_id: 's1' }), 4242, () => {
      throw new Error('boom');
    });
    expect(out).toBe('');
  });

  it('깨진 JSON payload 면 빈 문자열', () => {
    expect(buildStopDecision('{not json', 4242, () => 'x')).toBe('');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec jest src/local-sessions/domain/stop-decision.spec.ts`
Expected: FAIL (`Cannot find module './stop-decision'`)

- [ ] **Step 3: 구현**

`src/local-sessions/domain/stop-decision.ts`:

```ts
// Stop 훅 결정 로직(순수). payload 에서 session_id 를 뽑아 consume 하고, 전달할 지시가
// 있으면 decision:block JSON 을, 없으면(또는 어떤 오류든) 빈 문자열을 반환한다.
// 빈 문자열 = 정상 종료 허용. 우리 버그로 세션을 멈추지 않기 위해 전 구간 try/catch.
export function buildStopDecision(
  payloadRaw: string | null,
  ppid: number,
  consume: (pid: number, sessionId: string) => string | null,
): string {
  try {
    if (payloadRaw === null || payloadRaw.trim().length === 0) {
      return '';
    }
    const payload = JSON.parse(payloadRaw) as { session_id?: unknown };
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
    if (sessionId.length === 0) {
      return '';
    }
    if (!Number.isSafeInteger(ppid) || ppid <= 0) {
      return '';
    }
    const instruction = consume(ppid, sessionId);
    if (instruction === null || instruction.length === 0) {
      return '';
    }
    return JSON.stringify({ decision: 'block', reason: instruction });
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm exec jest src/local-sessions/domain/stop-decision.spec.ts`
Expected: PASS (7건)

- [ ] **Step 5: Commit**

```bash
git add src/local-sessions/domain/stop-decision.ts src/local-sessions/domain/stop-decision.spec.ts
git commit -m "feat(local-sessions): Stop 훅 decision:block 결정 로직 이식"
```

---

## Task 3: Stop 훅 설치/제거 도메인

**Files:**
- Create: `src/local-sessions/domain/inject-hook-install.ts`
- Test: `src/local-sessions/domain/inject-hook-install.spec.ts`

**Interfaces:**
- Consumes: 없음(순수. json 읽기/쓰기는 deps 주입).
- Produces:
  - `const INJECT_HOOK_MARKER = 'inject-hook.entry'`(stopHookCommand 에 반드시 포함되는 substring)
  - `interface HookFsDeps { readJson: (path: string) => Record<string, unknown>; writeJson: (path: string, data: unknown) => void; }`
  - `interface HookInstallOptions { claudeSettingsPath: string; codexHooksPath: string; stopHookCommand: string; }`
  - `function installInjectHooks(options: HookInstallOptions, deps: HookFsDeps): { changed: string[] }`
  - `function uninstallInjectHooks(options: Omit<HookInstallOptions, 'stopHookCommand'>, deps: HookFsDeps): { changed: string[] }`

- [ ] **Step 1: 실패 테스트 작성**

`src/local-sessions/domain/inject-hook-install.spec.ts`:

```ts
import {
  installInjectHooks,
  uninstallInjectHooks,
  INJECT_HOOK_MARKER,
} from './inject-hook-install';

function memoryJsonFs(seed: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(seed));
  return {
    store,
    deps: {
      readJson: (path: string) =>
        (store.get(path) as Record<string, unknown>) ?? {},
      writeJson: (path: string, data: unknown) => {
        store.set(path, data);
      },
    },
  };
}

const options = {
  claudeSettingsPath: '/claude/settings.json',
  codexHooksPath: '/codex/hooks.json',
  stopHookCommand: '"/node" "/repo/dist/src/local-sessions/infrastructure/inject-hook.entry.js"',
};

describe('inject-hook-install', () => {
  it('claude/codex 양쪽에 동기 Stop 훅을 추가하고 변경 경로를 반환', () => {
    const fs = memoryJsonFs();
    const result = installInjectHooks(options, fs.deps);
    expect(result.changed.sort()).toEqual(
      ['/claude/settings.json', '/codex/hooks.json'].sort(),
    );
    const claude = fs.store.get('/claude/settings.json') as any;
    const entry = claude.hooks.Stop[0].hooks[0];
    expect(entry.command).toContain(INJECT_HOOK_MARKER);
    expect(entry.async).toBeUndefined(); // 동기 — stdout decision 을 읽어야 함
  });

  it('마커가 이미 있으면 재설치는 중복을 만들지 않음(idempotent)', () => {
    const fs = memoryJsonFs();
    installInjectHooks(options, fs.deps);
    const second = installInjectHooks(options, fs.deps);
    expect(second.changed).toEqual([]);
    const claude = fs.store.get('/claude/settings.json') as any;
    expect(claude.hooks.Stop).toHaveLength(1);
  });

  it('기존 다른 Stop 훅(예: async 텔레메트리)과 공존 — 기존 항목 보존', () => {
    const fs = memoryJsonFs({
      '/claude/settings.json': {
        hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'other-tool', async: true }] }] },
      },
    });
    installInjectHooks(options, fs.deps);
    const claude = fs.store.get('/claude/settings.json') as any;
    expect(claude.hooks.Stop).toHaveLength(2);
    expect(JSON.stringify(claude.hooks.Stop)).toContain('other-tool');
  });

  it('uninstall 은 이대리 마커 항목만 제거하고 남의 것은 보존', () => {
    const fs = memoryJsonFs({
      '/claude/settings.json': {
        hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'other-tool', async: true }] }] },
      },
    });
    installInjectHooks(options, fs.deps);
    uninstallInjectHooks(
      { claudeSettingsPath: options.claudeSettingsPath, codexHooksPath: options.codexHooksPath },
      fs.deps,
    );
    const claude = fs.store.get('/claude/settings.json') as any;
    expect(claude.hooks.Stop).toHaveLength(1);
    expect(claude.hooks.Stop[0].hooks[0].command).toBe('other-tool');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec jest src/local-sessions/domain/inject-hook-install.spec.ts`
Expected: FAIL (`Cannot find module './inject-hook-install'`)

- [ ] **Step 3: 구현**

`src/local-sessions/domain/inject-hook-install.ts`:

```ts
// 이대리 자체 동기 Stop 훅을 claude/codex 설정에 설치/제거한다(순수 — json 읽기/쓰기는 주입).
// 마커는 stopHookCommand 에 반드시 포함되는 substring(entry 파일명). mds install.ts 이식본.

export const INJECT_HOOK_MARKER = 'inject-hook.entry';

export interface HookFsDeps {
  readonly readJson: (path: string) => Record<string, unknown>;
  readonly writeJson: (path: string, data: unknown) => void;
}

export interface HookInstallOptions {
  readonly claudeSettingsPath: string;
  readonly codexHooksPath: string;
  readonly stopHookCommand: string;
}

interface HookLeaf {
  readonly type: string;
  readonly command: string;
  readonly async?: boolean;
}

interface HookEntry {
  matcher?: string;
  hooks?: HookLeaf[];
}

function hasMarker(entries: HookEntry[], marker: string): boolean {
  return entries.some((entry) =>
    (entry.hooks ?? []).some(
      (leaf) => typeof leaf.command === 'string' && leaf.command.includes(marker),
    ),
  );
}

function appendStopHook(
  path: string,
  entry: HookEntry,
  marker: string,
  deps: HookFsDeps,
): boolean {
  const data = deps.readJson(path);
  const hooks = (data.hooks as Record<string, HookEntry[]>) ?? {};
  const stop = hooks.Stop ?? [];
  if (hasMarker(stop, marker)) {
    return false;
  }
  stop.push(entry);
  hooks.Stop = stop;
  data.hooks = hooks;
  deps.writeJson(path, data);
  return true;
}

function removeStopHook(path: string, marker: string, deps: HookFsDeps): boolean {
  const data = deps.readJson(path);
  const hooks = (data.hooks as Record<string, HookEntry[]>) ?? {};
  const stop = hooks.Stop;
  if (!Array.isArray(stop)) {
    return false;
  }
  const kept = stop.filter(
    (entry) =>
      !(entry.hooks ?? []).some(
        (leaf) => typeof leaf.command === 'string' && leaf.command.includes(marker),
      ),
  );
  if (kept.length === stop.length) {
    return false;
  }
  hooks.Stop = kept;
  data.hooks = hooks;
  deps.writeJson(path, data);
  return true;
}

export function installInjectHooks(
  options: HookInstallOptions,
  deps: HookFsDeps,
): { changed: string[] } {
  const changed = new Set<string>();
  const leaf: HookLeaf = { type: 'command', command: options.stopHookCommand };
  // claude 는 matcher 필드를 쓰고, codex 는 안 쓴다(mds 관측). 동기(async 미지정) — stdout 을 읽어야 함.
  if (appendStopHook(options.claudeSettingsPath, { matcher: '', hooks: [leaf] }, INJECT_HOOK_MARKER, deps)) {
    changed.add(options.claudeSettingsPath);
  }
  if (appendStopHook(options.codexHooksPath, { hooks: [leaf] }, INJECT_HOOK_MARKER, deps)) {
    changed.add(options.codexHooksPath);
  }
  return { changed: [...changed] };
}

export function uninstallInjectHooks(
  options: Omit<HookInstallOptions, 'stopHookCommand'>,
  deps: HookFsDeps,
): { changed: string[] } {
  const changed = new Set<string>();
  if (removeStopHook(options.claudeSettingsPath, INJECT_HOOK_MARKER, deps)) {
    changed.add(options.claudeSettingsPath);
  }
  if (removeStopHook(options.codexHooksPath, INJECT_HOOK_MARKER, deps)) {
    changed.add(options.codexHooksPath);
  }
  return { changed: [...changed] };
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm exec jest src/local-sessions/domain/inject-hook-install.spec.ts`
Expected: PASS (4건)

- [ ] **Step 5: Commit**

```bash
git add src/local-sessions/domain/inject-hook-install.ts src/local-sessions/domain/inject-hook-install.spec.ts
git commit -m "feat(local-sessions): 자체 Stop 훅 설치/제거 도메인(마커 idempotent)"
```

---

## Task 4: SessionInjectService + 모듈 배선

**Files:**
- Create: `src/local-sessions/application/session-inject.service.ts`
- Test: `src/local-sessions/application/session-inject.service.spec.ts`
- Modify: `src/local-sessions/local-sessions.module.ts`

**Interfaces:**
- Consumes: `LocalSessionService.list(): LocalSession[]`(기존), `enqueueInject`·`EnqueueDeps`·`InjectRecordInput`(Task 1).
- Produces:
  - `const INJECT_ENQUEUE_DEPS = Symbol('INJECT_ENQUEUE_DEPS')`
  - `function defaultInjectEnqueueDeps(): EnqueueDeps`(실 fs, injectDir=`~/.idaeri/inject`)
  - `type InjectResult = { ok: true } | { ok: false; reason: 'EMPTY_INSTRUCTION' | 'SESSION_NOT_FOUND' }`
  - `class SessionInjectService { inject(sessionId: string, text: string): InjectResult }`

> **TDD 여부: 예(테스트 우선).** LocalSessionConfig 를 건드리지 않고 **별도 토큰 `INJECT_ENQUEUE_DEPS`** 로 주입해 기존 `LocalSessionService` mock 이 깨지지 않게 한다.

- [ ] **Step 1: 실패 테스트 작성**

`src/local-sessions/application/session-inject.service.spec.ts`:

```ts
import { SessionInjectService } from './session-inject.service';
import type { LocalSessionService } from './local-session.service';
import type { EnqueueDeps } from '../domain/inject-queue';
import type { LocalSession } from '../domain/local-session.type';

function makeSession(overrides: Partial<LocalSession> = {}): LocalSession {
  return {
    sessionId: 's1',
    pid: 4242,
    source: 'claude',
    name: 'repo',
    cwd: '/repo',
    state: 'active',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides,
  };
}

function makeService(sessions: LocalSession[]) {
  const written: Array<{ path: string; data: string }> = [];
  const enqueueDeps: EnqueueDeps = {
    injectDir: '/q',
    now: () => 1000,
    seq: () => 'a',
    mkdir: () => {},
    writeFile: (path, data) => {
      written.push({ path, data });
    },
  };
  const localSessions = { list: () => sessions } as unknown as LocalSessionService;
  return { service: new SessionInjectService(localSessions, enqueueDeps), written };
}

describe('SessionInjectService', () => {
  it('세션 존재 + 텍스트 있으면 enqueue 후 ok', () => {
    const { service, written } = makeService([makeSession()]);
    const result = service.inject('s1', '테스트 고쳐');
    expect(result).toEqual({ ok: true });
    expect(written).toHaveLength(1);
    const stored = JSON.parse(written[0].data);
    expect(stored.instruction).toBe('테스트 고쳐');
    expect(stored.sessionId).toBe('s1');
    expect(stored.source).toBe('claude');
  });

  it('빈/공백 텍스트는 EMPTY_INSTRUCTION, enqueue 안 함', () => {
    const { service, written } = makeService([makeSession()]);
    expect(service.inject('s1', '   ')).toEqual({
      ok: false,
      reason: 'EMPTY_INSTRUCTION',
    });
    expect(written).toHaveLength(0);
  });

  it('없는 세션은 SESSION_NOT_FOUND', () => {
    const { service, written } = makeService([makeSession()]);
    expect(service.inject('nope', '고쳐')).toEqual({
      ok: false,
      reason: 'SESSION_NOT_FOUND',
    });
    expect(written).toHaveLength(0);
  });

  it('codex 세션이면 source=codex 로 enqueue', () => {
    const { service, written } = makeService([
      makeSession({ sessionId: 'cx1', source: 'codex', pid: 5555 }),
    ]);
    service.inject('cx1', '빌드 확인');
    expect(JSON.parse(written[0].data).source).toBe('codex');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm exec jest src/local-sessions/application/session-inject.service.spec.ts`
Expected: FAIL (`Cannot find module './session-inject.service'`)

- [ ] **Step 3: 구현**

`src/local-sessions/application/session-inject.service.ts`:

```ts
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import { enqueueInject } from '../domain/inject-queue';
import type { EnqueueDeps } from '../domain/inject-queue';
import { LocalSessionService } from './local-session.service';

export const INJECT_ENQUEUE_DEPS = Symbol('INJECT_ENQUEUE_DEPS');

export type InjectResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'EMPTY_INSTRUCTION' | 'SESSION_NOT_FOUND' };

// 실 fs 바인딩. 원자적 쓰기(temp→rename)로 훅이 반쯤 쓰인 파일을 읽지 않게 한다.
export function defaultInjectEnqueueDeps(): EnqueueDeps {
  return {
    injectDir: join(homedir(), '.idaeri', 'inject'),
    now: () => Date.now(),
    seq: () => randomBytes(4).toString('hex'),
    mkdir: (dir) => {
      mkdirSync(dir, { recursive: true });
    },
    writeFile: (path, data) => {
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, data);
      renameSync(temporary, path);
    },
  };
}

@Injectable()
export class SessionInjectService {
  constructor(
    private readonly localSessions: LocalSessionService,
    @Inject(INJECT_ENQUEUE_DEPS) private readonly enqueueDeps: EnqueueDeps,
  ) {}

  inject(sessionId: string, text: string): InjectResult {
    const instruction = typeof text === 'string' ? text.trim() : '';
    if (instruction.length === 0) {
      return { ok: false, reason: 'EMPTY_INSTRUCTION' };
    }
    const found = this.localSessions
      .list()
      .find((session) => session.sessionId === sessionId);
    if (!found) {
      return { ok: false, reason: 'SESSION_NOT_FOUND' };
    }
    enqueueInject(
      found.pid,
      { instruction, sessionId, source: found.source },
      this.enqueueDeps,
    );
    return { ok: true };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm exec jest src/local-sessions/application/session-inject.service.spec.ts`
Expected: PASS (4건)

- [ ] **Step 5: 모듈 배선**

`src/local-sessions/local-sessions.module.ts` 를 아래로 교체:

```ts
import { Module } from '@nestjs/common';

import {
  defaultLocalSessionConfig,
  LOCAL_SESSION_CONFIG,
  LocalSessionService,
} from './application/local-session.service';
import {
  defaultInjectEnqueueDeps,
  INJECT_ENQUEUE_DEPS,
  SessionInjectService,
} from './application/session-inject.service';

// 로컬 CLI 세션(Claude/Codex) 조회 + inject 큐잉 모듈. 조회는 부작용 0, inject 는 파일 큐 쓰기.
@Module({
  providers: [
    { provide: LOCAL_SESSION_CONFIG, useFactory: defaultLocalSessionConfig },
    { provide: INJECT_ENQUEUE_DEPS, useFactory: defaultInjectEnqueueDeps },
    LocalSessionService,
    SessionInjectService,
  ],
  exports: [LocalSessionService, SessionInjectService],
})
export class LocalSessionsModule {}
```

- [ ] **Step 6: 전체 test 로 회귀 확인**

Run: `pnpm exec jest src/local-sessions`
Expected: PASS (신규 + 기존 local-sessions 스펙 전부)

- [ ] **Step 7: Commit**

```bash
git add src/local-sessions/application/session-inject.service.ts src/local-sessions/application/session-inject.service.spec.ts src/local-sessions/local-sessions.module.ts
git commit -m "feat(local-sessions): SessionInjectService + INJECT_ENQUEUE_DEPS 배선"
```

---

## Task 5: 콘솔 inject 라우트

**Files:**
- Create: `src/console/interface/dto/session-inject.dto.ts`
- Modify: `src/console/interface/console-write.controller.ts`
- Modify: `src/console/interface/console-write.controller.spec.ts`

**Interfaces:**
- Consumes: `SessionInjectService.inject(sessionId, text): InjectResult`(Task 4, LocalSessionsModule 가 export).
- Produces: `POST /v1/console/sessions/:sessionId/inject` → 성공 202 `{ ok: true, deliver: 'next-stop' }`, 빈 텍스트 400, 없는 세션 404.

- [ ] **Step 1: DTO 생성**

`src/console/interface/dto/session-inject.dto.ts`:

```ts
import { IsString } from 'class-validator';

// 세션 주입 요청. 빈/공백 판정은 SessionInjectService 가 소유(단일 소스)하므로 여기선 타입만 강제.
export class SessionInjectDto {
  @IsString()
  text!: string;
}
```

- [ ] **Step 2: 실패 테스트 작성** — `console-write.controller.spec.ts` 에 아래를 추가. 먼저 `makeController` 를 sessionInject mock 을 포함하도록 교체:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConsoleWriteService } from '../application/console-write.service';
import { SessionInjectService } from '../../local-sessions/application/session-inject.service';
import { ConsoleWriteController } from './console-write.controller';

function makeController() {
  const service = {
    sendCommand: jest.fn(),
    applyApproval: jest.fn().mockResolvedValue(undefined),
    cancelApproval: jest.fn().mockResolvedValue(undefined),
  };
  const sessionInject = { inject: jest.fn() };
  const controller = new ConsoleWriteController(
    service as unknown as ConsoleWriteService,
    sessionInject as unknown as SessionInjectService,
  );
  return { controller, service, sessionInject };
}
```

그리고 describe 안에 케이스 추가:

```ts
it('inject 성공 시 202 바디 반환', () => {
  const { controller, sessionInject } = makeController();
  sessionInject.inject.mockReturnValue({ ok: true });
  const result = controller.injectToSession('s1', { text: '고쳐' });
  expect(sessionInject.inject).toHaveBeenCalledWith('s1', '고쳐');
  expect(result).toEqual({ ok: true, deliver: 'next-stop' });
});

it('빈 지시는 BadRequestException', () => {
  const { controller, sessionInject } = makeController();
  sessionInject.inject.mockReturnValue({ ok: false, reason: 'EMPTY_INSTRUCTION' });
  expect(() => controller.injectToSession('s1', { text: '  ' })).toThrow(
    BadRequestException,
  );
});

it('없는 세션은 NotFoundException', () => {
  const { controller, sessionInject } = makeController();
  sessionInject.inject.mockReturnValue({ ok: false, reason: 'SESSION_NOT_FOUND' });
  expect(() => controller.injectToSession('nope', { text: '고쳐' })).toThrow(
    NotFoundException,
  );
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm exec jest src/console/interface/console-write.controller.spec.ts`
Expected: FAIL (`injectToSession` 없음 / 생성자 인자 불일치)

- [ ] **Step 4: 구현** — `console-write.controller.ts` 수정:

import 에 추가:
```ts
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SessionInjectService } from '../../local-sessions/application/session-inject.service';
import { SessionInjectDto } from './dto/session-inject.dto';
```

생성자에 sessionInject 추가:
```ts
constructor(
  private readonly consoleWrite: ConsoleWriteService,
  private readonly sessionInject: SessionInjectService,
) {}
```

라우트 추가(클래스 내부):
```ts
@Post('sessions/:sessionId/inject')
@HttpCode(202)
injectToSession(
  @Param('sessionId') sessionId: string,
  @Body() dto: SessionInjectDto,
): { ok: true; deliver: 'next-stop' } {
  const result = this.sessionInject.inject(sessionId, dto.text);
  if (!result.ok) {
    if (result.reason === 'EMPTY_INSTRUCTION') {
      throw new BadRequestException(result.reason);
    }
    throw new NotFoundException(result.reason);
  }
  return { ok: true, deliver: 'next-stop' };
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm exec jest src/console/interface/console-write.controller.spec.ts`
Expected: PASS (기존 3 + 신규 3)

- [ ] **Step 6: 전체 게이트**

Run: `pnpm lint:check && pnpm test && pnpm build`
Expected: 모두 exit 0 (ConsoleWriteController 생성자 인자 변경이 다른 곳을 안 깨는지 확인 — `SessionInjectService` 는 LocalSessionsModule 가 이미 ConsoleModule 로 export/import 되어 주입 가능)

- [ ] **Step 7: Commit**

```bash
git add src/console/interface/dto/session-inject.dto.ts src/console/interface/console-write.controller.ts src/console/interface/console-write.controller.spec.ts
git commit -m "feat(console): POST /sessions/:id/inject 라우트(202/404/400)"
```

---

## Task 6: Stop 훅 실행 entry (독립 스크립트)

**Files:**
- Create: `src/local-sessions/infrastructure/inject-hook.entry.ts`

**Interfaces:**
- Consumes: `buildStopDecision`(Task 2), `consumeInject`·`ConsumeDeps`(Task 1).
- Produces: 컴파일 산출물 `dist/src/local-sessions/infrastructure/inject-hook.entry.js`(Task 7 설치 커맨드가 가리킴). 실행 시 stdin payload→stdout decision.

> **TDD 여부: 테스트 후(수동).** process/stdin/stdout 바인딩은 단위테스트 부적합. 순수 로직(buildStopDecision·consumeInject)은 Task 1·2 에서 커버됨. 실증은 §검증.

- [ ] **Step 1: 구현**

`src/local-sessions/infrastructure/inject-hook.entry.ts`:

```ts
import { readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { consumeInject } from '../domain/inject-queue';
import type { ConsumeDeps } from '../domain/inject-queue';
import { buildStopDecision } from '../domain/stop-decision';

// Stop 훅 payload 를 fd 0 에서 블로킹으로 읽는다. codex/claude 가 payload 를 써주고 stdin 을
// close 하므로 EOF 까지 읽힌다. 수동 실행(TTY)은 EOF 가 없어 즉시 포기(훅 timeout 이 백스톱).
function readStopHookStdin(): string | null {
  if (process.stdin.isTTY) {
    return null;
  }
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return null;
  }
}

function realConsumeDeps(): ConsumeDeps {
  return {
    injectDir: join(homedir(), '.idaeri', 'inject'),
    readdir: (dir) => readdirSync(dir),
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    removeFile: (path) => {
      unlinkSync(path);
    },
    rmdir: (dir) => {
      rmdirSync(dir);
    },
  };
}

// 절대 throw 하지 않는다 — 우리 훅 오류로 세션을 멈추지 않기 위해 전 구간 방어.
function main(): void {
  try {
    const deps = realConsumeDeps();
    const consume = (pid: number, sessionId: string): string | null =>
      consumeInject(pid, sessionId, deps);
    const decision = buildStopDecision(readStopHookStdin(), process.ppid, consume);
    if (decision.length > 0) {
      process.stdout.write(decision);
    }
  } catch {
    // 어떤 오류든 무시(정상 종료 허용).
  }
}

if (require.main === module) {
  main();
}
```

- [ ] **Step 2: 빌드로 entry 컴파일 확인**

Run: `pnpm build && test -f dist/src/local-sessions/infrastructure/inject-hook.entry.js && echo OK`
Expected: `OK`

- [ ] **Step 3: 수동 스모크(빈 큐 = 빈 출력)**

Run: `echo '{"session_id":"nope"}' | node dist/src/local-sessions/infrastructure/inject-hook.entry.js; echo "exit=$?"`
Expected: 출력 없음 + `exit=0` (큐 비어 있으니 decision 없음 = 정상 종료 허용)

- [ ] **Step 4: Commit**

```bash
git add src/local-sessions/infrastructure/inject-hook.entry.ts
git commit -m "feat(local-sessions): inject Stop 훅 실행 entry(독립 스크립트)"
```

---

## Task 7: 설치/제거 스크립트 + pnpm 명령

**Files:**
- Create: `scripts/console-hooks.ts`
- Modify: `package.json`(scripts)

**Interfaces:**
- Consumes: `installInjectHooks`·`uninstallInjectHooks`·`INJECT_HOOK_MARKER`(Task 3).
- Produces: `pnpm console:install-hooks` / `pnpm console:uninstall-hooks`.

> **TDD 여부: 테스트 후(수동).** 게이트 밖 얇은 wiring. 로직은 Task 3 에서 커버. 실 파일 변경 검증은 §검증.

- [ ] **Step 1: 구현**

`scripts/console-hooks.ts`:

```ts
/* 이대리 콘솔 inject Stop 훅 설치/제거. 사용:
 *   pnpm console:install-hooks
 *   pnpm console:uninstall-hooks
 * claude(~/.claude/settings.json) + codex(~/.codex/hooks.json)에 동기 Stop 훅을 추가/제거한다.
 * 훅 커맨드는 컴파일된 entry 절대경로를 가리킨다(pnpm build 선행 필요). idempotent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  installInjectHooks,
  uninstallInjectHooks,
} from '../src/local-sessions/domain/inject-hook-install';
import type { HookFsDeps } from '../src/local-sessions/domain/inject-hook-install';

const fsDeps: HookFsDeps = {
  readJson: (path) => {
    if (!existsSync(path)) {
      return {};
    }
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  },
  writeJson: (path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  },
};

const repoRoot = join(__dirname, '..');
const entry = join(
  repoRoot,
  'dist',
  'src',
  'local-sessions',
  'infrastructure',
  'inject-hook.entry.js',
);
const claudeSettingsPath = join(homedir(), '.claude', 'settings.json');
const codexHooksPath = join(homedir(), '.codex', 'hooks.json');
const stopHookCommand = `"${process.execPath}" "${entry}"`;

const mode = process.argv[2];
if (mode === 'install') {
  if (!existsSync(entry)) {
    console.error(`entry 없음: ${entry} — 먼저 pnpm build 를 실행하세요.`);
    process.exit(1);
  }
  const result = installInjectHooks(
    { claudeSettingsPath, codexHooksPath, stopHookCommand },
    fsDeps,
  );
  console.log(
    result.changed.length > 0
      ? `설치됨: ${result.changed.join(', ')}`
      : '이미 설치됨(변경 없음).',
  );
} else if (mode === 'uninstall') {
  const result = uninstallInjectHooks({ claudeSettingsPath, codexHooksPath }, fsDeps);
  console.log(
    result.changed.length > 0
      ? `제거됨: ${result.changed.join(', ')}`
      : '설치된 이대리 훅 없음(변경 없음).',
  );
} else {
  console.error('usage: ts-node scripts/console-hooks.ts <install|uninstall>');
  process.exit(1);
}
```

- [ ] **Step 2: package.json scripts 추가**

`scripts` 블록에 2줄 추가:
```json
"console:install-hooks": "ts-node scripts/console-hooks.ts install",
"console:uninstall-hooks": "ts-node scripts/console-hooks.ts uninstall",
```

- [ ] **Step 3: 설치→제거 왕복 실증(실 파일)**

```bash
pnpm build
pnpm console:install-hooks
# ~/.claude/settings.json 의 Stop 배열에 inject-hook.entry 커맨드가 동기(async 없음)로 추가됐는지 확인
node -e "const h=require('os').homedir();const d=JSON.parse(require('fs').readFileSync(h+'/.claude/settings.json','utf8'));console.log(JSON.stringify(d.hooks.Stop,null,1))"
pnpm console:install-hooks   # 재실행 → '이미 설치됨(변경 없음).'
pnpm console:uninstall-hooks # 이대리 마커 항목만 제거, 기존 훅 보존
```
Expected: 최초 설치 로그, 재실행은 변경 없음, uninstall 후 이대리 항목만 사라지고 Clawd 등 기존 Stop 훅은 보존.

- [ ] **Step 4: Commit**

```bash
git add scripts/console-hooks.ts package.json
git commit -m "feat(console): inject 훅 설치/제거 스크립트 + pnpm 명령"
```

---

## Task 8: Swift — inject 요청 빌더 + 결과 매핑 + 클라이언트

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/Models.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCore/ConsoleClient.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleClientTests.swift`

**Interfaces:**
- Consumes: 기존 `ConsoleClient`(actor), `buildCommandRequest` 패턴.
- Produces:
  - `struct InjectRequestBody: Codable { let text: String }`
  - `func buildInjectRequest(baseURL: URL, sessionId: String, text: String, token: String?) throws -> URLRequest`
  - `enum InjectOutcome: Equatable { case queued; case failed(reason: String) }`
  - `func injectOutcome(forStatus status: Int) -> InjectOutcome`
  - `ConsoleClient.postInject(sessionId: String, text: String) async throws -> InjectOutcome`

- [ ] **Step 1: 실패 테스트 작성** — `ConsoleClientTests.swift` 의 `runConsoleClientTests` 끝에 추가:

```swift
    // inject: POST + JSON body + 경로에 sessionId
    let injectRequest = try! buildInjectRequest(
        baseURL: base,
        sessionId: "sess-1",
        text: "테스트 고쳐",
        token: "secret"
    )
    t.expectEqual(injectRequest.httpMethod, "POST", "inject method")
    t.expectEqual(
        injectRequest.url?.absoluteString,
        "http://127.0.0.1:3002/v1/console/sessions/sess-1/inject",
        "inject 경로"
    )
    t.expectEqual(
        injectRequest.value(forHTTPHeaderField: "x-console-token"),
        "secret",
        "inject 토큰 헤더"
    )
    let injectEcho = try! JSONDecoder().decode(
        InjectBodyEcho.self,
        from: injectRequest.httpBody ?? Data()
    )
    t.expectEqual(injectEcho.text, "테스트 고쳐", "inject body text")

    // 상태코드 → 결과 매핑
    t.expectEqual(injectOutcome(forStatus: 202), .queued, "202 = queued")
    t.expectEqual(
        injectOutcome(forStatus: 404),
        .failed(reason: "세션을 찾을 수 없음"),
        "404 매핑"
    )
    t.expectEqual(
        injectOutcome(forStatus: 400),
        .failed(reason: "빈 지시"),
        "400 매핑"
    )
```

그리고 파일 하단 private 미러 타입 추가:
```swift
private struct InjectBodyEcho: Decodable {
    let text: String
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd clients/idaeri-console && swift build`
Expected: FAIL (`buildInjectRequest`/`injectOutcome`/`InjectRequestBody` 미정의)

- [ ] **Step 3: 구현**

`Models.swift` 에 추가:
```swift
/// `POST /v1/console/sessions/:id/inject` 요청 바디.
public struct InjectRequestBody: Codable {
    public let text: String
    public init(text: String) {
        self.text = text
    }
}
```

`ConsoleClient.swift` 에 순수 함수 추가(파일 상단 free function 영역):
```swift
/// `POST /v1/console/sessions/:sessionId/inject` 요청을 구성하는 순수 함수.
public func buildInjectRequest(
    baseURL: URL,
    sessionId: String,
    text: String,
    token: String?
) throws -> URLRequest {
    let url = baseURL
        .appendingPathComponent("v1/console/sessions")
        .appendingPathComponent(sessionId)
        .appendingPathComponent("inject")
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token {
        request.setValue(token, forHTTPHeaderField: "x-console-token")
    }
    request.httpBody = try JSONEncoder().encode(InjectRequestBody(text: text))
    return request
}

/// 주입 결과. 백엔드는 실제 전달 시점(다음 Stop)을 관측할 수 없어 "큐잉됨"까지만 안다.
public enum InjectOutcome: Equatable {
    case queued
    case failed(reason: String)
}

/// inject 응답 상태코드를 사용자용 결과로 매핑한다(순수).
public func injectOutcome(forStatus status: Int) -> InjectOutcome {
    switch status {
    case 200..<300:
        return .queued
    case 404:
        return .failed(reason: "세션을 찾을 수 없음")
    case 400:
        return .failed(reason: "빈 지시")
    default:
        return .failed(reason: "주입 실패 (\(status))")
    }
}
```

`ConsoleClient` actor 안에 메서드 추가:
```swift
    /// `POST /v1/console/sessions/:id/inject` — 로컬 세션에 작업 주입. 동기 응답으로 결과 확정.
    public func postInject(sessionId: String, text: String) async throws -> InjectOutcome {
        let request = try buildInjectRequest(
            baseURL: baseURL,
            sessionId: sessionId,
            text: text,
            token: token
        )
        let (_, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw ConsoleClientError.notHTTP
        }
        return injectOutcome(forStatus: http.statusCode)
    }
```

- [ ] **Step 4: 통과 확인**

Run: `cd clients/idaeri-console && swift build && swift run ConsoleCoreTests`
Expected: `✅ 모든 검증 통과` (기존 + inject 신규)

- [ ] **Step 5: Commit**

```bash
git add clients/idaeri-console/Sources/ConsoleCore/Models.swift clients/idaeri-console/Sources/ConsoleCore/ConsoleClient.swift clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleClientTests.swift
git commit -m "feat(console-app): inject 요청 빌더 + 상태 매핑 + postInject"
```

---

## Task 9: Swift — 세션 카드 "작업 주입" 버튼 + 시트

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/SessionRowView.swift`
- Modify: 세션 목록을 렌더하는 뷰(`DashboardView.swift`) — 시트 상태 + `ConsoleClient` 접근

**Interfaces:**
- Consumes: `ConsoleClient.postInject(sessionId:text:)`(Task 8), `ConsoleSession`(기존).
- Produces: 세션 카드에서 텍스트 입력 → 주입 → 결과(큐잉/실패) 표시. UI 배선이라 build + 수동 UX 검증.

> **TDD 여부: 테스트 후(수동).** 순수 로직(요청·매핑)은 Task 8 러너가 커버. 이 태스크는 SwiftUI 배선·UX.

- [ ] **Step 1: SessionRowView 에 주입 버튼 추가**

`SessionRowView` 에 콜백을 받아 버튼을 노출한다. struct 에 `let onInject: () -> Void` 추가하고, `Spacer()` 뒤 상태 텍스트 옆에 버튼 배치:

```swift
struct SessionRowView: View {
    let session: ConsoleSession
    let onInject: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            // ... 기존 배지/상태점/이름·cwd ...
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 2) {
                Text(session.state == "active" ? "활동 중" : "유휴")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Button("작업 주입", action: onInject)
                    .buttonStyle(.borderless)
                    .font(.caption2)
            }
        }
        .padding(.vertical, 3)
    }
    // sourceBadge / stateColor 그대로
}
```

- [ ] **Step 2: 세션 목록 뷰에 시트 배선**

`DashboardView`(세션 섹션을 렌더하는 곳)에서:
- `@State private var injectTarget: ConsoleSession?`, `@State private var injectText = ""`, `@State private var injectNotice: String?` 추가.
- 세션 행: `SessionRowView(session: session, onInject: { injectTarget = session; injectText = "" })`.
- `.sheet(item: $injectTarget)` 로 텍스트 입력 시트: `TextEditor($injectText)` + "주입" 버튼. active/idle 안내 문구(idle 이면 "다음에 이 세션을 이어 쓸 때 전달됩니다").
- "주입" 액션에서 `Task { let outcome = try? await client.postInject(sessionId: target.sessionId, text: injectText); ... injectNotice 갱신; injectTarget = nil }`.
- `client`(ConsoleClient) 접근 경로는 `AppRootView` 소유이므로 필요 시 DashboardView 로 전달(기존 write 경로가 client 를 어떻게 넘기는지 따라감 — 커맨드바/승인 버튼과 동일 패턴 재사용).

> `ConsoleSession` 을 `.sheet(item:)` 에 쓰려면 `Identifiable` 이 필요. 이미 없다면 `Models.swift` 에서 `extension ConsoleSession: Identifiable { public var id: String { sessionId } }` 추가(디코딩·기존 사용 불변).

- [ ] **Step 3: 빌드 + 러너 회귀**

Run: `cd clients/idaeri-console && swift build && swift run ConsoleCoreTests`
Expected: 빌드 성공 + 러너 green(순수 로직 회귀 없음).

- [ ] **Step 4: 수동 UX 확인(사용자)** — `swift run IdaeriConsole` 로 앱 실행, 세션 카드의 "작업 주입" → 시트 → 전송 시 큐잉/실패 표시가 나오는지. (실제 훅 전달은 §검증에서.)

- [ ] **Step 5: Commit**

```bash
git add clients/idaeri-console/Sources/IdaeriConsole/SessionRowView.swift clients/idaeri-console/Sources/IdaeriConsole/DashboardView.swift clients/idaeri-console/Sources/ConsoleCore/Models.swift
git commit -m "feat(console-app): 세션 카드 작업 주입 버튼 + 입력 시트"
```

---

## 최종 검증(실증 — 사용자 손 필요)

단위·타입·빌드로는 훅 왕복을 증명 못 한다. 다음을 실제로 굴린다:

1. **설치 idempotency**: `pnpm build && pnpm console:install-hooks` → `~/.claude/settings.json` Stop 에 동기(inject-hook.entry) 항목. 재실행 "변경 없음". `pnpm console:uninstall-hooks` 후 이대리 항목만 제거·기존 훅 보존.
2. **Claude 실증**: 실 claude 세션을 **작업 중**으로 두고 앱에서 주입 → 현재 턴 종료 시 주입 지시를 이어받는지. **idle** 세션은 다음에 이어 쓸 때 전달되는지.
3. **Codex 실증(리스크)**: codex 가 `decision:block` 을 실제로 이어받는지. **실패 시 대상을 Claude 로 좁히고**(예: DTO/서비스에서 codex source 거부 또는 앱 버튼 비활성) codex 경로는 후속으로.
4. **회귀 0**: Slack 경로·기존 콘솔 read/2A 지시·승인 동작 무변.

---

## Self-Review (계획 작성자 체크)

- **Spec 커버리지**: §3 컴포넌트(큐/decision/install/service/controller/entry/script/Swift) → Task 1~9 각각 대응. §4 API(202/404/400) → Task 5. §5 설치 명령 → Task 7. §6 Swift → Task 8·9. §8 TDD 표 → 각 태스크 "TDD 여부" 주석 반영. §9 검증 → 최종 검증 절.
- **Placeholder 스캔**: 모든 코드 스텝에 실제 코드. "적절히 처리"류 없음. Task 9 만 UI 배선이라 뷰 소유자 경로를 기존 패턴 참조로 지시(코드 골격 제공).
- **타입 일관성**: `EnqueueDeps`/`ConsumeDeps`/`InjectRecordInput`(Task 1) ↔ `SessionInjectService`(Task 4) ↔ `INJECT_ENQUEUE_DEPS`. `buildStopDecision` 시그니처(Task 2) ↔ entry(Task 6). `installInjectHooks`/`INJECT_HOOK_MARKER`(Task 3) ↔ script(Task 7). `SessionInjectService.inject → InjectResult`(Task 4) ↔ controller 분기(Task 5). Swift `buildInjectRequest`/`injectOutcome`/`InjectOutcome`(Task 8) ↔ 뷰(Task 9). 일치 확인.
- **주의**: LocalSessionConfig 를 건드리지 않고 별도 토큰(`INJECT_ENQUEUE_DEPS`)을 써 기존 `LocalSessionService` mock 깨짐 회피(과거 교훈). ConsoleWriteController 생성자 인자 추가는 Task 5 Step 6 전체 게이트로 회귀 확인.
