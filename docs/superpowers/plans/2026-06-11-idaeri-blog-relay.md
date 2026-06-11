# 이대리 BLOG 릴레이 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@이대리 … 블로그 써줘` 자연어 멘션 → IntentClassifier(BLOG) → BlogDispatcher 가 `hermes -z "tistory-blog 스킬을 사용해라. …"` 를 헤드리스 spawn → stdout 에서 Notion URL 추출 → 멘션한 스레드에 답장.

**Architecture:** 신규 `src/agent/blog/` 모듈(hexagonal). BlogDispatcher(AgentDispatcher) → GenerateBlogDraftUsecase(AgentRunService.execute 래핑) → HermesRunnerPort(HermesCliRunner: `hermes -z` spawn, 실제 HOME, `BLOG_NOTIFY_SLACK=0`). 글 작성·Notion 적재는 Hermes 스킬이 전담(이대리는 릴레이). model-router 미경유.

**Tech Stack:** NestJS 10, TypeScript, child_process.spawn, Jest. 외부: Hermes CLI(`hermes -z`).

**참고 스펙:** `docs/superpowers/specs/2026-06-11-idaeri-blog-relay-design.md`
**의존:** Hermes `tistory-blog` 스킬(구현·E2E 검증 완료).

---

## 스펙 보정 (구현 중 확정)

1. **AGENT_TO_PROVIDER 엔트리 필수**: `AGENT_TO_PROVIDER: Record<AgentType, ModelProviderName>` 가 exhaustive 라 `AgentType.BLOG` 추가 시 엔트리 없으면 TS 컴파일 에러. → BLOG 에 sentinel 엔트리를 넣되 **BlogDispatcher 는 `modelRouter.route` 를 호출하지 않으므로 실제로 사용되지 않음**(주석 명시).
2. **env = `buildSafeChildEnv({ homeDir: getRealHomeDir() })` 재사용**: throwaway HOME 대신 실제 HOME 을 주입하면 — 이대리 시크릿(SLACK_BOT_TOKEN/DATABASE_URL 등)은 allowlist 로 계속 격리되면서 Hermes 는 `~/.hermes/` 를 찾는다. spec 의 "buildSafeChildEnv 미사용"보다 안전.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/model-router/domain/model-router.type.ts` | `AgentType.BLOG` 추가 (수정) |
| `src/model-router/application/model-router.usecase.ts` | `AGENT_TO_PROVIDER` 에 BLOG sentinel (수정) |
| `src/agent-run/domain/agent-run.type.ts` | `TriggerType.SLACK_MENTION_BLOG` 추가 (수정) |
| `src/common/exception/response-code.enum.ts` | BLOG ResponseCode 추가 (수정) |
| `src/router/domain/prompt/intent-classifier-system.prompt.ts` | BLOG 분류 후보 1줄 + 카운트 (수정) |
| `src/agent/blog/domain/blog.type.ts` | 입출력 타입 |
| `src/agent/blog/domain/blog-error-code.enum.ts` | BlogErrorCode |
| `src/agent/blog/domain/blog.exception.ts` | BlogException |
| `src/agent/blog/domain/port/hermes-runner.port.ts` | HermesRunnerPort + 토큰 |
| `src/agent/blog/application/extract-notion-url.ts` | 순수 함수(stdout→URL) |
| `src/agent/blog/application/extract-notion-url.spec.ts` | 유닛테스트 |
| `src/agent/blog/application/build-blog-prompt.ts` | 순수 함수(프롬프트 구성) |
| `src/agent/blog/application/build-blog-prompt.spec.ts` | 유닛테스트 |
| `src/agent/blog/application/generate-blog-draft.usecase.ts` | 오케스트레이션 |
| `src/agent/blog/application/generate-blog-draft.usecase.spec.ts` | 유닛테스트(runner mock) |
| `src/agent/blog/infrastructure/hermes-cli.runner.ts` | `hermes -z` spawn |
| `src/agent/blog/infrastructure/blog.dispatcher.ts` | AgentDispatcher |
| `src/agent/blog/blog.module.ts` | 모듈 |
| `src/slack/format/blog.formatter.ts` | mrkdwn 포맷 |
| `src/slack/format/blog.formatter.spec.ts` | 유닛테스트 |
| `src/router/router.module.ts` | BlogModule import + BlogDispatcher inject (수정) |
| `src/app.module.ts` | BlogModule 등록 (수정) |
| `src/slack/handler/retry-run.handler.ts` | BLOG case(재실행 거절) (수정) |
| `~/.hermes/skills/tistory-blog/bin/notify_slack.py` | `BLOG_NOTIFY_SLACK=0` skip (수정) |
| `~/.hermes/skills/tistory-blog/SKILL.md` | env 가드 명시 (수정) |

검증: `pnpm lint:check && pnpm test && pnpm build` 3중 green (CLAUDE.md §2#2).

---

## Task 1: AgentType.BLOG + AGENT_TO_PROVIDER sentinel + IntentClassifier 후보

**Files:**
- Modify: `src/model-router/domain/model-router.type.ts`
- Modify: `src/model-router/application/model-router.usecase.ts`
- Modify: `src/router/domain/prompt/intent-classifier-system.prompt.ts`
- Test: `src/router/domain/prompt/intent-classification.parser.spec.ts` (기존 spec 에 BLOG 케이스 추가)

- [ ] **Step 1: AgentType enum 에 BLOG 추가**

`src/model-router/domain/model-router.type.ts` 의 enum 마지막 `VACATION = 'VACATION',` 다음 줄에 추가:
```typescript
  VACATION = 'VACATION',
  BLOG = 'BLOG',
