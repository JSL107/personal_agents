# 블로그 비동기 릴레이 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BLOG(Hermes 블로그) 릴레이를 동기(5분+ `await`)에서 비동기(즉시 "작성 시작" ack → 백그라운드 실행 → 완료 시 같은 Slack 스레드에 답장)로 전환한다.

**Architecture:** BLOG 경로만 비동기화한다. Slack 회신 컨텍스트(channel/threadTs)를 `DispatchInput.replyContext` 로 라우터를 통과시켜 `BlogDispatcher` 까지 전달한다. replyContext 가 있으면 BlogDispatcher 가 "작성 시작" outcome 을 즉시 반환하고 AgentRun+hermes+Notion enrich+Slack 답장 전체를 백그라운드 Promise 로 실행한다. replyContext 가 없는 경로(cron/슬래시/test)는 **기존 동기 동작 그대로** — 하위호환.

**Tech Stack:** NestJS 10, `@slack/web-api` WebClient(기존 `SLACK_WEB_CLIENT` useFactory 패턴 재사용), Prisma 6, jest.

## Global Constraints

- 패키지 매니저 `pnpm` 만. `process.env` 직접 금지 → `ConfigService.get(...)`.
- CLI 자식 프로세스 env 는 `buildSafeChildEnv` 만 (HermesCliRunner 는 이미 적용 — 건드리지 않음).
- 완료 기준 3중 green: `pnpm lint:check && pnpm test && pnpm build` 전부 exit 0.
- 라우터 공통 계약(`DispatchInput`) 변경은 **옵셔널 필드 추가만** — 미사용 worker 12개에 영향 없어야 한다.
- replyContext 없는 경로(cron/슬래시 핸들러/test)는 **반드시 동기 유지**(하위호환 회귀 금지).
- 커밋은 사용자 명시 요청 후에만. 자발적 commit 금지.
- 현재 임시 브리지로 `HERMES_TIMEOUT_MS = 720_000` 적용됨([hermes-cli.runner.ts](../../../src/agent/blog/infrastructure/hermes-cli.runner.ts)) — 비동기 완성 후에도 "백그라운드 무한 방지" 안전장치로 유지한다(제거 금지).

---

## Task 1: DispatchInput.replyContext 계약 추가 + 라우터 통과

**Files:**
- Modify: `src/router/domain/idaeri-router.port.ts` (DispatchInput 에 옵셔널 필드)
- Modify: `src/router/application/idaeri-router.usecase.ts:102` (dispatcher.dispatch 호출 객체에 통과)
- Test: `src/router/application/idaeri-router.usecase.spec.ts`

**Interfaces:**
- Produces: `BlogReplyContext { channel: string; threadTs?: string }`, `DispatchInput.replyContext?: BlogReplyContext`.

- [ ] **Step 1: 계약 추가** — `idaeri-router.port.ts` 에 타입 추가하고 DispatchInput 에 옵셔널 필드.

```ts
// Slack 회신 컨텍스트 — 비동기 worker(BLOG)가 백그라운드 완료 후 같은 스레드에 답장할 때 사용.
// 동기 worker 는 무시한다. cron/슬래시/test 경로는 미주입(undefined) → 기존 동기 동작.
export interface BlogReplyContext {
  channel: string;
  threadTs?: string;
}

// DispatchInput 인터페이스 안에 추가:
  replyContext?: BlogReplyContext;
```

- [ ] **Step 2: 라우터 통과** — `idaeri-router.usecase.ts` 의 `dispatchInternal` 안 `dispatcher.dispatch({...})`(현재 line 102) 호출 객체에 `replyContext: input.replyContext` 를 추가한다. (handoff chain 자식에는 전달하지 않는다 — BLOG 는 chain root 로만 호출됨. followUpInput 구성부는 건드리지 않는다.)

- [ ] **Step 3: 테스트** — `idaeri-router.usecase.spec.ts` 에 "replyContext 가 주입되면 dispatcher.dispatch 가 그 값을 받는다" 케이스 추가(mock dispatcher 의 호출 인자 검증).

```ts
it('replyContext 를 dispatcher 로 통과시킨다', async () => {
  const replyContext = { channel: 'C1', threadTs: '1730000000.0001' };
  await usecase.dispatch({
    source: 'SLACK_MESSAGE', slackUserId: 'U1', agentTypeHint: AgentType.BLOG, replyContext,
  });
  expect(mockBlogDispatcher.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ replyContext }),
  );
});
```

