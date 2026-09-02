# 이대리 콘솔 로컬 세션 캐치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이대리 관제 콘솔이 회사 에이전트 런/승인뿐 아니라, 이 맥에서 지금 돌고 있는 Claude Code / Codex CLI 세션을 실시간으로 함께 보여준다(읽기 전용).

**Architecture:** 새 백엔드 모듈 `src/local-sessions/`가 로컬 파일(`~/.claude/sessions/*.json` + `~/.claude/projects/**/<id>.jsonl` mtime, `~/.mds/codex-sessions/*.json` + `transcriptPath` mtime)을 상태 저장 없이 매 조회마다 읽어 `LocalSession[]`을 만든다. 기존 `src/console/`이 이 결과를 스냅샷에 합치고, 폴러가 3초마다 diff해 기존 `ConsoleEventBus`에 `session.*` SSE 이벤트를 발행한다. macOS 앱(`clients/idaeri-console/`)은 `ConsoleCore` 모델/스토어에 세션을 추가하고 대시보드에 "내 작업 세션" 섹션을 그린다.

**Tech Stack:** NestJS 10 + TypeScript(백엔드, jest), Node `fs`/`os`/`path`(파일 조회), RxJS `Subject`(기존 이벤트 버스), Swift 5.9 SwiftUI(앱, 실행형 테스트 러너).

## Global Constraints

- 패키지 매니저는 **pnpm@9.15.9** 고정. `npm`/`yarn` 금지.
- ORM은 **Prisma만**. 이 기능은 **DB 스키마 변경 없음**(`prisma/schema.prisma` 손대지 않음, `db:push` 실행 안 함).
- **`process.env` 직접 참조 금지** → 설정은 주입 토큰/기본값 함수로. 파일시스템 경로는 `os.homedir()` 기반 계산(이건 `process.env`가 아니므로 허용).
- 코드 스타일: `catch (error)`(줄임말 금지), `if (cond) { ... }`(단일 라인도 중괄호), try 안 `return await`, 인라인 반환 타입 금지(별도 interface), 파일명 kebab-case + role suffix.
- **NestJS 생성자에 원시/객체 타입 default 주입 금지**(reflection이 `Number`/`Object` provider로 오인). 설정은 `@Inject(TOKEN)` 명시 주입.
- 완료 기준(백엔드): `pnpm lint:check && pnpm test && pnpm build` 3중 exit 0.
- 완료 기준(앱): `clients/idaeri-console/`에서 `swift build` + `swift run ConsoleCoreTests`(exit 0 = green).
- 격리: **ASCII 경로 worktree**에서 작업(예: `/Users/juneseok/worktrees/idaeri-local-sessions`). 레포 본체 경로에 한글("기타")이 있어 codex 위임 시 ASCII 경로 필수. base 브랜치 = `main`.
- 커밋은 각 태스크 끝에서. 형식 `<type>(<scope>): <subject>`(한국어 subject 허용).

---

## File Structure

**백엔드 신규 (`src/local-sessions/`)**
- `domain/local-session.type.ts` — `LocalSession`, `LocalSessionSource`, `LocalSessionState` 타입.
- `domain/session-activity.ts` — 순수 함수 `deriveSessionState`, 상수 `ACTIVE_WINDOW_MS`.
- `infrastructure/claude-session.reader.ts` — `readClaudeSessions(params)` 파일 조회 순수 함수.
- `infrastructure/codex-session.reader.ts` — `readCodexSessions(params)` 파일 조회 순수 함수.
- `application/local-session.service.ts` — `LocalSessionService.list()`, `LOCAL_SESSION_CONFIG` 토큰, `defaultLocalSessionConfig()`.
- `local-sessions.module.ts` — 토큰 useFactory + `LocalSessionService` provide/export.
- 각 `*.spec.ts`.

**백엔드 확장 (`src/console/`)**
- `domain/console.type.ts` — `ConsoleSession` 추가, `ConsoleSnapshot.sessions` 추가, `ConsoleEvent`에 `session.*` 3종 추가.
- `application/console-mappers.ts` — `toConsoleSession(local)` 추가.
- `application/console-read.service.ts` — `LocalSessionService` 주입, 스냅샷에 `sessions` 채움.
- `application/session-diff.ts` — 순수 함수 `diffSessions(previous, next)`.
- `application/session-poller.service.ts` — `SessionPollerService`(prime + pollOnce + 타이머).
- `console.module.ts` — `LocalSessionsModule` import, `SessionPollerService` provider 추가.
- 관련 `*.spec.ts`(신규 + 기존 `console-read.service.spec.ts` 갱신).

**앱 확장 (`clients/idaeri-console/`)**
- `Sources/ConsoleCore/Models.swift` — `ConsoleSession` struct, `ConsoleSnapshot.sessions`, `ConsoleEvent` 세션 케이스.
- `Sources/ConsoleCore/ConsoleStore.swift` — `@Published sessions`, snapshot/event 적용.
- `Sources/IdaeriConsole/SessionRowView.swift` — 세션 한 줄 뷰(신규).
- `Sources/IdaeriConsole/DashboardView.swift` — "내 작업 세션" 섹션 + 요약 칩.
- `Sources/ConsoleCoreTests/SessionStoreTests.swift` — 신규 스위트, `main.swift`에 등록.
- 기존 `ModelsTests.swift`/`ConsoleStoreTests.swift`의 `ConsoleSnapshot(...)` 생성부에 `sessions: []` 추가.

---

## Phase A — 백엔드 로컬 세션 조회

### Task A1: LocalSession 도메인 타입 + 활동 판정 순수 함수

**Files:**
- Create: `src/local-sessions/domain/local-session.type.ts`
- Create: `src/local-sessions/domain/session-activity.ts`
- Test: `src/local-sessions/domain/session-activity.spec.ts`

**Interfaces:**
- Produces: `LocalSessionSource = 'claude' | 'codex'`, `LocalSessionState = 'active' | 'idle'`, `interface LocalSession { sessionId: string; pid: number; source: LocalSessionSource; name: string; cwd: string; state: LocalSessionState; startedAt: Date; lastActivityAt: Date | null }`
- Produces: `ACTIVE_WINDOW_MS: number`, `deriveSessionState(params: { hasTranscript: boolean; lastActivityAt: Date | null; now: Date }): LocalSessionState`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/local-sessions/domain/session-activity.spec.ts`

```ts
import { ACTIVE_WINDOW_MS, deriveSessionState } from './session-activity';