```

- [ ] **Step 2: AGENT_TO_PROVIDER 에 BLOG sentinel 추가**

`src/model-router/application/model-router.usecase.ts` 의 `AGENT_TO_PROVIDER` 객체 마지막 `[AgentType.VACATION]: ModelProviderName.CHATGPT,` 다음에 추가:
```typescript
  [AgentType.VACATION]: ModelProviderName.CHATGPT,
  // BLOG 은 Hermes CLI(`hermes -z`)를 직접 spawn 하는 외부 에이전트 디스패치라
  // modelRouter.route() 를 거치지 않는다. 이 엔트리는 AGENT_TO_PROVIDER 가
  // Record<AgentType,...> 로 exhaustive 타입이라 컴파일을 통과시키기 위한 sentinel 일 뿐
  // 실제 호출되지 않는다 (BlogDispatcher → HermesRunnerPort 경로).
  [AgentType.BLOG]: ModelProviderName.CLAUDE,
```

- [ ] **Step 3: intent-classifier 시스템 프롬프트에 BLOG 후보 추가 + 카운트 갱신**

`src/router/domain/prompt/intent-classifier-system.prompt.ts` 첫 줄의 worker 개수 문구를 갱신하고(예: `12개` → `13개` — 현재 실제 나열 개수에 맞춰 +1), 분류 후보 목록의 `- VACATION: …` 다음 줄에 추가:
```
- BLOG: 블로그/회고 글 초안 작성 ("이거 블로그로 써줘", "방금 작업 회고 블로그 써줘", "React 서버컴포넌트 블로그 초안", "티스토리 글 써줘")
```

- [ ] **Step 4: 파서가 BLOG 를 허용하는지 테스트 추가**

`src/router/domain/prompt/intent-classification.parser.spec.ts` 에 케이스 추가(파일/기존 describe 패턴에 맞춰):
```typescript
it('BLOG agentType 을 허용한다', () => {
  const result = parseIntentClassification(
    JSON.stringify({ agentType: 'BLOG', confidence: 0.9, reason: '블로그 요청' }),
  );
  expect(result.agentType).toBe('BLOG');
});
```

- [ ] **Step 5: 테스트 + 빌드**

Run: `pnpm test -- intent-classification.parser && pnpm build`
Expected: 파서 spec PASS (whitelist `isAgentType` 가 BLOG 자동 포함), build OK (Record exhaustive 충족).

- [ ] **Step 6: 커밋**

```bash
git add src/model-router/domain/model-router.type.ts src/model-router/application/model-router.usecase.ts src/router/domain/prompt/intent-classifier-system.prompt.ts src/router/domain/prompt/intent-classification.parser.spec.ts
git commit -m "feat(blog): AgentType.BLOG + intent classifier 후보 추가"
```

---

## Task 2: TriggerType + 도메인 스캐폴딩 (BlogErrorCode / Exception / type / ResponseCode)

**Files:**
- Modify: `src/agent-run/domain/agent-run.type.ts`
- Create: `src/agent/blog/domain/blog-error-code.enum.ts`
- Create: `src/agent/blog/domain/blog.exception.ts`
- Create: `src/agent/blog/domain/blog.type.ts`
- Modify: `src/common/exception/response-code.enum.ts`

- [ ] **Step 1: TriggerType 추가**

`src/agent-run/domain/agent-run.type.ts` 의 TriggerType enum 마지막 `SLACK_COMMAND_VACATION = 'SLACK_COMMAND_VACATION',` 다음에 추가(BLOG 은 슬래시가 아니라 멘션 기반이라 MENTION 명명):
```typescript
  SLACK_COMMAND_VACATION = 'SLACK_COMMAND_VACATION',
  // BLOG 은 슬래시 커맨드가 아니라 자연어 멘션 전용이라 COMMAND 가 아닌 MENTION 명명.
  SLACK_MENTION_BLOG = 'SLACK_MENTION_BLOG',
```

- [ ] **Step 2: BlogErrorCode 작성**

`src/agent/blog/domain/blog-error-code.enum.ts`:
```typescript
export enum BlogErrorCode {
  EMPTY_REQUEST = 'EMPTY_REQUEST',
  HERMES_SPAWN_FAILED = 'HERMES_SPAWN_FAILED',
  HERMES_TIMEOUT = 'HERMES_TIMEOUT',
  HERMES_NONZERO_EXIT = 'HERMES_NONZERO_EXIT',
  NOTION_URL_NOT_FOUND = 'NOTION_URL_NOT_FOUND',
}
```

- [ ] **Step 3: BlogException 작성** (기존 work-reviewer.exception.ts 패턴 동일)

먼저 참고: `src/agent/work-reviewer/domain/work-reviewer.exception.ts` 를 읽어 베이스 예외 패턴(생성자 시그니처: `{ code, message, status }`)을 그대로 따른다. 그 패턴으로 `src/agent/blog/domain/blog.exception.ts`:
```typescript
import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { BlogErrorCode } from './blog-error-code.enum';