- [ ] **Step 4: 검증** — `pnpm test -- idaeri-router.usecase` PASS. 기존 케이스 회귀 없음.
- [ ] **Step 5: Commit** — `feat(router): DispatchInput 에 replyContext(비동기 회신 컨텍스트) 추가`

---

## Task 2: SlackNotifierPort + WebClient 구현 (BLOG 백그라운드 답장 채널)

**Files:**
- Create: `src/agent/blog/domain/port/slack-notifier.port.ts`
- Create: `src/agent/blog/infrastructure/slack-web.notifier.ts`
- Modify: `src/agent/blog/blog.module.ts` (provider 등록)
- Test: `src/agent/blog/infrastructure/slack-web.notifier.spec.ts`

**Interfaces:**
- Produces: `BLOG_SLACK_NOTIFIER_PORT` 토큰, `BlogSlackNotifierPort.notify({ channel, threadTs?, text }): Promise<void>`.

> 참고: WebClient 주입은 기존 `src/slack-collector/slack-collector.module.ts` 의 `SLACK_WEB_CLIENT` useFactory(`new WebClient(SLACK_BOT_TOKEN)`) 패턴을 그대로 따른다. blog.module 자체 useFactory 로 WebClient 를 만들거나(권장 — 모듈 격리), SlackCollectorModule 의 토큰을 export 받아 재사용. 토큰 미설정 시 client=null → notify 는 warn 로그 후 noop(부팅 영향 없음).

- [ ] **Step 1: 포트 정의** (`slack-notifier.port.ts`)

```ts
export const BLOG_SLACK_NOTIFIER_PORT = Symbol('BLOG_SLACK_NOTIFIER_PORT');

export interface BlogSlackNotifyInput {
  channel: string;
  threadTs?: string;
  text: string;
}

export interface BlogSlackNotifierPort {
  notify(input: BlogSlackNotifyInput): Promise<void>;
}
```

- [ ] **Step 2: 실패 테스트** (`slack-web.notifier.spec.ts`) — chat.postMessage 가 channel/thread_ts/text 로 호출되는지, postMessage throw 시 swallow(throw 안 함) 하는지.

```ts
it('chat.postMessage 를 channel/thread_ts/text 로 호출한다', async () => {
  const postMessage = jest.fn().mockResolvedValue({ ok: true });
  const notifier = new SlackWebNotifier({ chat: { postMessage } } as never);
  await notifier.notify({ channel: 'C1', threadTs: 'T1', text: '완료' });
  expect(postMessage).toHaveBeenCalledWith({ channel: 'C1', thread_ts: 'T1', text: '완료' });
});

it('postMessage 실패는 swallow 한다', async () => {
  const postMessage = jest.fn().mockRejectedValue(new Error('boom'));
  const notifier = new SlackWebNotifier({ chat: { postMessage } } as never);
  await expect(notifier.notify({ channel: 'C1', text: 'x' })).resolves.toBeUndefined();
});
```

- [ ] **Step 3: 구현** (`slack-web.notifier.ts`) — WebClient | null 주입, null 이면 warn noop. 성공/실패 모두 throw 안 함(백그라운드 안정성).
- [ ] **Step 4: 모듈 등록** — `blog.module.ts` providers 에 `{ provide: BLOG_SLACK_NOTIFIER_PORT, useClass: SlackWebNotifier }` + WebClient useFactory(또는 SlackCollectorModule import).
- [ ] **Step 5: 검증** — `pnpm test -- slack-web.notifier` PASS.
- [ ] **Step 6: Commit** — `feat(blog): SlackNotifier 포트 추가 (백그라운드 스레드 답장)`

---

## Task 3: BlogDispatcher 비동기화 (즉시 ack + 백그라운드)

**Files:**
- Modify: `src/agent/blog/infrastructure/blog.dispatcher.ts`
- Test: `src/agent/blog/infrastructure/blog.dispatcher.spec.ts`