describe('deriveSessionState', () => {
  const now = new Date('2026-07-27T10:00:00.000Z');

  it('transcript 가 없으면 항상 idle', () => {
    expect(
      deriveSessionState({ hasTranscript: false, lastActivityAt: null, now }),
    ).toBe('idle');
  });

  it('마지막 활동이 60초 이내면 active', () => {
    const lastActivityAt = new Date(now.getTime() - (ACTIVE_WINDOW_MS - 1));
    expect(
      deriveSessionState({ hasTranscript: true, lastActivityAt, now }),
    ).toBe('active');
  });

  it('마지막 활동이 60초 이상 지났으면 idle', () => {
    const lastActivityAt = new Date(now.getTime() - ACTIVE_WINDOW_MS);
    expect(
      deriveSessionState({ hasTranscript: true, lastActivityAt, now }),
    ).toBe('idle');
  });
});
```

- [ ] **Step 2: 실패 확인** — `pnpm exec jest src/local-sessions/domain/session-activity.spec.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 타입 작성** — `src/local-sessions/domain/local-session.type.ts`

```ts
// 로컬에서 실행 중인 CLI 세션 한 건(도메인 표현). 콘솔 뷰 타입으로는 console-mappers 에서 변환.
export type LocalSessionSource = 'claude' | 'codex';
export type LocalSessionState = 'active' | 'idle';

export interface LocalSession {
  readonly sessionId: string;
  readonly pid: number;
  readonly source: LocalSessionSource;
  readonly name: string;
  readonly cwd: string;
  readonly state: LocalSessionState;
  readonly startedAt: Date;
  readonly lastActivityAt: Date | null;
}
```

- [ ] **Step 4: 활동 판정 함수 작성** — `src/local-sessions/domain/session-activity.ts`

```ts
import { LocalSessionState } from './local-session.type';

// mds 와 동일 기준: transcript mtime 이 60초 이내면 active. transcript 부재 시 무조건 idle.
export const ACTIVE_WINDOW_MS = 60_000;

interface DeriveSessionStateParams {
  readonly hasTranscript: boolean;
  readonly lastActivityAt: Date | null;
  readonly now: Date;
}

export function deriveSessionState(
  params: DeriveSessionStateParams,
): LocalSessionState {
  const { hasTranscript, lastActivityAt, now } = params;
  if (!hasTranscript || lastActivityAt === null) {
    return 'idle';
  }
  return now.getTime() - lastActivityAt.getTime() < ACTIVE_WINDOW_MS
    ? 'active'
    : 'idle';
}
```

- [ ] **Step 5: 통과 확인 + 커밋**

```bash
pnpm exec jest src/local-sessions/domain/session-activity.spec.ts   # PASS
git add src/local-sessions/domain
git commit -m "feat(local-sessions): LocalSession 타입 + active/idle 판정 순수 함수"
```

---

### Task A2: Claude 세션 리더

**Files:**
- Create: `src/local-sessions/infrastructure/claude-session.reader.ts`
- Test: `src/local-sessions/infrastructure/claude-session.reader.spec.ts`

**Interfaces:**
- Consumes: `LocalSession`(A1), `deriveSessionState`(A1)
- Produces: `readClaudeSessions(params: { sessionsDir: string; projectsDir: string; now: () => Date }): LocalSession[]`

파일 계약(실측): `~/.claude/sessions/{pid}.json` = `{ pid, sessionId, cwd, startedAt(ms), name, ... }`. 활동은 `~/.claude/projects/<any>/<sessionId>.jsonl` 의 mtime(가장 최근).

- [ ] **Step 1: 실패하는 테스트 작성** — temp 디렉터리에 fixture 를 깔고 검증.

```ts
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readClaudeSessions } from './claude-session.reader';

describe('readClaudeSessions', () => {
  const now = new Date('2026-07-27T10:00:00.000Z');
  let root: string;
  let sessionsDir: string;
  let projectsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'claude-sessions-'));
    sessionsDir = join(root, 'sessions');
    projectsDir = join(root, 'projects');
    mkdirSync(sessionsDir);
    mkdirSync(projectsDir);
  });

  it('세션 JSON 을 LocalSession 으로 파싱하고 transcript mtime 으로 상태를 판정한다', () => {
    writeFileSync(
      join(sessionsDir, '62687.json'),
      JSON.stringify({
        pid: 62687,
        sessionId: 'sess-abc',
        cwd: '/repo/personal_agents',
        startedAt: 1785125751666,
        name: 'personal-agents-21',
      }),
    );
    const projectDir = join(projectsDir, '-repo-personal-agents');
    mkdirSync(projectDir);
    const transcript = join(projectDir, 'sess-abc.jsonl');
    writeFileSync(transcript, '{}');
    const recent = now.getTime() / 1000 - 5; // 5초 전
    utimesSync(transcript, recent, recent);

    const sessions = readClaudeSessions({
      sessionsDir,
      projectsDir,
      now: () => now,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'sess-abc',
      pid: 62687,
      source: 'claude',
      name: 'personal-agents-21',
      cwd: '/repo/personal_agents',
      state: 'active',
    });
    expect(sessions[0].startedAt.getTime()).toBe(1785125751666);
    expect(sessions[0].lastActivityAt).not.toBeNull();
  });

  it('transcript 가 없으면 idle, lastActivityAt 은 null', () => {
    writeFileSync(
      join(sessionsDir, '8943.json'),
      JSON.stringify({ pid: 8943, sessionId: 'sess-none', cwd: '/x', startedAt: 1 }),
    );

    const sessions = readClaudeSessions({ sessionsDir, projectsDir, now: () => now });

    expect(sessions[0].state).toBe('idle');
    expect(sessions[0].lastActivityAt).toBeNull();
  });

  it('sessionsDir 가 없으면 빈 배열(throw 하지 않음)', () => {
    expect(
      readClaudeSessions({ sessionsDir: join(root, 'nope'), projectsDir, now: () => now }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `pnpm exec jest src/local-sessions/infrastructure/claude-session.reader.spec.ts` → FAIL.

- [ ] **Step 3: 리더 작성** — `src/local-sessions/infrastructure/claude-session.reader.ts`

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { LocalSession } from '../domain/local-session.type';
import { deriveSessionState } from '../domain/session-activity';

interface ReadClaudeSessionsParams {
  readonly sessionsDir: string;
  readonly projectsDir: string;
  readonly now: () => Date;
}

// projects/*/<sessionId>.jsonl 을 한 번 훑어 sessionId → 최신 mtime(ms) 맵을 만든다.
function buildTranscriptMtimeMap(projectsDir: string): Map<string, number> {
  const map = new Map<string, number>();
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsDir);
  } catch (error) {
    return map;
  }
  for (const projectDir of projectDirs) {
    const fullDir = join(projectsDir, projectDir);
    let files: string[];
    try {
      files = readdirSync(fullDir);
    } catch (error) {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.jsonl')) {
        continue;
      }
      const sessionId = file.slice(0, file.length - '.jsonl'.length);
      try {
        const mtime = statSync(join(fullDir, file)).mtimeMs;
        const existing = map.get(sessionId);
        if (existing === undefined || mtime > existing) {
          map.set(sessionId, mtime);
        }
      } catch (error) {
        continue;
      }
    }
  }
  return map;
}

export function readClaudeSessions(
  params: ReadClaudeSessionsParams,
): LocalSession[] {
  const { sessionsDir, projectsDir, now } = params;
  let files: string[];
  try {
    files = readdirSync(sessionsDir);
  } catch (error) {
    return [];
  }
  const transcriptMtime = buildTranscriptMtimeMap(projectsDir);
  const nowDate = now();
  const sessions: LocalSession[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(join(sessionsDir, file), 'utf8'));
    } catch (error) {
      continue;
    }
    if (typeof raw.sessionId !== 'string' || typeof raw.pid !== 'number') {
      continue;
    }
    const cwd = typeof raw.cwd === 'string' ? raw.cwd : '';
    const mtime = transcriptMtime.get(raw.sessionId) ?? null;
    const lastActivityAt = mtime === null ? null : new Date(mtime);
    sessions.push({
      sessionId: raw.sessionId,
      pid: raw.pid,
      source: 'claude',
      name:
        typeof raw.name === 'string' && raw.name.length > 0
          ? raw.name
          : basename(cwd),
      cwd,
      state: deriveSessionState({
        hasTranscript: mtime !== null,
        lastActivityAt,
        now: nowDate,
      }),
      startedAt:
        typeof raw.startedAt === 'number' ? new Date(raw.startedAt) : nowDate,
      lastActivityAt,
    });
  }
  return sessions;
}
```