export class BlogException extends DomainException {
  constructor(params: {
    code: BlogErrorCode;
    message: string;
    status: DomainStatus;
  }) {
    super(params);
  }
}
```
> ⚠️ 구현 전 `work-reviewer.exception.ts` 의 실제 베이스 클래스명·import 경로를 확인해 동일하게 맞춘다(DomainException 경로/생성자가 다르면 그쪽을 따른다).

- [ ] **Step 4: blog.type 작성**

`src/agent/blog/domain/blog.type.ts`:
```typescript
export interface GenerateBlogDraftInput {
  requestText: string;
  slackUserId: string;
}

// Hermes 실행 결과에서 추출한 초안 정보.
export interface BlogDraftResult {
  notionUrl: string;
  // Hermes stdout 최종 블록(요약/제목 등) — 포맷터가 제목 추출에 사용.
  rawOutput: string;
}
```

- [ ] **Step 5: ResponseCode 동기화 항목 추가**

`src/common/exception/response-code.enum.ts` 의 적절한 위치(다른 에이전트 블록 끝, 예: Vacation 다음)에 BlogErrorCode 와 1:1 로 추가:
```typescript
  // BLOG Agent — BlogErrorCode 와 1:1 동기화
  BLOG_EMPTY_REQUEST = 'BLOG_EMPTY_REQUEST',
  BLOG_HERMES_SPAWN_FAILED = 'BLOG_HERMES_SPAWN_FAILED',
  BLOG_HERMES_TIMEOUT = 'BLOG_HERMES_TIMEOUT',
  BLOG_HERMES_NONZERO_EXIT = 'BLOG_HERMES_NONZERO_EXIT',
  BLOG_NOTION_URL_NOT_FOUND = 'BLOG_NOTION_URL_NOT_FOUND',
```

- [ ] **Step 6: 빌드 확인**

Run: `pnpm build`
Expected: OK (타입만 추가, 미사용 경고 없음 — 다음 태스크에서 소비).

- [ ] **Step 7: 커밋**

```bash
git add src/agent-run/domain/agent-run.type.ts src/agent/blog/domain src/common/exception/response-code.enum.ts
git commit -m "feat(blog): TriggerType + 도메인 스캐폴딩(error-code/exception/type/ResponseCode)"
```

---

## Task 3: extract-notion-url 순수 함수 (TDD)

**Files:**
- Create: `src/agent/blog/application/extract-notion-url.ts`
- Test: `src/agent/blog/application/extract-notion-url.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/agent/blog/application/extract-notion-url.spec.ts`:
```typescript
import { extractNotionUrl } from './extract-notion-url';