**Interfaces:**
- Consumes: `GenerateBlogDraftUsecase.execute(...)`(기존), `BlogSlackNotifierPort.notify(...)`(Task 2), `DispatchInput.replyContext`(Task 1).
- Produces: 비동기 시 즉시 반환 outcome `{ agentRunId: 0, output: { async: true }, modelUsed: 'hermes-cli', formattedText: '<작성 시작 안내>' }`.

> **agentRunId=0 sentinel 결정**: 비동기 즉시 반환 시점엔 AgentRun 이 아직 begin 안 됐다. outcome.agentRunId 는 number 필수라 sentinel 0 을 쓴다. 실제 agentRunId 는 백그라운드 완료 후 notify 메시지에 포함한다. (footer 처리는 Task 4.)

- [ ] **Step 1: 실패 테스트** — replyContext 있으면 (a) execute 완료 전 즉시 반환(agentRunId=0, formattedText 에 "작성 시작"), (b) 백그라운드에서 execute 성공 시 notifier.notify 가 Notion URL 포함해 호출, (c) execute 실패 시 notify 가 실패 메시지로 호출. replyContext 없으면 기존 동기(execute await → outcome).

```ts
it('replyContext 있으면 즉시 작성-시작 outcome 반환 후 백그라운드로 notify', async () => {
  let resolveExec: (v: AgentRunOutcome<BlogDraftResult>) => void;
  generateBlogDraft.execute.mockReturnValue(new Promise((r) => { resolveExec = r; }));
  const outcome = await dispatcher.dispatch({
    source: 'SLACK_MESSAGE', slackUserId: 'U1', text: '루프 엔지니어링',
    replyContext: { channel: 'C1', threadTs: 'T1' },
  });
  expect(outcome.agentRunId).toBe(0);
  expect(outcome.formattedText).toContain('작성 시작');
  expect(notifier.notify).not.toHaveBeenCalled(); // 아직 백그라운드 미완
  resolveExec!({ result: { notionUrl: 'https://app.notion.com/p/x', rawOutput: '', published: true }, modelUsed: 'hermes-cli', agentRunId: 42 });
  await flushPromises();
  expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({
    channel: 'C1', threadTs: 'T1', text: expect.stringContaining('app.notion.com'),
  }));
});

it('replyContext 없으면 기존 동기 동작', async () => {
  generateBlogDraft.execute.mockResolvedValue({ result: { notionUrl: 'u', rawOutput: '', published: true }, modelUsed: 'hermes-cli', agentRunId: 7 });
  const outcome = await dispatcher.dispatch({ source: 'CRON', slackUserId: 'U1', text: 't' });
  expect(outcome.agentRunId).toBe(7);
  expect(notifier.notify).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 구현** — BlogDispatcher 에 notifier 주입. dispatch 분기.

```ts
async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
  const reply = input.replyContext;
  if (!reply) {
    // 동기 경로 (cron/슬래시/test) — 기존 그대로
    const outcome = await this.generateBlogDraft.execute({
      requestText: input.text ?? '', slackUserId: input.slackUserId,
    });
    return { agentRunId: outcome.agentRunId, output: outcome.result,
             modelUsed: outcome.modelUsed, formattedText: formatBlogDraft(outcome.result) };
  }
  // 비동기 경로 — 즉시 ack + 백그라운드
  void this.runInBackground(input, reply);
  return {
    agentRunId: 0, output: { async: true }, modelUsed: 'hermes-cli',
    formattedText: '📝 블로그 초안 작성을 시작했어요. 몇 분 뒤 이 스레드에 Notion 링크를 올릴게요.',
  };
}