- [ ] **Step 4: 통과 확인** — `pnpm exec jest src/local-sessions/infrastructure/claude-session.reader.spec.ts` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/local-sessions/infrastructure/claude-session.reader.ts src/local-sessions/infrastructure/claude-session.reader.spec.ts
git commit -m "feat(local-sessions): Claude 세션 파일 리더"
```

---

### Task A3: Codex 세션 리더

**Files:**
- Create: `src/local-sessions/infrastructure/codex-session.reader.ts`
- Test: `src/local-sessions/infrastructure/codex-session.reader.spec.ts`

**Interfaces:**
- Consumes: `LocalSession`(A1), `deriveSessionState`(A1)
- Produces: `readCodexSessions(params: { sessionsDir: string; now: () => Date }): LocalSession[]`

파일 계약(실측): `~/.mds/codex-sessions/{pid}.json` = `{ pid, sessionId, cwd, transcriptPath, startedAt(ms), source:"codex" }`. `source !== 'codex'` 는 스킵(노이즈 필터). 활동은 `transcriptPath` mtime.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readCodexSessions } from './codex-session.reader';

describe('readCodexSessions', () => {
  const now = new Date('2026-07-27T10:00:00.000Z');
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = mkdtempSync(join(tmpdir(), 'codex-sessions-'));
  });

  it('source=codex 세션을 transcriptPath mtime 으로 판정해 파싱한다', () => {
    const transcript = join(sessionsDir, 'rollout.jsonl');
    writeFileSync(transcript, '{}');
    const recent = now.getTime() / 1000 - 5;
    utimesSync(transcript, recent, recent);
    writeFileSync(
      join(sessionsDir, '10867.json'),
      JSON.stringify({
        pid: 10867,
        sessionId: 'codex-1',
        cwd: '/repo/sbe-api',
        transcriptPath: transcript,
        startedAt: 1785124531052,
        source: 'codex',
      }),
    );

    const sessions = readCodexSessions({ sessionsDir, now: () => now });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'codex-1',
      pid: 10867,
      source: 'codex',
      name: 'sbe-api',
      cwd: '/repo/sbe-api',
      state: 'active',
    });
  });

  it('source 가 codex 가 아니면 스킵(노이즈 필터)', () => {
    writeFileSync(
      join(sessionsDir, '999.json'),
      JSON.stringify({ pid: 999, sessionId: 'x', cwd: '/x', source: 'subagent' }),
    );

    expect(readCodexSessions({ sessionsDir, now: () => now })).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `pnpm exec jest src/local-sessions/infrastructure/codex-session.reader.spec.ts` → FAIL.

- [ ] **Step 3: 리더 작성** — `src/local-sessions/infrastructure/codex-session.reader.ts`

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { LocalSession } from '../domain/local-session.type';
import { deriveSessionState } from '../domain/session-activity';

interface ReadCodexSessionsParams {
  readonly sessionsDir: string;
  readonly now: () => Date;
}

export function readCodexSessions(
  params: ReadCodexSessionsParams,
): LocalSession[] {
  const { sessionsDir, now } = params;
  let files: string[];
  try {
    files = readdirSync(sessionsDir);
  } catch (error) {
    return [];
  }
  const nowDate = now();
  const sessions: LocalSession[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(readFileSync(join(sessionsDir, file), 'utf8'));
    } catch (error) {
      continue;
    }
    if (typeof raw.sessionId !== 'string' || typeof raw.pid !== 'number') {
      continue;
    }
    // mds 훅은 source==='startup' 세션만 기록하며 record 의 source 는 'codex'.
    // interactive 가 아닌 잡음(subagent/fork)을 배제한다.
    if (raw.source !== 'codex') {
      continue;
    }
    const cwd = typeof raw.cwd === 'string' ? raw.cwd : '';
    let mtime: number | null = null;
    if (typeof raw.transcriptPath === 'string') {
      try {
        mtime = statSync(raw.transcriptPath).mtimeMs;
      } catch (error) {
        mtime = null;
      }
    }
    const lastActivityAt = mtime === null ? null : new Date(mtime);
    sessions.push({
      sessionId: raw.sessionId,
      pid: raw.pid,
      source: 'codex',
      name: basename(cwd),
      cwd,
      state: deriveSessionState({
        hasTranscript: mtime !== null,
        lastActivityAt,
        now: nowDate,
      }),
      startedAt:
        typeof raw.startedAt === 'number' ? new Date(raw.startedAt) : nowDate,
      lastActivityAt,
    });
  }
  return sessions;
}
```