describe('extractNotionUrl', () => {
  it('NOTION_URL: 마커를 우선 추출한다', () => {
    const out = '작업 완료.\nNOTION_URL: https://www.notion.so/abc123\n끝.';
    expect(extractNotionUrl(out)).toBe('https://www.notion.so/abc123');
  });

  it('마커가 없으면 본문의 notion URL 을 추출한다', () => {
    const out = 'Notion 페이지: https://app.notion.com/p/HTTP-Cache-37c6 입니다.';
    expect(extractNotionUrl(out)).toBe('https://app.notion.com/p/HTTP-Cache-37c6');
  });

  it('notion URL 이 없으면 null', () => {
    expect(extractNotionUrl('초안만 작성했고 링크 없음')).toBeNull();
  });

  it('여러 개면 마지막 마커 값을 쓴다', () => {
    const out = 'NOTION_URL: https://notion.so/old\nNOTION_URL: https://notion.so/new';
    expect(extractNotionUrl(out)).toBe('https://notion.so/new');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- extract-notion-url`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현 작성**

`src/agent/blog/application/extract-notion-url.ts`:
```typescript
// Hermes stdout 에서 생성된 Notion 페이지 URL 을 추출한다.
// 1순위: `NOTION_URL: <url>` 마커(프롬프트가 요청한 형식) 중 마지막 것.
// 2순위: 본문에 등장하는 마지막 notion 도메인 URL.
// 못 찾으면 null.
const MARKER_REGEX = /NOTION_URL:\s*(https?:\/\/[^\s)]+)/gi;
const NOTION_URL_REGEX =
  /https?:\/\/(?:www\.|app\.)?notion\.(?:so|com)\/[^\s)]+/gi;

export const extractNotionUrl = (stdout: string): string | null => {
  const markers = [...stdout.matchAll(MARKER_REGEX)];
  if (markers.length > 0) {
    return markers[markers.length - 1][1];
  }
  const urls = stdout.match(NOTION_URL_REGEX);
  if (urls && urls.length > 0) {
    return urls[urls.length - 1];
  }
  return null;
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test -- extract-notion-url`
Expected: PASS (4 케이스).

- [ ] **Step 5: 커밋**

```bash
git add src/agent/blog/application/extract-notion-url.ts src/agent/blog/application/extract-notion-url.spec.ts
git commit -m "feat(blog): Notion URL 추출 순수 함수 + 테스트"
```

---

## Task 4: build-blog-prompt 순수 함수 (TDD)

**Files:**
- Create: `src/agent/blog/application/build-blog-prompt.ts`
- Test: `src/agent/blog/application/build-blog-prompt.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/agent/blog/application/build-blog-prompt.spec.ts`:
```typescript
import { buildBlogPrompt } from './build-blog-prompt';

describe('buildBlogPrompt', () => {
  it('스킬 명시 호출 prefix + NOTION_URL 출력 지시 + 사용자 요청을 포함한다', () => {
    const prompt = buildBlogPrompt('React 서버컴포넌트 블로그 써줘');
    expect(prompt).toContain('tistory-blog 스킬을 사용해라');
    expect(prompt).toContain('NOTION_URL:');
    expect(prompt).toContain('React 서버컴포넌트 블로그 써줘');
  });

  it('Slack 알림은 요청하지 않는다(이대리가 답장하므로)', () => {
    const prompt = buildBlogPrompt('아무거나');
    expect(prompt).not.toContain('Slack');
    expect(prompt).not.toContain('notify_slack');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- build-blog-prompt`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현 작성**

`src/agent/blog/application/build-blog-prompt.ts`:
```typescript
// 이대리 → Hermes `hermes -z` 에 넘길 프롬프트를 구성한다.
// - tistory-blog 스킬을 **명시 호출**(평범한 요청은 oneshot 에이전트가 스킬을 자동 트리거하지 않음).
// - Slack 알림은 요청하지 않는다 — 이대리가 stdout 의 URL 로 직접 답장하고 Hermes DM 은 끈다(BLOG_NOTIFY_SLACK=0).
// - 마지막 줄에 `NOTION_URL: <url>` 출력을 강제해 추출 안정성 확보.
export const buildBlogPrompt = (requestText: string): string =>
  [
    'tistory-blog 스킬을 사용해라.',
    '아래 요청으로 블로그 초안을 스킬 지침(references/voice.md 말투, templates.md 템플릿)대로 작성하고,',
    "반드시 create_notion_draft.py 로 '블로그 초안' Notion DB 에 페이지를 만들어라.",
    "완료 후 생성된 Notion 페이지 URL 을 마지막 줄에 정확히 'NOTION_URL: <url>' 형식으로 출력해라.",
    '',
    `요청: ${requestText}`,
  ].join('\n');
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test -- build-blog-prompt`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/agent/blog/application/build-blog-prompt.ts src/agent/blog/application/build-blog-prompt.spec.ts
git commit -m "feat(blog): hermes -z 프롬프트 빌더 + 테스트"
```

---

## Task 5: HermesRunnerPort + HermesCliRunner (spawn)

**Files:**
- Create: `src/agent/blog/domain/port/hermes-runner.port.ts`
- Create: `src/agent/blog/infrastructure/hermes-cli.runner.ts`

> spawn 프로세스라 유닛테스트는 안 한다(usecase 에서 port mock 으로 대체 — Task 6). 실제 검증은 수동 E2E(Task 11).

- [ ] **Step 1: 포트 정의**

`src/agent/blog/domain/port/hermes-runner.port.ts`:
```typescript
export const HERMES_RUNNER_PORT = Symbol('HERMES_RUNNER_PORT');

export interface HermesRunResult {
  stdout: string;
  stderr: string;
}

// `hermes -z <prompt>` 를 헤드리스로 실행하고 최종 stdout 을 돌려주는 포트.
// 구현(HermesCliRunner)은 실제 HOME + BLOG_NOTIFY_SLACK=0 으로 spawn.
export interface HermesRunnerPort {
  run(prompt: string): Promise<HermesRunResult>;
}
```

- [ ] **Step 2: 러너 구현**

`src/agent/blog/infrastructure/hermes-cli.runner.ts`:
```typescript
import { spawn } from 'node:child_process';

import { Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  buildSafeChildEnv,
  getRealHomeDir,
} from '../../../model-router/infrastructure/cli-process.util';
import { redactPii } from '../../../model-router/infrastructure/pii-redaction.util';
import { BlogException } from '../domain/blog.exception';
import { BlogErrorCode } from '../domain/blog-error-code.enum';
import {
  HermesRunnerPort,
  HermesRunResult,
} from '../domain/port/hermes-runner.port';

const HERMES_EXECUTABLE = 'hermes';
const HERMES_TIMEOUT_MS = 300_000;
const STDERR_TAIL_LIMIT = 1000;

@Injectable()
export class HermesCliRunner implements HermesRunnerPort {
  private readonly logger = new Logger(HermesCliRunner.name);

  run(prompt: string): Promise<HermesRunResult> {
    // 주제는 토큰이 아니지만 방어적으로 redact 후 argv 전달(hermes -z 는 argv-only).
    const safePrompt = redactPii(prompt);
    return new Promise((resolve, reject) => {
      const child = spawn(HERMES_EXECUTABLE, ['-z', safePrompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
        // 실제 HOME 주입 → Hermes 가 ~/.hermes(config/auth/skills/.env)를 찾는다.
        // 이대리 시크릿(SLACK_BOT_TOKEN/DATABASE_URL 등)은 buildSafeChildEnv allowlist 로 계속 격리.
        // BLOG_NOTIFY_SLACK=0 → tistory-blog 스킬이 자체 Slack DM 을 생략(이대리가 답장).
        env: buildSafeChildEnv({
          homeDir: getRealHomeDir(),
          additionalEnv: { BLOG_NOTIFY_SLACK: '0' },
        }),
      });

      let stdout = '';
      let stderrTail = '';

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new BlogException({
            code: BlogErrorCode.HERMES_TIMEOUT,
            message: `Hermes 실행 시간 초과 (${HERMES_TIMEOUT_MS}ms). 잠시 후 다시 시도해주세요.`,
            status: DomainStatus.INTERNAL,
          }),
        );
      }, HERMES_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(
          new BlogException({
            code: BlogErrorCode.HERMES_SPAWN_FAILED,
            message: `Hermes CLI 실행 실패: ${error.message}`,
            status: DomainStatus.INTERNAL,
          }),
        );
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout: stdout.trim(), stderr: stderrTail });
          return;
        }
        this.logger.error(
          `hermes -z exit=${code} stderrTail=${stderrTail.slice(-300)}`,
        );
        reject(
          new BlogException({
            code: BlogErrorCode.HERMES_NONZERO_EXIT,
            message: `Hermes 비정상 종료 (exit=${code}): ${stderrTail.slice(-200) || '(no stderr)'}`,
            status: DomainStatus.INTERNAL,
          }),
        );
      });
    });
  }
}
```

- [ ] **Step 3: 빌드 확인**

Run: `pnpm build`
Expected: OK. (import 경로 — `cli-process.util` 의 `buildSafeChildEnv`/`getRealHomeDir`, `pii-redaction.util` 의 `redactPii` 존재 확인됨.)

- [ ] **Step 4: 커밋**

```bash
git add src/agent/blog/domain/port/hermes-runner.port.ts src/agent/blog/infrastructure/hermes-cli.runner.ts
git commit -m "feat(blog): HermesRunnerPort + hermes -z spawn 러너(실제 HOME, BLOG_NOTIFY_SLACK=0)"
```

---

## Task 6: GenerateBlogDraftUsecase (runner mock TDD)

**Files:**
- Create: `src/agent/blog/application/generate-blog-draft.usecase.ts`
- Test: `src/agent/blog/application/generate-blog-draft.usecase.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/agent/blog/application/generate-blog-draft.usecase.spec.ts`:
```typescript
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { BlogErrorCode } from '../domain/blog-error-code.enum';
import { HermesRunnerPort } from '../domain/port/hermes-runner.port';
import { GenerateBlogDraftUsecase } from './generate-blog-draft.usecase';

// AgentRunService.execute 를 "run 클로저를 그대로 실행하고 outcome 으로 감싸는" stub 으로 대체.
const agentRunStub = {
  execute: jest.fn(async ({ run }) => {
    const r = await run({ agentRunId: 1 });
    return { result: r.result, modelUsed: r.modelUsed, agentRunId: 1 };
  }),
} as unknown as AgentRunService;

describe('GenerateBlogDraftUsecase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('빈 요청은 EMPTY_REQUEST 로 막는다', async () => {
    const runner: HermesRunnerPort = { run: jest.fn() };
    const usecase = new GenerateBlogDraftUsecase(agentRunStub, runner);
    await expect(
      usecase.execute({ requestText: '   ', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ code: BlogErrorCode.EMPTY_REQUEST });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('Hermes stdout 에서 Notion URL 을 추출해 결과로 반환한다', async () => {
    const runner: HermesRunnerPort = {
      run: jest
        .fn()
        .mockResolvedValue({ stdout: '완료\nNOTION_URL: https://notion.so/x', stderr: '' }),
    };
    const usecase = new GenerateBlogDraftUsecase(agentRunStub, runner);
    const outcome = await usecase.execute({
      requestText: 'CS 블로그 써줘',
      slackUserId: 'U1',
    });
    expect(outcome.result.notionUrl).toBe('https://notion.so/x');
    expect(runner.run).toHaveBeenCalledTimes(1);
    // 프롬프트가 스킬 명시 호출을 포함
    expect((runner.run as jest.Mock).mock.calls[0][0]).toContain(
      'tistory-blog 스킬을 사용해라',
    );
  });

  it('URL 미발견 시 NOTION_URL_NOT_FOUND', async () => {
    const runner: HermesRunnerPort = {
      run: jest.fn().mockResolvedValue({ stdout: '초안만 씀', stderr: '' }),
    };
    const usecase = new GenerateBlogDraftUsecase(agentRunStub, runner);
    await expect(
      usecase.execute({ requestText: 'x', slackUserId: 'U1' }),
    ).rejects.toMatchObject({ code: BlogErrorCode.NOTION_URL_NOT_FOUND });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- generate-blog-draft`
Expected: FAIL (usecase 없음).

- [ ] **Step 3: 구현 작성**

`src/agent/blog/application/generate-blog-draft.usecase.ts`:
```typescript
import { Inject, Injectable } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { BlogException } from '../domain/blog.exception';
import { BlogErrorCode } from '../domain/blog-error-code.enum';
import { BlogDraftResult, GenerateBlogDraftInput } from '../domain/blog.type';
import {
  HERMES_RUNNER_PORT,
  HermesRunnerPort,
} from '../domain/port/hermes-runner.port';
import { buildBlogPrompt } from './build-blog-prompt';
import { extractNotionUrl } from './extract-notion-url';

@Injectable()
export class GenerateBlogDraftUsecase {
  constructor(
    private readonly agentRunService: AgentRunService,
    @Inject(HERMES_RUNNER_PORT)
    private readonly hermesRunner: HermesRunnerPort,
  ) {}

  async execute({
    requestText,
    slackUserId,
  }: GenerateBlogDraftInput): Promise<AgentRunOutcome<BlogDraftResult>> {
    const trimmed = requestText.trim();
    if (trimmed.length === 0) {
      throw new BlogException({
        code: BlogErrorCode.EMPTY_REQUEST,
        message: '블로그 요청이 비어 있습니다. 어떤 주제로 쓸지 적어주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    return this.agentRunService.execute({
      agentType: AgentType.BLOG,
      triggerType: TriggerType.SLACK_MENTION_BLOG,
      inputSnapshot: { requestText: trimmed, slackUserId },
      evidence: [
        {
          sourceType: 'SLACK_MENTION_BLOG',
          sourceId: slackUserId,
          payload: { requestText: trimmed },
        },
      ],
      run: async () => {
        const { stdout } = await this.hermesRunner.run(buildBlogPrompt(trimmed));
        const notionUrl = extractNotionUrl(stdout);
        if (!notionUrl) {
          throw new BlogException({
            code: BlogErrorCode.NOTION_URL_NOT_FOUND,
            message:
              '초안은 작성됐을 수 있으나 Notion 링크를 찾지 못했습니다. Notion "블로그 초안" DB 를 확인해주세요.',
            status: DomainStatus.INTERNAL,
          });
        }
        const result: BlogDraftResult = { notionUrl, rawOutput: stdout };
        return { result, modelUsed: 'hermes-cli', output: result };
      },
    });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test -- generate-blog-draft`
Expected: PASS (3 케이스).

> ⚠️ `evidence` 의 `sourceType` 타입이 enum/유니온이면 `'SLACK_MENTION_BLOG'` 리터럴이 안 맞을 수 있다. 구현 시 `EvidenceInput.sourceType` 타입을 확인해(기존 worklog 는 `'SLACK_COMMAND_WORKLOG'` 문자열 사용) 맞춘다. 자유 string 이면 그대로, 유니온이면 해당 타입에 값 추가.

- [ ] **Step 5: 커밋**

```bash
git add src/agent/blog/application/generate-blog-draft.usecase.ts src/agent/blog/application/generate-blog-draft.usecase.spec.ts
git commit -m "feat(blog): GenerateBlogDraftUsecase(AgentRun 래핑 + URL 추출)"
```

---

## Task 7: blog.formatter (TDD)

**Files:**
- Create: `src/slack/format/blog.formatter.ts`
- Test: `src/slack/format/blog.formatter.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/slack/format/blog.formatter.spec.ts`:
```typescript
import { formatBlogDraft } from './blog.formatter';

describe('formatBlogDraft', () => {
  it('Notion 링크를 포함한 완료 메시지를 만든다', () => {
    const text = formatBlogDraft({
      notionUrl: 'https://www.notion.so/abc',
      rawOutput: '제목: HTTP 캐시 정리\n본문…',
    });
    expect(text).toContain('블로그 초안');
    expect(text).toContain('https://www.notion.so/abc');
  });

  it('안전하지 않은(http/https 아닌) URL 은 링크로 노출하지 않는다', () => {
    const text = formatBlogDraft({
      notionUrl: 'javascript:alert(1)',
      rawOutput: '',
    });
    expect(text).not.toContain('javascript:');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- blog.formatter`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현 작성** (기존 `mrkdwn.util` 의 `sanitizeForSlackLink`/`isSafeHttpUrl` 재사용)

`src/slack/format/blog.formatter.ts`:
```typescript
import { BlogDraftResult } from '../../agent/blog/domain/blog.type';
import { isSafeHttpUrl, sanitizeForSlackLink } from './mrkdwn.util';

export const formatBlogDraft = (result: BlogDraftResult): string => {
  const lines = ['📝 *블로그 초안 완성*'];
  if (isSafeHttpUrl(result.notionUrl)) {
    lines.push(`Notion 에서 검토: ${sanitizeForSlackLink(result.notionUrl)}`);
  } else {
    lines.push('Notion 링크를 확인하지 못했습니다 — "블로그 초안" DB 를 확인해주세요.');
  }
  lines.push('_검토 후 Tistory 마크다운 에디터에 붙여넣어 발행하세요._');
  return lines.join('\n');
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test -- blog.formatter`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/slack/format/blog.formatter.ts src/slack/format/blog.formatter.spec.ts
git commit -m "feat(blog): Slack 결과 포맷터 + 테스트"
```

---

## Task 8: BlogDispatcher + blog.module

**Files:**
- Create: `src/agent/blog/infrastructure/blog.dispatcher.ts`
- Create: `src/agent/blog/blog.module.ts`

- [ ] **Step 1: BlogDispatcher 작성** (work-reviewer.dispatcher 패턴)

`src/agent/blog/infrastructure/blog.dispatcher.ts`:
```typescript
import { Injectable } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatBlogDraft } from '../../../slack/format/blog.formatter';
import { GenerateBlogDraftUsecase } from '../application/generate-blog-draft.usecase';

// BLOG worker 의 Router dispatcher — 자연어 멘션(input.text)을 Hermes 블로그 스킬 요청으로 릴레이.
@Injectable()
export class BlogDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BLOG;

  constructor(private readonly generateBlogDraft: GenerateBlogDraftUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const outcome = await this.generateBlogDraft.execute({
      requestText: input.text ?? '',
      slackUserId: input.slackUserId,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatBlogDraft(outcome.result),
    };
  }
}
```

- [ ] **Step 2: blog.module 작성** (work-reviewer.module 패턴 — AgentRunModule import + dispatcher export)

`src/agent/blog/blog.module.ts`:
```typescript
import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GenerateBlogDraftUsecase } from './application/generate-blog-draft.usecase';
import { HERMES_RUNNER_PORT } from './domain/port/hermes-runner.port';
import { BlogDispatcher } from './infrastructure/blog.dispatcher';
import { HermesCliRunner } from './infrastructure/hermes-cli.runner';

@Module({
  imports: [AgentRunModule],
  providers: [
    GenerateBlogDraftUsecase,
    BlogDispatcher,
    { provide: HERMES_RUNNER_PORT, useClass: HermesCliRunner },
  ],
  exports: [GenerateBlogDraftUsecase, BlogDispatcher],
})
export class BlogModule {}
```

- [ ] **Step 3: 빌드 확인**

Run: `pnpm build`
Expected: OK.

- [ ] **Step 4: 커밋**

```bash
git add src/agent/blog/infrastructure/blog.dispatcher.ts src/agent/blog/blog.module.ts
git commit -m "feat(blog): BlogDispatcher + BlogModule"
```

---

## Task 9: RouterModule + AppModule 등록

**Files:**
- Modify: `src/router/router.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: RouterModule 에 BlogModule import + BlogDispatcher inject**

`src/router/router.module.ts`:
1. import 추가(상단, 알파벳/기존 순서 따라):
```typescript
import { BlogModule } from '../agent/blog/blog.module';
import { BlogDispatcher } from '../agent/blog/infrastructure/blog.dispatcher';
```
2. `imports` 배열에 `BlogModule,` 추가(VacationModule 옆).
3. `AGENT_DISPATCHER_PORT` 의 `inject` 배열 끝(`VacationDispatcher,` 다음)에 `BlogDispatcher,` 추가.

- [ ] **Step 2: AppModule 에 BlogModule 등록**

`src/app.module.ts` 의 imports 에 `BlogModule` 추가(기존 agent 모듈들 옆). import 문도 추가:
```typescript
import { BlogModule } from './agent/blog/blog.module';
```
> 확인: 다른 agent 모듈이 AppModule imports 에 직접 들어있는 패턴을 따른다(RouterModule 만 등록돼 있고 agent 모듈은 RouterModule 경유라면 AppModule 수정 불필요 — 구현 시 app.module.ts 의 기존 패턴을 보고 결정. VacationModule 이 AppModule 에 있으면 BlogModule 도 동일하게).

- [ ] **Step 3: 빌드 + 전체 테스트**

Run: `pnpm build && pnpm test`
Expected: OK / 전체 green (DI 그래프 정상 — BlogDispatcher 가 AGENT_DISPATCHER_PORT array 에 합류).

- [ ] **Step 4: 커밋**

```bash
git add src/router/router.module.ts src/app.module.ts
git commit -m "feat(blog): RouterModule/AppModule 에 BLOG dispatcher 등록"
```

---

## Task 10: /retry-run BLOG case (재실행 거절)

**Files:**
- Modify: `src/slack/handler/retry-run.handler.ts`

- [ ] **Step 1: BLOG case 추가** (VACATION 거절 케이스와 동일 패턴 — BLOG 은 자연어 재요청이 자연스러움)

`src/slack/handler/retry-run.handler.ts` 의 switch 에서 `case 'VACATION':` 바로 앞(또는 옆)에 추가:
```typescript
case 'BLOG':
  await respond({
    response_type: 'ephemeral',
    replace_original: true,
    text: `AgentRun #${id} (BLOG) 은 Hermes 에이전트 실행이라 retry-run 을 지원하지 않습니다. 같은 요청을 자연어로 다시 멘션해주세요. (예: "@이대리 … 블로그 써줘")`,
  });
  return;
```
> ⚠️ 실제 변수명(`id`, `respond`)·case 문자열 표기는 기존 VACATION case 를 그대로 보고 맞춘다.

- [ ] **Step 2: 빌드 + 관련 테스트**

Run: `pnpm build && pnpm test -- retry-run`
Expected: OK (retry-run spec 이 있으면 green, BLOG default 분기 회귀 없음).

- [ ] **Step 3: 커밋**

```bash
git add src/slack/handler/retry-run.handler.ts
git commit -m "feat(blog): /retry-run BLOG case(자연어 재요청 안내)"
```

---

## Task 11: Hermes 스킬 BLOG_NOTIFY_SLACK 가드 + 3중 green + 수동 E2E

**Files:**
- Modify: `~/.hermes/skills/tistory-blog/bin/notify_slack.py`
- Modify: `~/.hermes/skills/tistory-blog/SKILL.md`

- [ ] **Step 1: notify_slack.py 에 skip 가드 추가**

`~/.hermes/skills/tistory-blog/bin/notify_slack.py` 의 `main()` 진입부(args 파싱 직후)에 추가:
```python
    if os.environ.get("BLOG_NOTIFY_SLACK", "1") == "0":
        print("SLACK SKIPPED (BLOG_NOTIFY_SLACK=0)"); return
```
(이미 `import os` 있음 — 확인.)

- [ ] **Step 2: notify_slack 단위테스트가 있으면 깨지지 않는지 + dry-run**

Run:
```bash
BLOG_NOTIFY_SLACK=0 python3 ~/.hermes/skills/tistory-blog/bin/notify_slack.py --title t --url u
```
Expected: `SLACK SKIPPED (BLOG_NOTIFY_SLACK=0)` (네트워크 호출 없음).

- [ ] **Step 3: SKILL.md 5번 단계에 가드 명시**

`~/.hermes/skills/tistory-blog/SKILL.md` 의 "## 5. Slack 알림" 본문에 한 줄 추가:
```markdown
> `BLOG_NOTIFY_SLACK=0` 이면 이 단계를 건너뛴다(이대리 릴레이 경유 시 이대리가 직접 답장).
```

- [ ] **Step 4: 이대리 3중 green**

Run: `pnpm lint:check && pnpm test && pnpm build`
Expected: 3개 모두 exit 0 (CLAUDE.md §2#2).

- [ ] **Step 5: 수동 E2E (사용자)**

Slack 에서 `@이대리 HTTP 캐시 CS 블로그 써줘` 멘션 →
- IntentClassifier 가 BLOG 분류, :hourglass: 진행표시,
- ~60–90초 후 같은 스레드에 `📝 블로그 초안 완성` + Notion 링크 답장,
- Notion '블로그 초안' DB 에 페이지 생성(Hermes 자체 DM 은 안 옴 — BLOG_NOTIFY_SLACK=0),
- :white_check_mark: 부착.

- [ ] **Step 6: 커밋** (이대리 레포 변경분 — Hermes 스킬은 레포 밖이라 별도)

```bash
git add src/  # 잔여 변경분
git commit -m "feat(blog): 이대리 BLOG 릴레이 완성(3중 green)"
```

---

## Self-Review

**Spec 커버리지** (spec §별):
- §2 트리거(자연어) → Task 1(intent) + Task 8(dispatcher) ✅
- §2 실행(hermes -z) → Task 5(runner) ✅
- §2 env(실제 HOME) → Task 5 (buildSafeChildEnv+getRealHomeDir, 스펙보다 안전하게 보정) ✅
- §2 결과전달(이대리 답장) → Task 6(URL 추출)+Task 7(formatter)+Task 8(dispatcher); 라우터 핸들러가 기존 `say(formattedText)` 로 스레드 답장(수정 불필요) ✅
- §2 Hermes DM 억제(BLOG_NOTIFY_SLACK=0) → Task 5(env)+Task 11(스킬 가드) ✅
- §2 model-router 미경유 → Task 1 sentinel 주석 + Task 6(route 미호출) ✅
- §5 컴포넌트 전 파일 → Task 2~9 ✅
- §8 에러처리 → Task 5(spawn/timeout/exit)+Task 6(URL없음/빈요청) ✅
- §9 테스트 → Task 3/4/6/7 유닛 + Task 11 3중 green ✅
- §10 13체크리스트: AgentType(T1)/IntentClassifier(T1)/Dispatcher(T8)/Formatter(T7)/AgentRun(T6)/TriggerType(T2)/ResponseCode(T2)/AGENT_TO_PROVIDER(T1 sentinel)/retry-run(T10)/모듈등록(T9). README·Slack manifest 는 자연어 전용이라 슬래시 등록 불필요(면제). ✅

**Placeholder 스캔:** 코드 스텝은 전부 실제 코드. `⚠️` 표시 3곳(work-reviewer.exception 베이스 확인 / EvidenceInput.sourceType 타입 확인 / retry-run 변수명 확인)은 *기존 코드 형태에 맞추라*는 구현 지침이며, 해당 스텝에 따를 기준(패턴/예시)을 명시함 — 미정 값 아님.

**타입 일관성:** `BlogDraftResult{notionUrl, rawOutput}` (T2 정의) → T6/T7/T8 동일 사용. `HermesRunnerPort.run(prompt)→{stdout,stderr}` (T5) → T6 동일. `GenerateBlogDraftInput{requestText, slackUserId}` (T2) → T6/T8 동일. `AgentType.BLOG`/`TriggerType.SLACK_MENTION_BLOG`/`BlogErrorCode.*` 전 태스크 일치.

수정 사항: 없음(점검 통과).