private async runInBackground(input: DispatchInput, reply: BlogReplyContext): Promise<void> {
  try {
    const outcome = await this.generateBlogDraft.execute({
      requestText: input.text ?? '', slackUserId: input.slackUserId,
    });
    await this.notifier.notify({
      channel: reply.channel, threadTs: reply.threadTs,
      text: formatBlogDraft(outcome.result),
    });
  } catch (error: unknown) {
    await this.notifier.notify({
      channel: reply.channel, threadTs: reply.threadTs,
      text: `블로그 초안 생성 실패: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
```

- [ ] **Step 3: 검증** — `pnpm test -- blog.dispatcher` PASS (flushPromises 헬퍼는 `await new Promise(setImmediate)`).
- [ ] **Step 4: Commit** — `feat(blog): BlogDispatcher 비동기화 — 즉시 ack + 백그라운드 스레드 답장`

---

## Task 4: RouterMessageHandler replyContext 주입 + 비동기 footer 처리

**Files:**
- Modify: `src/slack/handler/router-message.handler.ts` (dispatch 호출 + buildRouterReply)
- Test: `src/slack/handler/router-message.handler.spec.ts`

- [ ] **Step 1: replyContext 주입** — `processRouterMessage` 의 `this.idaeriRouter.dispatch({...})` 호출(현재 233행 근처)에 `replyContext: { channel: channelId, ...(threadTs ? { threadTs } : {}) }` 추가. (channelId/threadTs 는 이미 핸들러 스코프에 있음.)

- [ ] **Step 2: 비동기 footer 처리** — `buildRouterReply` 가 `result.agentRunId === 0` 이면 footer(`_이대리 (...) · agentRunId=0_`)를 붙이지 않고 formattedText 만 반환하도록 분기(비동기 "작성 시작" 안내엔 footer 가 어색).

```ts
const buildRouterReply = (result: DispatchResult): string => {
  const handoffs = result.handoffResults ?? [];
  if (result.agentRunId === 0 && handoffs.length === 0) {
    return result.formattedText; // 비동기 ack — footer 생략
  }
  // ...기존 로직 그대로
};
```

- [ ] **Step 3: 테스트** — handler spec 에 "BLOG 비동기 ack(agentRunId=0)면 footer 없이 안내만 say" + "dispatch 가 replyContext 를 받는다" 케이스.
- [ ] **Step 4: 검증** — `pnpm test -- router-message.handler` PASS.
- [ ] **Step 5: Commit** — `feat(slack): 라우터 핸들러 replyContext 주입 + 비동기 ack footer 생략`

---

## Task 5: 통합 검증 + 타임아웃 정리

**Files:**
- Modify: `src/agent/blog/infrastructure/hermes-cli.runner.ts` (주석을 임시 브리지 → 정식 안전장치로 갱신, 값 720_000 유지)

- [ ] **Step 1: 타임아웃 주석 정식화** — "임시 브리지" 문구를 "백그라운드 무한 방지 안전장치(비동기라 사용자 대기엔 영향 없음)"로 갱신. 값은 720_000 유지.
- [ ] **Step 2: 3중 green** — `pnpm lint:check && pnpm test && pnpm build` 전부 exit 0 확인.
- [ ] **Step 3: 수동 E2E (사용자)** — 서비스 기동 후 Slack 에서 `@이대리 <주제> 블로그 써줘` 멘션 →
  - 즉시 "📝 작성 시작..." 답글이 같은 스레드에 달리는지
  - 몇 분 뒤 같은 스레드에 Notion 링크(또는 실패 메시지)가 달리는지
  - ⏳ reaction 이 즉시 제거되고(동기 대기 사라짐), 실패 시 에러 메시지가 명확한지
- [ ] **Step 4: Commit** — `chore(blog): hermes 타임아웃 주석 정식화 (비동기 안전장치)`

---

## Self-Review 체크
- DispatchInput 변경은 옵셔널 필드 1개 → 12 worker 미사용, 회귀 없음.
- 동기 경로(replyContext 미주입)는 cron/슬래시/test 에서 그대로 — generate-blog-draft.usecase.spec 등 기존 BLOG spec 영향 최소(dispatcher spec 만 비동기 분기 추가).
- agentRunId=0 sentinel 은 Task 3(반환)·Task 4(footer 생략)에서 일관 사용.
- SlackNotifier 는 실패 swallow — 백그라운드 unhandled rejection 없음(Task 3 try/catch + notifier 내부 swallow 이중 방어).

## 미해결/후속 후보
- 비동기 시 AgentRun 의 "진행 중" 가시성: 현재 sentinel 0 으로 즉시 반환이라 Slack footer 에 실제 agentRunId 가 안 뜬다. 필요하면 notify 메시지 말미에 `agentRunId=<실제>` 를 포함(백그라운드 outcome.agentRunId)하는 것으로 보완.
- 동시 다발 요청 시 백그라운드 Promise 누적 — 현재 무제한. 운영 부하 보이면 BLOG 전용 동시성 제한(간단한 in-flight 카운터) 검토.