- [ ] **Step 4: 통과 확인** — `pnpm exec jest src/local-sessions/infrastructure/codex-session.reader.spec.ts` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/local-sessions/infrastructure/codex-session.reader.ts src/local-sessions/infrastructure/codex-session.reader.spec.ts
git commit -m "feat(local-sessions): Codex 세션 파일 리더(source 필터 포함)"
```

---

### Task A4: LocalSessionService + 모듈(주입 토큰)

**Files:**
- Create: `src/local-sessions/application/local-session.service.ts`
- Create: `src/local-sessions/local-sessions.module.ts`
- Test: `src/local-sessions/application/local-session.service.spec.ts`

**Interfaces:**
- Consumes: `readClaudeSessions`(A2), `readCodexSessions`(A3), `LocalSession`(A1)
- Produces: `LOCAL_SESSION_CONFIG`(symbol), `interface LocalSessionConfig { claudeSessionsDir: string; claudeProjectsDir: string; codexSessionsDir: string; now: () => Date; isAlive: (pid: number) => boolean }`, `defaultLocalSessionConfig(): LocalSessionConfig`, `class LocalSessionService { list(): LocalSession[] }`, `class LocalSessionsModule`

> DI 함정 주의: `LocalSessionService` 생성자는 원시/객체 default 를 두지 않고 `@Inject(LOCAL_SESSION_CONFIG)` 로만 설정을 받는다(reflection 오인 방지). 테스트는 `new LocalSessionService(fakeConfig)` 로 직접 구성.

- [ ] **Step 1: 실패하는 테스트 작성** — temp 디렉터리 + `isAlive` fake 로 liveness 필터 검증.

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LocalSessionConfig,
  LocalSessionService,
} from './local-session.service';

describe('LocalSessionService', () => {
  const now = new Date('2026-07-27T10:00:00.000Z');
  let root: string;
  let config: LocalSessionConfig;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'local-sessions-'));
    const claudeSessionsDir = join(root, 'claude-sessions');
    const claudeProjectsDir = join(root, 'claude-projects');
    const codexSessionsDir = join(root, 'codex-sessions');
    mkdirSync(claudeSessionsDir);
    mkdirSync(claudeProjectsDir);
    mkdirSync(codexSessionsDir);
    writeFileSync(
      join(claudeSessionsDir, '100.json'),
      JSON.stringify({ pid: 100, sessionId: 'alive', cwd: '/a', startedAt: 1 }),
    );
    writeFileSync(
      join(claudeSessionsDir, '200.json'),
      JSON.stringify({ pid: 200, sessionId: 'dead', cwd: '/b', startedAt: 1 }),
    );
    config = {
      claudeSessionsDir,
      claudeProjectsDir,
      codexSessionsDir,
      now: () => now,
      isAlive: (pid) => pid === 100, // 200 은 죽은 것으로 취급
    };
  });

  it('두 소스를 합치되 죽은 pid 는 제외한다', () => {
    const service = new LocalSessionService(config);

    const sessions = service.list();

    expect(sessions.map((session) => session.sessionId)).toEqual(['alive']);
  });
});
```

- [ ] **Step 2: 실패 확인** — `pnpm exec jest src/local-sessions/application/local-session.service.spec.ts` → FAIL.

- [ ] **Step 3: 서비스 작성** — `src/local-sessions/application/local-session.service.ts`

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import { LocalSession } from '../domain/local-session.type';
import { readClaudeSessions } from '../infrastructure/claude-session.reader';
import { readCodexSessions } from '../infrastructure/codex-session.reader';

export interface LocalSessionConfig {
  readonly claudeSessionsDir: string;
  readonly claudeProjectsDir: string;
  readonly codexSessionsDir: string;
  readonly now: () => Date;
  readonly isAlive: (pid: number) => boolean;
}

export const LOCAL_SESSION_CONFIG = Symbol('LOCAL_SESSION_CONFIG');

// signal 0 은 프로세스에 실제 신호를 보내지 않고 존재/권한만 확인한다.
function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

export function defaultLocalSessionConfig(): LocalSessionConfig {
  const home = homedir();
  return {
    claudeSessionsDir: join(home, '.claude', 'sessions'),
    claudeProjectsDir: join(home, '.claude', 'projects'),
    codexSessionsDir: join(home, '.mds', 'codex-sessions'),
    now: () => new Date(),
    isAlive: defaultIsAlive,
  };
}

// 상태 저장 없음 — 매 list() 호출마다 파일을 다시 읽는다(mds 와 동일한 stateless 조회).
@Injectable()
export class LocalSessionService {
  constructor(
    @Inject(LOCAL_SESSION_CONFIG)
    private readonly config: LocalSessionConfig,
  ) {}

  list(): LocalSession[] {
    const { claudeSessionsDir, claudeProjectsDir, codexSessionsDir, now, isAlive } =
      this.config;
    const sessions: LocalSession[] = [
      ...readClaudeSessions({
        sessionsDir: claudeSessionsDir,
        projectsDir: claudeProjectsDir,
        now,
      }),
      ...readCodexSessions({ sessionsDir: codexSessionsDir, now }),
    ];
    return sessions.filter((session) => isAlive(session.pid));
  }
}
```

- [ ] **Step 4: 통과 확인** — `pnpm exec jest src/local-sessions/application/local-session.service.spec.ts` → PASS.

- [ ] **Step 5: 모듈 작성** — `src/local-sessions/local-sessions.module.ts`

```ts
import { Module } from '@nestjs/common';

import {
  defaultLocalSessionConfig,
  LOCAL_SESSION_CONFIG,
  LocalSessionService,
} from './application/local-session.service';

// 로컬 CLI 세션(Claude/Codex) 조회 모듈 — 파일 조회만, 부작용 0.
@Module({
  providers: [
    { provide: LOCAL_SESSION_CONFIG, useFactory: defaultLocalSessionConfig },
    LocalSessionService,
  ],
  exports: [LocalSessionService],
})
export class LocalSessionsModule {}
```

- [ ] **Step 6: 커밋**

```bash
git add src/local-sessions/application src/local-sessions/local-sessions.module.ts
git commit -m "feat(local-sessions): LocalSessionService + 모듈(주입 토큰·liveness 필터)"
```

---

## Phase B — 콘솔 스냅샷/SSE 확장

### Task B1: 콘솔 뷰 타입에 ConsoleSession + 세션 이벤트 추가 + 매퍼

**Files:**
- Modify: `src/console/domain/console.type.ts`
- Modify: `src/console/application/console-mappers.ts`
- Test: `src/console/application/console-mappers.spec.ts`(신규 — 없으면 생성)

**Interfaces:**
- Consumes: `LocalSession`(A1)
- Produces: `interface ConsoleSession { sessionId: string; pid: number; source: 'claude' | 'codex'; name: string; cwd: string; state: 'active' | 'idle'; startedAt: string; lastActivityAt: string | null }`, `ConsoleSnapshot.sessions: ConsoleSession[]`, `ConsoleEvent` 에 `{ type: 'session.opened' | 'session.updated'; session: ConsoleSession }` 와 `{ type: 'session.closed'; sessionId: string }`, `toConsoleSession(local: LocalSession): ConsoleSession`

- [ ] **Step 1: 실패하는 매퍼 테스트 작성** — `src/console/application/console-mappers.spec.ts`

```ts
import { LocalSession } from '../../local-sessions/domain/local-session.type';
import { toConsoleSession } from './console-mappers';

describe('toConsoleSession', () => {
  it('Date 를 ISO 문자열로, null 활동을 null 로 매핑한다', () => {
    const local: LocalSession = {
      sessionId: 's1',
      pid: 42,
      source: 'claude',
      name: 'repo-1',
      cwd: '/repo',
      state: 'active',
      startedAt: new Date('2026-07-27T00:00:00.000Z'),
      lastActivityAt: new Date('2026-07-27T00:00:30.000Z'),
    };

    expect(toConsoleSession(local)).toEqual({
      sessionId: 's1',
      pid: 42,
      source: 'claude',
      name: 'repo-1',
      cwd: '/repo',
      state: 'active',
      startedAt: '2026-07-27T00:00:00.000Z',
      lastActivityAt: '2026-07-27T00:00:30.000Z',
    });
    expect(
      toConsoleSession({ ...local, lastActivityAt: null }).lastActivityAt,
    ).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인** — `pnpm exec jest src/console/application/console-mappers.spec.ts` → FAIL(함수 없음).

- [ ] **Step 3: 타입 확장** — `src/console/domain/console.type.ts` 에 추가.

`ConsoleSnapshot` 인터페이스에 필드 추가:

```ts
  readonly sessions: ConsoleSession[];
```

새 인터페이스 추가(파일 하단, `ConsoleSnapshot` 위 또는 근처):

```ts
/** 로컬에서 실행 중인 CLI 세션 한 건(관제 뷰 표현). 읽기 전용. */
export interface ConsoleSession {
  readonly sessionId: string;
  readonly pid: number;
  readonly source: 'claude' | 'codex';
  readonly name: string;
  readonly cwd: string;
  readonly state: 'active' | 'idle';
  readonly startedAt: string;
  readonly lastActivityAt: string | null;
}
```

`ConsoleEvent` union 에 케이스 추가:

```ts
  | {
      readonly type: 'session.opened' | 'session.updated';
      readonly session: ConsoleSession;
    }
  | { readonly type: 'session.closed'; readonly sessionId: string };
```

- [ ] **Step 4: 매퍼 작성** — `src/console/application/console-mappers.ts` 에 함수 추가(기존 `toConsoleApproval` 옆).

```ts
import { LocalSession } from '../../local-sessions/domain/local-session.type';
import { ConsoleSession } from '../domain/console.type';

export function toConsoleSession(local: LocalSession): ConsoleSession {
  return {
    sessionId: local.sessionId,
    pid: local.pid,
    source: local.source,
    name: local.name,
    cwd: local.cwd,
    state: local.state,
    startedAt: local.startedAt.toISOString(),
    lastActivityAt:
      local.lastActivityAt === null ? null : local.lastActivityAt.toISOString(),
  };
}
```

- [ ] **Step 5: 통과 확인 + 커밋**

```bash
pnpm exec jest src/console/application/console-mappers.spec.ts   # PASS
git add src/console/domain/console.type.ts src/console/application/console-mappers.ts src/console/application/console-mappers.spec.ts
git commit -m "feat(console): ConsoleSession 뷰 타입·세션 이벤트·매퍼"
```

---

### Task B2: 스냅샷에 sessions 포함(ConsoleReadService)

**Files:**
- Modify: `src/console/application/console-read.service.ts`
- Modify: `src/console/application/console-read.service.spec.ts`

**Interfaces:**
- Consumes: `LocalSessionService`(A4), `toConsoleSession`(B1)
- Produces: `ConsoleReadService.getSnapshot()` 반환의 `sessions` 필드

> 주의(memory: 포트 확장이 mock spec 깨뜨림): 생성자에 `LocalSessionService` 를 추가하므로 `console-read.service.spec.ts` 의 `beforeEach` 생성자 호출을 반드시 갱신해야 lint/build 는 통과해도 `pnpm test` 에서 안 깨진다.

- [ ] **Step 1: 실패하는 테스트로 갱신** — `console-read.service.spec.ts` 의 `beforeEach` 에 `localSessions` mock 추가 + 생성자 3번째 인자 전달, 그리고 세션 스냅샷 검증 추가.

`beforeEach` 를 다음으로 교체:

```ts
  let localSessions: jest.Mocked<Pick<LocalSessionService, 'list'>>;

  beforeEach(() => {
    agentRunService = { findActiveRuns: jest.fn().mockResolvedValue([]) };
    findAllOpenPreviews = { execute: jest.fn().mockResolvedValue([]) };
    localSessions = { list: jest.fn().mockReturnValue([]) };
    service = new ConsoleReadService(
      agentRunService as unknown as AgentRunService,
      findAllOpenPreviews as unknown as FindAllOpenPreviewsUsecase,
      localSessions as unknown as LocalSessionService,
    );
  });
```

파일 상단 import 추가:

```ts
import { LocalSessionService } from '../../local-sessions/application/local-session.service';
```

새 테스트 추가:

```ts
  it('로컬 세션을 뷰 형태(ISO)로 스냅샷에 담는다', async () => {
    localSessions.list.mockReturnValue([
      {
        sessionId: 's1',
        pid: 42,
        source: 'claude',
        name: 'repo-1',
        cwd: '/repo',
        state: 'active',
        startedAt: new Date('2026-07-27T00:00:00Z'),
        lastActivityAt: null,
      },
    ]);

    const snapshot = await service.getSnapshot();

    expect(snapshot.sessions).toEqual([
      {
        sessionId: 's1',
        pid: 42,
        source: 'claude',
        name: 'repo-1',
        cwd: '/repo',
        state: 'active',
        startedAt: '2026-07-27T00:00:00.000Z',
        lastActivityAt: null,
      },
    ]);
  });
```

기존 첫 테스트("스냅샷은 …")에 `expect(snapshot.sessions).toEqual([]);` 한 줄 추가.

- [ ] **Step 2: 실패 확인** — `pnpm exec jest src/console/application/console-read.service.spec.ts` → FAIL(인자 수/필드 없음).

- [ ] **Step 3: 서비스 수정** — `console-read.service.ts`.

import 추가:

```ts
import { LocalSessionService } from '../../local-sessions/application/local-session.service';
```

`import { toConsoleApproval } from './console-mappers';` 를 다음으로:

```ts
import { toConsoleApproval, toConsoleSession } from './console-mappers';
```

생성자에 파라미터 추가:

```ts
  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
    private readonly localSessions: LocalSessionService,
  ) {}
```

`getSnapshot()` 의 `return { ... }` 를 다음으로:

```ts
    const sessions = this.localSessions.list().map(toConsoleSession);

    return {
      agents,
      runs,
      approvals,
      sessions,
      serverTime: now.toISOString(),
    };
```

- [ ] **Step 4: 통과 확인** — `pnpm exec jest src/console/application/console-read.service.spec.ts` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/console/application/console-read.service.ts src/console/application/console-read.service.spec.ts
git commit -m "feat(console): 스냅샷에 로컬 세션 포함"
```

---

### Task B3: 세션 diff 순수 함수

**Files:**
- Create: `src/console/application/session-diff.ts`
- Test: `src/console/application/session-diff.spec.ts`

**Interfaces:**
- Consumes: `ConsoleSession`, `ConsoleEvent`(B1)
- Produces: `diffSessions(previous: ConsoleSession[], next: ConsoleSession[]): ConsoleEvent[]`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { ConsoleSession } from '../domain/console.type';
import { diffSessions } from './session-diff';

const base: ConsoleSession = {
  sessionId: 's1',
  pid: 1,
  source: 'claude',
  name: 'r',
  cwd: '/r',
  state: 'idle',
  startedAt: '2026-07-27T00:00:00.000Z',
  lastActivityAt: null,
};

describe('diffSessions', () => {
  it('신규 세션은 session.opened', () => {
    expect(diffSessions([], [base])).toEqual([
      { type: 'session.opened', session: base },
    ]);
  });

  it('상태/활동이 바뀌면 session.updated', () => {
    const next = { ...base, state: 'active' as const };
    expect(diffSessions([base], [next])).toEqual([
      { type: 'session.updated', session: next },
    ]);
  });

  it('변화 없으면 이벤트 없음', () => {
    expect(diffSessions([base], [base])).toEqual([]);
  });

  it('사라진 세션은 session.closed(sessionId)', () => {
    expect(diffSessions([base], [])).toEqual([
      { type: 'session.closed', sessionId: 's1' },
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `pnpm exec jest src/console/application/session-diff.spec.ts` → FAIL.

- [ ] **Step 3: 함수 작성** — `src/console/application/session-diff.ts`

```ts
import { ConsoleEvent, ConsoleSession } from '../domain/console.type';

// 표시에 영향을 주는 가변 필드만 비교(재발행 최소화).
function sessionChanged(before: ConsoleSession, after: ConsoleSession): boolean {
  return (
    before.state !== after.state ||
    before.lastActivityAt !== after.lastActivityAt
  );
}

export function diffSessions(
  previous: ConsoleSession[],
  next: ConsoleSession[],
): ConsoleEvent[] {
  const events: ConsoleEvent[] = [];
  const previousById = new Map(previous.map((session) => [session.sessionId, session]));
  const nextById = new Map(next.map((session) => [session.sessionId, session]));

  for (const session of next) {
    const before = previousById.get(session.sessionId);
    if (before === undefined) {
      events.push({ type: 'session.opened', session });
    } else if (sessionChanged(before, session)) {
      events.push({ type: 'session.updated', session });
    }
  }
  for (const session of previous) {
    if (!nextById.has(session.sessionId)) {
      events.push({ type: 'session.closed', sessionId: session.sessionId });
    }
  }
  return events;
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

```bash
pnpm exec jest src/console/application/session-diff.spec.ts   # PASS
git add src/console/application/session-diff.ts src/console/application/session-diff.spec.ts
git commit -m "feat(console): 세션 스냅샷 diff → 이벤트 순수 함수"
```

---

### Task B4: SessionPollerService + 콘솔 모듈 배선

**Files:**
- Create: `src/console/application/session-poller.service.ts`
- Test: `src/console/application/session-poller.service.spec.ts`
- Modify: `src/console/console.module.ts`

**Interfaces:**
- Consumes: `LocalSessionService`(A4), `ConsoleEventBus`(기존), `toConsoleSession`(B1), `diffSessions`(B3)
- Produces: `SessionPollerService.prime(): void`, `SessionPollerService.pollOnce(): void`(테스트/타이머 진입점)

- [ ] **Step 1: 실패하는 테스트 작성** — 타이머 없이 `prime`/`pollOnce` 직접 호출.

```ts
import { LocalSession } from '../../local-sessions/domain/local-session.type';
import { LocalSessionService } from '../../local-sessions/application/local-session.service';
import { ConsoleEvent } from '../domain/console.type';
import { ConsoleEventBus } from './console-event-bus.service';
import { SessionPollerService } from './session-poller.service';

function local(sessionId: string, state: 'active' | 'idle'): LocalSession {
  return {
    sessionId,
    pid: 1,
    source: 'claude',
    name: 'r',
    cwd: '/r',
    state,
    startedAt: new Date('2026-07-27T00:00:00Z'),
    lastActivityAt: null,
  };
}

describe('SessionPollerService', () => {
  let list: jest.Mock;
  let published: ConsoleEvent[];
  let poller: SessionPollerService;

  beforeEach(() => {
    list = jest.fn().mockReturnValue([]);
    published = [];
    const bus = { publish: (event: ConsoleEvent) => published.push(event) };
    poller = new SessionPollerService(
      { list } as unknown as LocalSessionService,
      bus as unknown as ConsoleEventBus,
    );
  });

  it('prime 는 이벤트를 발행하지 않는다(스냅샷과 중복 방지)', () => {
    list.mockReturnValue([local('s1', 'idle')]);
    poller.prime();
    expect(published).toEqual([]);
  });

  it('pollOnce 는 prime 이후 변화를 이벤트로 발행한다', () => {
    list.mockReturnValue([local('s1', 'idle')]);
    poller.prime();
    list.mockReturnValue([local('s1', 'active')]);
    poller.pollOnce();
    expect(published).toEqual([
      { type: 'session.updated', session: expect.objectContaining({ sessionId: 's1', state: 'active' }) },
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `pnpm exec jest src/console/application/session-poller.service.spec.ts` → FAIL.

- [ ] **Step 3: 서비스 작성** — `src/console/application/session-poller.service.ts`

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { LocalSessionService } from '../../local-sessions/application/local-session.service';
import { ConsoleSession } from '../domain/console.type';
import { ConsoleEventBus } from './console-event-bus.service';
import { toConsoleSession } from './console-mappers';
import { diffSessions } from './session-diff';

// 로컬 세션은 파일 변화라서 in-process 이벤트가 없다 → 주기 폴링으로 diff 해 SSE 로 흘린다.
@Injectable()
export class SessionPollerService implements OnModuleInit, OnModuleDestroy {
  private static readonly POLL_MS = 3_000;
  private previous: ConsoleSession[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly localSessions: LocalSessionService,
    private readonly bus: ConsoleEventBus,
  ) {}

  onModuleInit(): void {
    this.prime();
    this.timer = setInterval(() => {
      this.pollOnce();
    }, SessionPollerService.POLL_MS);
    // 이 타이머가 프로세스 종료를 막지 않도록.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // 첫 상태는 스냅샷이 이미 담으므로 발행 없이 baseline 만 세운다.
  prime(): void {
    this.previous = this.snapshot();
  }

  pollOnce(): void {
    const next = this.snapshot();
    for (const event of diffSessions(this.previous, next)) {
      this.bus.publish(event);
    }
    this.previous = next;
  }

  private snapshot(): ConsoleSession[] {
    return this.localSessions.list().map(toConsoleSession);
  }
}
```

- [ ] **Step 4: 통과 확인** — `pnpm exec jest src/console/application/session-poller.service.spec.ts` → PASS.

- [ ] **Step 5: 콘솔 모듈 배선** — `src/console/console.module.ts` 수정.

```ts
import { Module } from '@nestjs/common';

import { AgentRunModule } from '../agent-run/agent-run.module';
import { LocalSessionsModule } from '../local-sessions/local-sessions.module';
import { ConsoleReadService } from './application/console-read.service';
import { SessionPollerService } from './application/session-poller.service';
import { ConsoleController } from './interface/console.controller';
import { ConsoleStreamController } from './interface/console-stream.controller';

@Module({
  imports: [AgentRunModule, LocalSessionsModule],
  controllers: [ConsoleController, ConsoleStreamController],
  providers: [ConsoleReadService, SessionPollerService],
})
export class ConsoleModule {}
```

- [ ] **Step 6: 백엔드 3중 그린 + 커밋**

```bash
pnpm lint:check && pnpm test && pnpm build   # 3개 exit 0
git add src/console/application/session-poller.service.ts src/console/application/session-poller.service.spec.ts src/console/console.module.ts
git commit -m "feat(console): 세션 폴러 + SSE 발행 배선"
```

---

## Phase C — macOS 앱(ConsoleCore + 대시보드)

### Task C1: ConsoleCore 모델·스토어에 세션 반영

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/Models.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCore/ConsoleStore.swift`
- Create: `clients/idaeri-console/Sources/ConsoleCoreTests/SessionStoreTests.swift`
- Modify: `clients/idaeri-console/Sources/ConsoleCoreTests/main.swift`
- Modify(호출부 갱신): `clients/idaeri-console/Sources/ConsoleCoreTests/ModelsTests.swift`, `clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleStoreTests.swift`

**Interfaces:**
- Produces: `struct ConsoleSession`(Codable/Identifiable/Sendable, `id == sessionId`), `ConsoleSnapshot.sessions: [ConsoleSession]`, `ConsoleEvent` 케이스 `.sessionOpened`/`.sessionUpdated(ConsoleSession)`/`.sessionClosed(sessionId: String)`, `ConsoleStore.sessions: [ConsoleSession]`

- [ ] **Step 1: 실패하는 테스트 작성** — `SessionStoreTests.swift`

```swift
import ConsoleCore
import Foundation

func runSessionStoreTests(_ runner: TestRunner) {
    runner.suite("SessionStore")

    let session = ConsoleSession(
        sessionId: "s1", pid: 42, source: "claude", name: "repo-1",
        cwd: "/repo", state: "active",
        startedAt: "2026-07-27T00:00:00.000Z", lastActivityAt: nil
    )

    // 스냅샷 적용
    let store = ConsoleStore()
    store.apply(snapshot: ConsoleSnapshot(
        agents: [], runs: [], approvals: [], sessions: [session],
        serverTime: "2026-07-27T00:00:00.000Z"
    ))
    runner.expectEqual(store.sessions.count, 1, "스냅샷 세션 적재")

    // opened upsert (중복 id 는 교체)
    store.apply(event: .sessionOpened(session))
    runner.expectEqual(store.sessions.count, 1, "opened 는 id 로 upsert")

    // updated 상태 반영
    let updated = ConsoleSession(
        sessionId: "s1", pid: 42, source: "claude", name: "repo-1",
        cwd: "/repo", state: "idle",
        startedAt: "2026-07-27T00:00:00.000Z", lastActivityAt: nil
    )
    store.apply(event: .sessionUpdated(updated))
    runner.expectEqual(store.sessions.first?.state, "idle", "updated 상태 반영")

    // closed 제거
    store.apply(event: .sessionClosed(sessionId: "s1"))
    runner.expectEqual(store.sessions.count, 0, "closed 는 제거")
}
```

`main.swift` 에 등록(라인 추가):

```swift
runSessionStoreTests(runner)
```

- [ ] **Step 2: 실패(빌드 에러) 확인** — `cd clients/idaeri-console && swift build` → 컴파일 실패(`ConsoleSession` 없음).

- [ ] **Step 3: 모델 확장** — `Models.swift`.

`ConsoleSnapshot` 에 `public let sessions: [ConsoleSession]` 추가 + `init` 파라미터/대입 추가. 새 struct 추가:

```swift
/// 로컬에서 실행 중인 CLI 세션 한 건. source/state 는 백엔드 문자열과 1:1.
public struct ConsoleSession: Codable, Identifiable, Sendable {
    public let sessionId: String
    public let pid: Int
    public let source: String
    public let name: String
    public let cwd: String
    public let state: String
    public let startedAt: String
    public let lastActivityAt: String?

    public var id: String { sessionId }

    public init(
        sessionId: String, pid: Int, source: String, name: String,
        cwd: String, state: String, startedAt: String, lastActivityAt: String?
    ) {
        self.sessionId = sessionId
        self.pid = pid
        self.source = source
        self.name = name
        self.cwd = cwd
        self.state = state
        self.startedAt = startedAt
        self.lastActivityAt = lastActivityAt
    }
}
```

`ConsoleEvent` enum 에 케이스 + 디코딩 추가. 케이스:

```swift
    case sessionOpened(ConsoleSession)
    case sessionUpdated(ConsoleSession)
    case sessionClosed(sessionId: String)
```

`CodingKeys` 에 `case session` 와 `case sessionId` 추가. `init(from:)` switch 에 케이스 추가:

```swift
        case "session.opened":
            self = .sessionOpened(try container.decode(ConsoleSession.self, forKey: .session))
        case "session.updated":
            self = .sessionUpdated(try container.decode(ConsoleSession.self, forKey: .session))
        case "session.closed":
            self = .sessionClosed(sessionId: try container.decode(String.self, forKey: .sessionId))
```

- [ ] **Step 4: 스토어 확장** — `ConsoleStore.swift`.

프로퍼티 추가:

```swift
    @Published public private(set) var sessions: [ConsoleSession] = []
```

`apply(snapshot:)` 에 `sessions = snapshot.sessions` 추가. `apply(event:)` switch 에 케이스 추가:

```swift
        case let .sessionOpened(session):
            upsertSession(session)
        case let .sessionUpdated(session):
            upsertSession(session)
        case let .sessionClosed(sessionId):
            sessions.removeAll { $0.sessionId == sessionId }
```

private 메서드 추가:

```swift
    private func upsertSession(_ session: ConsoleSession) {
        if let index = sessions.firstIndex(where: { $0.sessionId == session.sessionId }) {
            sessions[index] = session
            return
        }
        sessions.append(session)
    }
```

- [ ] **Step 5: 기존 호출부 갱신** — `ModelsTests.swift`/`ConsoleStoreTests.swift` 에서 `ConsoleSnapshot(` 생성 지점에 `sessions: []` 인자 추가.

```bash
cd clients/idaeri-console
grep -rn "ConsoleSnapshot(" Sources/ConsoleCoreTests   # 모든 생성부에 sessions: [] 추가
```

- [ ] **Step 6: 통과 확인 + 커밋**

```bash
cd clients/idaeri-console && swift build && swift run ConsoleCoreTests   # ✅ 모든 검증 통과
cd - && git add clients/idaeri-console/Sources/ConsoleCore clients/idaeri-console/Sources/ConsoleCoreTests
git commit -m "feat(console-app): ConsoleCore 세션 모델·스토어·테스트"
```

---

### Task C2: 대시보드 "내 작업 세션" 섹션

**Files:**
- Create: `clients/idaeri-console/Sources/IdaeriConsole/SessionRowView.swift`
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/DashboardView.swift`

**Interfaces:**
- Consumes: `ConsoleStore.sessions`(C1), `ConsoleSession`(C1)

> UI 라 자동 테스트 대신 `swift build` + Task C3 의 실증으로 검증한다.

- [ ] **Step 1: 세션 행 뷰 작성** — `SessionRowView.swift`

```swift
import ConsoleCore
import SwiftUI

/// 로컬 CLI 세션 한 줄. 소스 배지(cc/cx)·이름·cwd·활동 상태·경과를 보여준다. 읽기 전용.
struct SessionRowView: View {
    let session: ConsoleSession

    var body: some View {
        HStack(spacing: 10) {
            Text(sourceBadge)
                .font(.system(.caption2, design: .monospaced).weight(.bold))
                .padding(.horizontal, 5)
                .padding(.vertical, 2)
                .background(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(Color.primary.opacity(0.08))
                )
            Circle()
                .fill(stateColor)
                .frame(width: 7, height: 7)
            VStack(alignment: .leading, spacing: 1) {
                Text(session.name)
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                Text(session.cwd)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 0)
            Text(session.state == "active" ? "활동 중" : "유휴")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    private var sourceBadge: String {
        session.source == "codex" ? "cx" : "cc"
    }

    private var stateColor: Color {
        session.state == "active"
            ? Color(red: 0.36, green: 0.78, blue: 0.63) // 민트 = 활동
            : Color(white: 0.6) // 회색 = 유휴
    }
}
```

- [ ] **Step 2: 대시보드에 섹션 삽입** — `DashboardView.swift` 의 `body` 안 `approvalPanel` 블록 다음에 추가:

```swift
                if !store.sessions.isEmpty {
                    sessionPanel
                }
```

헤더 요약칩에 세션 수 추가(선택) — `summaryChip(count: store.approvals.count, ...)` 줄 다음에:

```swift
                summaryChip(count: store.sessions.count, label: "내 세션", color: Color(red: 0.36, green: 0.78, blue: 0.63))
```

`private var approvalPanel` 아래에 새 계산 프로퍼티 추가:

```swift
    // MARK: - 내 작업 세션 패널

    private var sessionPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("내 작업 세션 \(store.sessions.count)개 (로컬 CLI)")
                .font(.headline)
            ForEach(store.sessions) { session in
                SessionRowView(session: session)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04))
        )
    }
```

- [ ] **Step 3: 빌드 확인 + 커밋**

```bash
cd clients/idaeri-console && swift build   # 성공
cd - && git add clients/idaeri-console/Sources/IdaeriConsole
git commit -m "feat(console-app): 대시보드 '내 작업 세션' 섹션"
```

---

## Phase D — 실증 검증

### Task D1: end-to-end 실증(백엔드 기동 + 앱 실행)

> 코드 태스크가 아니라 실제 동작 확인. `~/.claude/CLAUDE.md` 검증 노트 규칙에 따라 결과를 기록해 PR 코멘트 초안으로 남긴다.

- [ ] **Step 1: 백엔드 스냅샷에 세션이 실려 오는지 REST 확인** — 이 worktree 에서 이대리 기동 후:

```bash
# worktree 에서 (DB/Redis 는 docker 로 이미 떠 있다고 가정)
pnpm dev &
curl -s http://127.0.0.1:3002/v1/console/snapshot | jq '.data.sessions'
```

기대: 배열에 최소 1건(지금 이 Claude Code 세션, `cwd` = personal_agents worktree 경로, `source: "claude"`). Codex 세션도 `~/.mds/codex-sessions/` 에 살아있는 pid 가 있으면 포함.

- [ ] **Step 2: SSE 이벤트 흐름 확인** — 다른 터미널에서 새 `claude` 또는 `codex` 세션을 열고:

```bash
curl -N -s http://127.0.0.1:3002/v1/console/stream
```

기대: `data: {"type":"session.opened",...}` 가 3초 이내 도착. 세션 종료 시 `session.closed`.

- [ ] **Step 3: 앱 실행 확인**

```bash
cd clients/idaeri-console
IDAERI_CONSOLE_URL=http://127.0.0.1:3002 swift run IdaeriConsole
```

기대: 대시보드 하단 "내 작업 세션" 섹션에 현재 세션이 뜨고, 새 세션을 열면 실시간으로 추가/상태변화/제거된다.

- [ ] **Step 4: 노이즈 관찰(중요)** — 이대리 에이전트가 내부적으로 spawn 하는 `codex exec` 가 세션으로 잡히는지 확인. `curl .../snapshot | jq '.data.sessions[] | select(.source=="codex")'` 로 목록을 보고, personal_agents cwd 의 짧은 수명 exec 가 다수 섞이면 후속 필터(예: `entrypoint`/cwd 기반 제외)를 별도 이슈로 트래킹. 섞이지 않으면 현행 `source==='codex'` 필터로 충분(문서에 결론 기록).

- [ ] **Step 5: 검증 노트 초안 작성** — 환경·요청·결과 표·관찰·미검증을 담아 PR 코멘트 초안으로 사용자에게 보고(게시는 승인 후).

---

## Self-Review

**Spec coverage:**
- "Claude 세션 캐치" → A2 + B2(스냅샷) + C1/C2(표시). ✅
- "Codex 세션 캐치(훅 결과물 읽기 + source 필터)" → A3. ✅
- "실시간 반영" → B3(diff) + B4(폴러/SSE) + C1(스토어 이벤트 적용). ✅
- "읽기 전용(inject 제외)" → 어떤 태스크도 write/inject 를 추가하지 않음. ✅
- "DB 무변경" → Prisma 스키마/`db:push` 미등장. ✅
- "노이즈 방어" → A3 source 필터 + A4 liveness 필터 + D1 Step4 관찰. ✅

**Placeholder scan:** 모든 코드 스텝에 실제 코드 포함. "적절한 에러처리" 류 문구 없음(각 `try/catch (error)` 명시). ✅

**Type consistency:**
- `LocalSession`(A1) 필드 ↔ 리더 반환(A2/A3) ↔ `toConsoleSession`(B1) ↔ `ConsoleSession`(B1) ↔ Swift `ConsoleSession`(C1) 필드명·nullable 일치. ✅
- 이벤트 타입 문자열 `session.opened`/`session.updated`/`session.closed` 가 백엔드 union(B1)·diff(B3)·Swift 디코더(C1)·스토어(C1) 전부 동일. ✅
- `ConsoleSnapshot.sessions` 가 백엔드 타입(B1)·ReadService(B2)·Swift 모델/스토어(C1)·기존 테스트 호출부(C1 Step5) 모두 반영. ✅
- `LocalSessionService.list()` 시그니처가 A4 정의 ↔ B2 주입 ↔ B4 폴러 사용 일치. ✅

**Execution note:** Task B2 는 기존 spec 의 생성자 호출을 반드시 갱신해야 `pnpm test` 가 통과한다(lint/build 만으로는 안 잡히는 mock 파손 — memory 반영). Task C1 Step5 는 기존 Swift 스냅샷 생성부 갱신이 누락되면 `swift build` 가 깨진다.
