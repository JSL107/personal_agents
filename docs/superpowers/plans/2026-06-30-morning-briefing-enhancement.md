# 아침 브리핑 고도화 (완료/대기 판단 + 윤문) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아침 자동 브리핑에서 (1) 이미 끝났거나 내 차례가 아닌 assigned PR을 코드로 판단해 "🕓 대기 중" 섹션으로 강등하고, (2) 데일리플랜 서술 문장을 기존 `HumanizeService`로 윤문한다.

**Architecture:** GitHub assigned PR에 신호(리뷰·코멘트·mergeable_state)를 best-effort 보강 → 순수 함수로 `ACTIVE/WAITING` 분류 → WAITING은 LLM 프롬프트에서 빼고 코드가 "대기 중" 섹션을 렌더. 윤문은 #121이 이미 머지한 `HumanizeService.humanize(fields)`를 재사용해 morning-briefing task 레벨에서 적용(= cron 전용 자동 충족). 둘 다 graceful — 실패해도 브리핑은 발송.

**Tech Stack:** NestJS 10, TypeScript, Prisma 6, Octokit, Jest. 패키지 매니저 **pnpm@9.15.9**.

**설계 문서:** `docs/superpowers/specs/2026-06-30-morning-briefing-enhancement-design.md`

## Global Constraints

- 패키지 매니저: **pnpm only** (`npm`/`yarn` 금지).
- 완료 게이트: `pnpm lint:check && pnpm test && pnpm build` 3중 exit 0.
- `process.env` 직접 참조 금지 → `ConfigService.get(...)`.
- ORM은 Prisma만. 줄임말 변수명 금지(`error`/`found`/`repository`/`request`). `if`는 항상 중괄호. try-catch 안 `return await`.
- 인라인 반환 타입 금지 — 별도 interface/type로 추출.
- 커밋은 의미 단위 atomic, 한국어 OK, 형식 `<type>(<scope>): <subject>`. **사용자 명시 요청 전 push 금지**(로컬 커밋은 plan 단계별로 진행).
- 작업 디렉터리: worktree `/Users/juneseok/Desktop/backend/기타/personal_agents/.claude/worktrees/feat+morning-briefing-enhancement` (모든 경로는 이 prefix 기준). 절대경로가 메인 레포 가리키지 않게 주의(memory `feedback_worktree_absolute_path`).
- 새 env 추가 시 5곳 동기: `.env.example`·`.env`·`src/config/app.config.ts`·`README.md`·`docs/env-catalog.md` + `pnpm docs:check`.

## File Structure

**신규**
- `src/github/domain/pr-engagement.type.ts` — 신호 타입 `PullRequestEngagementSignals`, `MergeableState`, 분류 결과 `EngagementClassification`, `WaitingItem`.
- `src/github/domain/classify-pr-engagement.ts` (+ `.spec.ts`) — 순수 분류 함수.
- `src/github/application/classify-pr-engagement.usecase.ts` (+ `.spec.ts`) — 신호 보강(포트) + 분류 + ACTIVE/WAITING 분리.
- `src/slack/format/waiting-section.formatter.ts` (+ `.spec.ts`) — "대기 중" 섹션 렌더.

**수정**
- `src/github/domain/port/github-client.port.ts` — 포트 메서드 `fetchPullRequestEngagement` 추가.
- `src/github/infrastructure/octokit-github.client.ts` (+ `.spec.ts`) — 신호 보강 구현 + owner login 캐시.
- `src/github/github.module.ts` — `ClassifyPullRequestEngagementUsecase` provide+export.
- `src/humanize/application/humanize-report.adapter.ts` (+ `.spec.ts`) — `humanizeDailyPlan` 추가.
- `src/agent/pm/domain/pm-agent.type.ts` — `DailyPlanResult.waitingItems` 추가.
- `src/agent/pm/application/daily-plan-context.collector.ts` (+ `.spec.ts`) — 분류 분기 + `waitingItems`.
- `src/agent/pm/application/generate-daily-plan.usecase.ts` (+ `.spec.ts`) — 모드 결정 + `waitingItems` 반환.
- `src/agent/pm/pm-agent.module.ts` — 컬렉터에 새 usecase 주입(GithubModule export 활용).
- `src/autopilot/infrastructure/tasks/morning-briefing.autopilot-task.ts` (+ `.spec.ts`) — `HumanizeService` 주입 + 윤문 + 대기 섹션.
- `src/config/app.config.ts` + `.env.example` + `.env` + `README.md` + `docs/env-catalog.md` — `BRIEFING_WAITING_SECTION_ENABLED`.

---

### Task 1: PR engagement 신호 타입 + 순수 분류 함수

**Files:**
- Create: `src/github/domain/pr-engagement.type.ts`
- Create: `src/github/domain/classify-pr-engagement.ts`
- Test: `src/github/domain/classify-pr-engagement.spec.ts`

**Interfaces:**
- Produces:
  - `MergeableState = 'clean'|'dirty'|'blocked'|'behind'|'unstable'|'draft'|'unknown'`
  - `PullRequestEngagementSignals { repo: string; number: number; title: string; url: string; isApproved: boolean; iAmAuthor: boolean; iAmRequestedReviewer: boolean; iRequestedChanges: boolean; iActedRecently: boolean; mergeableState: MergeableState }`
  - `EngagementState = 'ACTIVE'|'WAITING'`
  - `EngagementClassification { state: EngagementState; reason: string }`
  - `WaitingItem { title: string; url: string; reason: string }`
  - `classifyPullRequestEngagement(signals: PullRequestEngagementSignals): EngagementClassification`

- [ ] **Step 1: 타입 파일 작성**

`src/github/domain/pr-engagement.type.ts`:
```ts
// assigned PR 의 "내 차례인가 / 대기인가" 판정을 위한 신호 묶음.
// octokit client 가 best-effort 로 채우고, classify-pr-engagement 가 소비한다.
export type MergeableState =
  | 'clean'
  | 'dirty'
  | 'blocked'
  | 'behind'
  | 'unstable'
  | 'draft'
  | 'unknown';

export interface PullRequestEngagementSignals {
  repo: string; // "owner/repo"
  number: number;
  title: string;
  url: string;
  isApproved: boolean;
  iAmAuthor: boolean;
  // GitHub 가 아직 내 리뷰를 기다리는 상태 (requested_reviewers 에 내가 포함 = 미리뷰).
  iAmRequestedReviewer: boolean;
  // 내 최신 결정적 리뷰가 CHANGES_REQUESTED.
  iRequestedChanges: boolean;
  // 최근 WAITING_LOOKBACK_HOURS 내 내가 리뷰/코멘트했고 그 이후 타인 활동이 없음.
  iActedRecently: boolean;
  mergeableState: MergeableState;
}

export type EngagementState = 'ACTIVE' | 'WAITING';

export interface EngagementClassification {
  state: EngagementState;
  reason: string; // WAITING 사유. ACTIVE 면 빈 문자열.
}

// 브리핑 "대기 중" 섹션에 렌더할 항목 (PR 에서 파생).
export interface WaitingItem {
  title: string;
  url: string;
  reason: string;
}
```

- [ ] **Step 2: 실패 테스트 작성**

`src/github/domain/classify-pr-engagement.spec.ts`:
```ts
import { classifyPullRequestEngagement } from './classify-pr-engagement';
import { PullRequestEngagementSignals } from './pr-engagement.type';

const base: PullRequestEngagementSignals = {
  repo: 'o/r',
  number: 1,
  title: 't',
  url: 'https://x',
  isApproved: false,
  iAmAuthor: false,
  iAmRequestedReviewer: false,
  iRequestedChanges: false,
  iActedRecently: false,
  mergeableState: 'unknown',
};

describe('classifyPullRequestEngagement', () => {
  it('clean + approved → WAITING 머지만 남음', () => {
    const r = classifyPullRequestEngagement({
      ...base,
      mergeableState: 'clean',
      isApproved: true,
    });
    expect(r.state).toBe('WAITING');
    expect(r.reason).toContain('머지');
  });

  it('내가 변경요청 → WAITING 작성자 응답 대기', () => {
    const r = classifyPullRequestEngagement({ ...base, iRequestedChanges: true });
    expect(r.state).toBe('WAITING');
    expect(r.reason).toContain('변경 요청');
  });

  it('내가 최근 활동 + 요청리뷰어 아님 → WAITING 검토 남김', () => {
    const r = classifyPullRequestEngagement({ ...base, iActedRecently: true });
    expect(r.state).toBe('WAITING');
    expect(r.reason).toContain('검토');
  });

  it('blocked + 요청리뷰어 아님 → WAITING 다른 리뷰어·CI', () => {
    const r = classifyPullRequestEngagement({ ...base, mergeableState: 'blocked' });
    expect(r.state).toBe('WAITING');
  });

  it('unstable + author 아님 → WAITING CI 실패', () => {
    const r = classifyPullRequestEngagement({ ...base, mergeableState: 'unstable' });
    expect(r.state).toBe('WAITING');
    expect(r.reason).toContain('CI');
  });

  it('요청리뷰어인데 미리뷰(blocked) → ACTIVE (내 차례)', () => {
    const r = classifyPullRequestEngagement({
      ...base,
      mergeableState: 'blocked',
      iAmRequestedReviewer: true,
    });
    expect(r.state).toBe('ACTIVE');
  });

  it('최근 활동했지만 아직 요청리뷰어 → ACTIVE (내 차례)', () => {
    const r = classifyPullRequestEngagement({
      ...base,
      iActedRecently: true,
      iAmRequestedReviewer: true,
    });
    expect(r.state).toBe('ACTIVE');
  });

  it('신호 전부 unknown/false → ACTIVE (기본)', () => {
    expect(classifyPullRequestEngagement(base).state).toBe('ACTIVE');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm test -- classify-pr-engagement`
Expected: FAIL (`classify-pr-engagement` 모듈 없음).

- [ ] **Step 4: 분류 함수 구현**

`src/github/domain/classify-pr-engagement.ts`:
```ts
import {
  EngagementClassification,
  PullRequestEngagementSignals,
} from './pr-engagement.type';

// 보수적 규칙 — 명확히 "내 차례 아님 / 내 몫 끝" 인 경우만 WAITING, 애매하면 ACTIVE.
// 위에서부터 첫 매치를 반환한다.
export const classifyPullRequestEngagement = (
  signals: PullRequestEngagementSignals,
): EngagementClassification => {
  if (signals.mergeableState === 'clean' && signals.isApproved) {
    return { state: 'WAITING', reason: '승인·충돌 없음 — 머지만 남음' };
  }
  if (signals.iRequestedChanges) {
    return { state: 'WAITING', reason: '변경 요청함 — 작성자 응답 대기' };
  }
  if (signals.iActedRecently && !signals.iAmRequestedReviewer) {
    return { state: 'WAITING', reason: '검토 남김 — 작성자/리뷰어 응답 대기' };
  }
  if (signals.mergeableState === 'blocked' && !signals.iAmRequestedReviewer) {
    return { state: 'WAITING', reason: '다른 리뷰어·CI 대기' };
  }
  if (signals.mergeableState === 'unstable' && !signals.iAmAuthor) {
    return { state: 'WAITING', reason: 'CI 실패 — 작성자 처리 대기' };
  }
  return { state: 'ACTIVE', reason: '' };
};
```

- [ ] **Step 5: 테스트 통과 확인 + 커밋**

Run: `pnpm test -- classify-pr-engagement` → PASS
```bash
git add src/github/domain/pr-engagement.type.ts src/github/domain/classify-pr-engagement.ts src/github/domain/classify-pr-engagement.spec.ts
git commit -m "feat(github): PR engagement 신호 타입 + 결정론 분류 순수함수"
```

---

### Task 2: "대기 중" 섹션 formatter

**Files:**
- Create: `src/slack/format/waiting-section.formatter.ts`
- Test: `src/slack/format/waiting-section.formatter.spec.ts`

**Interfaces:**
- Consumes: `WaitingItem` (Task 1), `isSafeHttpUrl`/`sanitizeForSlackLink` (기존 `src/slack/format/mrkdwn.util.ts`).
- Produces: `formatWaitingSection(items: WaitingItem[]): string` — 빈 배열이면 `''`, 아니면 앞에 빈 줄 2개를 둔 섹션 문자열.

- [ ] **Step 1: 실패 테스트 작성**

`src/slack/format/waiting-section.formatter.spec.ts`:
```ts
import { WaitingItem } from '../../github/domain/pr-engagement.type';
import { formatWaitingSection } from './waiting-section.formatter';

describe('formatWaitingSection', () => {
  it('빈 배열 → 빈 문자열', () => {
    expect(formatWaitingSection([])).toBe('');
  });

  it('항목을 사유와 함께 링크로 렌더', () => {
    const items: WaitingItem[] = [
      { title: 'PR A', url: 'https://github.com/o/r/pull/1', reason: '머지만 남음' },
    ];
    const out = formatWaitingSection(items);
    expect(out).toContain('대기 중');
    expect(out).toContain('머지만 남음');
    expect(out).toContain('<https://github.com/o/r/pull/1|PR A>');
  });

  it('안전하지 않은 url 은 평문 제목으로 fallback', () => {
    const items: WaitingItem[] = [
      { title: 'PR B', url: 'javascript:alert(1)', reason: 'CI 대기' },
    ];
    const out = formatWaitingSection(items);
    expect(out).toContain('PR B');
    expect(out).not.toContain('javascript:');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- waiting-section.formatter`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: formatter 구현**

`src/slack/format/waiting-section.formatter.ts`:
```ts
import { WaitingItem } from '../../github/domain/pr-engagement.type';
import { isSafeHttpUrl, sanitizeForSlackLink } from './mrkdwn.util';

// 끝났거나 내 차례가 아닌 PR 을 "확인만" 하도록 강등 노출하는 섹션.
// formatDailyPlan 출력 뒤에 이어 붙이므로 앞에 빈 줄 2개로 분리한다. 항목 없으면 빈 문자열.
export const formatWaitingSection = (items: WaitingItem[]): string => {
  if (items.length === 0) {
    return '';
  }
  const lines = ['', '', '🕓 *대기 중 (확인만)*'];
  for (const item of items) {
    const titled =
      item.url.length > 0 && isSafeHttpUrl(item.url)
        ? `<${sanitizeForSlackLink(item.url)}|${sanitizeForSlackLink(item.title)}>`
        : item.title;
    lines.push(`• ${titled} — _${item.reason}_`);
  }
  return lines.join('\n');
};
```

- [ ] **Step 4: 테스트 통과 확인 + 커밋**

Run: `pnpm test -- waiting-section.formatter` → PASS
```bash
git add src/slack/format/waiting-section.formatter.ts src/slack/format/waiting-section.formatter.spec.ts
git commit -m "feat(slack): 브리핑 대기 중 섹션 formatter"
```

---

### Task 3: `humanizeDailyPlan` 어댑터 (기존 HumanizeService 재사용)

**Files:**
- Modify: `src/humanize/application/humanize-report.adapter.ts`
- Test: `src/humanize/application/humanize-report.adapter.spec.ts` (기존 파일에 describe 추가)

**Interfaces:**
- Consumes: `HumanizeService.humanize(fields: Record<string,string>): Promise<Record<string,string>>` (기존), `DailyPlan` (`src/agent/pm/domain/pm-agent.type.ts`).
- Produces: `humanizeDailyPlan(plan: DailyPlan, humanizer: HumanizeService): Promise<DailyPlan>` — `reasoning`/`varianceAnalysis.analysisReasoning`/`blocker`만 윤문본으로 교체, 나머지(TaskItem·estimatedHours 등) 불변.

- [ ] **Step 1: 실패 테스트 작성**

`humanize-report.adapter.spec.ts`에 추가:
```ts
import { humanizeDailyPlan } from './humanize-report.adapter';
import { DailyPlan } from '../../agent/pm/domain/pm-agent.type';

const samplePlan = (): DailyPlan => ({
  topPriority: { id: 'o/r#1', title: 'PR 리뷰', source: 'GITHUB', subtasks: [], isCriticalPath: true },
  varianceAnalysis: { rolledOverTasks: ['x'], analysisReasoning: '이월 근거 원문' },
  morning: [],
  afternoon: [],
  blocker: '배너 PR 위치 확인 필요',
  estimatedHours: 4,
  reasoning: '판단 근거 원문',
});

describe('humanizeDailyPlan', () => {
  const makeHumanizer = (map: Record<string, string>) =>
    ({ humanize: jest.fn().mockResolvedValue(map) }) as any;

  it('서술 필드만 윤문본으로 교체, 나머지 불변', async () => {
    const plan = samplePlan();
    const humanizer = makeHumanizer({
      reasoning: '판단 근거 윤문',
      analysisReasoning: '이월 근거 윤문',
      blocker: '배너 PR 위치 확인 필요',
    });
    const out = await humanizeDailyPlan(plan, humanizer);
    expect(out.reasoning).toBe('판단 근거 윤문');
    expect(out.varianceAnalysis.analysisReasoning).toBe('이월 근거 윤문');
    expect(out.varianceAnalysis.rolledOverTasks).toEqual(['x']);
    expect(out.estimatedHours).toBe(4);
    expect(out.topPriority.title).toBe('PR 리뷰');
  });

  it('blocker 가 null 이면 humanize 입력에서 제외하고 null 유지', async () => {
    const plan = { ...samplePlan(), blocker: null };
    const humanizer = makeHumanizer({
      reasoning: 'r',
      analysisReasoning: 'a',
    });
    const out = await humanizeDailyPlan(plan, humanizer);
    const passedFields = (humanizer.humanize as jest.Mock).mock.calls[0][0];
    expect(passedFields).not.toHaveProperty('blocker');
    expect(out.blocker).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- humanize-report.adapter`
Expected: FAIL (`humanizeDailyPlan` 미정의).

- [ ] **Step 3: 어댑터 함수 구현**

`humanize-report.adapter.ts` 상단 import 추가 + 함수 추가:
```ts
import { DailyPlan } from '../../agent/pm/domain/pm-agent.type';
// ... 기존 import 유지

// PM 데일리플랜의 서술 문장만 윤문. TaskItem 제목·수치·lineage 등은 보존.
// blocker 는 null 이면 humanize 입력에서 제외(빈값 키는 humanize() 가 자동 스킵하나, 명시적으로 뺀다).
export const humanizeDailyPlan = async (
  plan: DailyPlan,
  humanizer: HumanizeService,
): Promise<DailyPlan> => {
  const fields: Record<string, string> = {
    reasoning: plan.reasoning,
    analysisReasoning: plan.varianceAnalysis.analysisReasoning,
  };
  if (plan.blocker) {
    fields.blocker = plan.blocker;
  }

  const humanized = await humanizer.humanize(fields);

  return {
    ...plan,
    reasoning: humanized.reasoning,
    varianceAnalysis: {
      ...plan.varianceAnalysis,
      analysisReasoning: humanized.analysisReasoning,
    },
    blocker: plan.blocker ? humanized.blocker : plan.blocker,
  };
};
```

- [ ] **Step 4: 테스트 통과 확인 + 커밋**

Run: `pnpm test -- humanize-report.adapter` → PASS
```bash
git add src/humanize/application/humanize-report.adapter.ts src/humanize/application/humanize-report.adapter.spec.ts
git commit -m "feat(humanize): 데일리플랜 서술 윤문 어댑터 humanizeDailyPlan"
```

---

### Task 4: octokit `fetchPullRequestEngagement` (포트 + 구현)

**Files:**
- Modify: `src/github/domain/port/github-client.port.ts`
- Modify: `src/github/infrastructure/octokit-github.client.ts`
- Test: `src/github/infrastructure/octokit-github.client.spec.ts` (describe 추가)

**Interfaces:**
- Consumes: 기존 `GithubPullRequest[]`, `computeIsApprovedFromReviews`/`parseRepo` (같은 파일 내 헬퍼), octokit `pulls.get`/`pulls.listReviews`/`issues.listComments`/`users.getAuthenticated`.
- Produces: `GithubClientPort.fetchPullRequestEngagement(pullRequests: GithubPullRequest[]): Promise<PullRequestEngagementSignals[]>` — 입력 순서 보존, 캡(`ENGAGEMENT_ENRICH_MAX`) 초과분은 `mergeableState:'unknown'` + 모든 boolean false 신호(=ACTIVE)로 반환. 각 PR 보강 실패도 동일 fallback.

- [ ] **Step 1: 포트에 메서드 추가**

`github-client.port.ts` — `import { PullRequestEngagementSignals } from '../pr-engagement.type';` 추가 후 `GithubClientPort` 인터페이스에:
```ts
  // 아침 브리핑 완료/대기 분류용 PR 신호 보강. best-effort — 실패/캡 초과 PR 은
  // 중립 신호(mergeableState='unknown', 모든 flag false)로 채워 분류 시 ACTIVE 로 떨어진다.
  fetchPullRequestEngagement(
    pullRequests: GithubPullRequest[],
  ): Promise<PullRequestEngagementSignals[]>;
```
(상단 `GithubPullRequest` import 가 없다면 `../github.type` 에서 추가.)

- [ ] **Step 2: 실패 테스트 작성**

`octokit-github.client.spec.ts`에 추가 (mock octokit 패턴은 기존 spec 따름):
```ts
describe('fetchPullRequestEngagement', () => {
  it('clean + 내 승인 리뷰 → isApproved=true, mergeableState=clean', async () => {
    const octokit = {
      rest: {
        users: { getAuthenticated: jest.fn().mockResolvedValue({ data: { login: 'me' } }) },
        pulls: {
          get: jest.fn().mockResolvedValue({
            data: { user: { login: 'author' }, requested_reviewers: [], draft: false, mergeable_state: 'clean' },
          }),
          listReviews: jest.fn(),
        },
        issues: { listComments: jest.fn().mockResolvedValue({ data: [] }) },
      },
      paginate: jest.fn().mockResolvedValue([
        { state: 'APPROVED', submitted_at: '2026-06-30T00:00:00Z', user: { id: 1, login: 'me' } },
      ]),
    };
    const client = new OctokitGithubClient(octokit as any);
    const [s] = await client.fetchPullRequestEngagement([
      { number: 1, title: 't', repo: 'o/r', url: 'u', draft: false, updatedAt: '', requestedReviewers: [], isApproved: false },
    ]);
    expect(s.isApproved).toBe(true);
    expect(s.mergeableState).toBe('clean');
    expect(s.iAmAuthor).toBe(false);
  });

  it('pulls.get 실패 → 중립 신호(unknown, flag false)로 graceful', async () => {
    const octokit = {
      rest: {
        users: { getAuthenticated: jest.fn().mockResolvedValue({ data: { login: 'me' } }) },
        pulls: { get: jest.fn().mockRejectedValue(new Error('boom')), listReviews: jest.fn() },
        issues: { listComments: jest.fn() },
      },
      paginate: jest.fn().mockResolvedValue([]),
    };
    const client = new OctokitGithubClient(octokit as any);
    const [s] = await client.fetchPullRequestEngagement([
      { number: 1, title: 't', repo: 'o/r', url: 'u', draft: false, updatedAt: '', requestedReviewers: [], isApproved: false },
    ]);
    expect(s.mergeableState).toBe('unknown');
    expect(s.isApproved).toBe(false);
    expect(s.iActedRecently).toBe(false);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm test -- octokit-github.client`
Expected: FAIL (`fetchPullRequestEngagement` 미정의).

- [ ] **Step 4: 구현**

`octokit-github.client.ts` 상단 상수 + import:
```ts
import { MergeableState, PullRequestEngagementSignals } from '../domain/pr-engagement.type';
// ...
const ENGAGEMENT_ENRICH_MAX = 15;
const WAITING_LOOKBACK_HOURS = 48;
const MERGEABLE_STATES: ReadonlySet<string> = new Set([
  'clean', 'dirty', 'blocked', 'behind', 'unstable', 'draft',
]);
```

클래스에 owner login 캐시 필드 + 메서드:
```ts
  private cachedLogin: string | null = null;

  private async resolveLogin(): Promise<string | null> {
    if (this.cachedLogin) {
      return this.cachedLogin;
    }
    try {
      const me = await this.octokit!.rest.users.getAuthenticated();
      this.cachedLogin = me.data.login;
      return this.cachedLogin;
    } catch {
      return null;
    }
  }

  async fetchPullRequestEngagement(
    pullRequests: GithubPullRequest[],
  ): Promise<PullRequestEngagementSignals[]> {
    this.assertOctokitConfigured();
    const login = await this.resolveLogin();
    const cutoffMs = Date.now() - WAITING_LOOKBACK_HOURS * 60 * 60 * 1000;

    return Promise.all(
      pullRequests.map((pr, index) => {
        if (index >= ENGAGEMENT_ENRICH_MAX) {
          if (index === ENGAGEMENT_ENRICH_MAX) {
            this.logger.log(
              `engagement 보강 캡(${ENGAGEMENT_ENRICH_MAX}) 초과 — ${pullRequests.length - ENGAGEMENT_ENRICH_MAX}건은 ACTIVE 처리`,
            );
          }
          return Promise.resolve(neutralSignals(pr));
        }
        return this.fetchSingleEngagementSafely(pr, login, cutoffMs);
      }),
    );
  }

  private async fetchSingleEngagementSafely(
    pr: GithubPullRequest,
    login: string | null,
    cutoffMs: number,
  ): Promise<PullRequestEngagementSignals> {
    try {
      const [owner, repoName] = parseRepo(pr.repo);
      const detail = await this.octokit!.rest.pulls.get({
        owner,
        repo: repoName,
        pull_number: pr.number,
      });
      const reviews = await this.octokit!.paginate(
        this.octokit!.rest.pulls.listReviews,
        { owner, repo: repoName, pull_number: pr.number, per_page: 100 },
      );
      const comments = await this.octokit!.paginate(
        this.octokit!.rest.issues.listComments,
        { owner, repo: repoName, issue_number: pr.number, per_page: 100 },
      );

      const author = detail.data.user?.login ?? '';
      const requestedReviewers = (detail.data.requested_reviewers ?? [])
        .map((r: { login?: string }) => r.login)
        .filter((l): l is string => !!l);
      const rawState = detail.data.mergeable_state ?? 'unknown';
      const mergeableState: MergeableState = MERGEABLE_STATES.has(rawState)
        ? (rawState as MergeableState)
        : 'unknown';

      const myLatestReview = latestReviewBy(reviews, login);
      const myLastActivityMs = computeMyLastActivityMs(reviews, comments, login);
      const latestOtherActivityMs = computeLatestOtherActivityMs(reviews, comments, login);

      return {
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        isApproved: computeIsApprovedFromReviews(reviews),
        iAmAuthor: !!login && author === login,
        iAmRequestedReviewer: !!login && requestedReviewers.includes(login),
        iRequestedChanges: myLatestReview === 'CHANGES_REQUESTED',
        iActedRecently:
          myLastActivityMs !== null &&
          myLastActivityMs >= cutoffMs &&
          (latestOtherActivityMs === null || latestOtherActivityMs <= myLastActivityMs),
        mergeableState,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `PR ${pr.repo}#${pr.number} engagement 보강 실패 — 중립 신호(ACTIVE)로 fallback: ${message}`,
      );
      return neutralSignals(pr);
    }
  }
```

파일 하단 모듈 스코프 헬퍼 추가:
```ts
const neutralSignals = (pr: GithubPullRequest): PullRequestEngagementSignals => ({
  repo: pr.repo,
  number: pr.number,
  title: pr.title,
  url: pr.url,
  isApproved: pr.isApproved,
  iAmAuthor: false,
  iAmRequestedReviewer: false,
  iRequestedChanges: false,
  iActedRecently: false,
  mergeableState: 'unknown',
});

// reviews 중 내 최신 결정적 리뷰 state (없으면 null).
const latestReviewBy = (
  reviews: PullsReview[],
  login: string | null,
): string | null => {
  if (!login) {
    return null;
  }
  const mine = reviews
    .filter((r) => (r.user?.login ?? '') === login && !!r.submitted_at)
    .sort((a, b) => (a.submitted_at! > b.submitted_at! ? 1 : -1));
  return mine.length > 0 ? (mine[mine.length - 1].state ?? null) : null;
};

type IssueComment = { created_at?: string | null; user?: { login?: string } | null };

const toMs = (iso?: string | null): number | null =>
  iso ? new Date(iso).getTime() : null;

const computeMyLastActivityMs = (
  reviews: PullsReview[],
  comments: IssueComment[],
  login: string | null,
): number | null => {
  if (!login) {
    return null;
  }
  const times: number[] = [];
  for (const r of reviews) {
    if ((r.user?.login ?? '') === login) {
      const ms = toMs(r.submitted_at);
      if (ms !== null) times.push(ms);
    }
  }
  for (const c of comments) {
    if ((c.user?.login ?? '') === login) {
      const ms = toMs(c.created_at);
      if (ms !== null) times.push(ms);
    }
  }
  return times.length > 0 ? Math.max(...times) : null;
};

const computeLatestOtherActivityMs = (
  reviews: PullsReview[],
  comments: IssueComment[],
  login: string | null,
): number | null => {
  const times: number[] = [];
  for (const r of reviews) {
    if ((r.user?.login ?? '') !== login) {
      const ms = toMs(r.submitted_at);
      if (ms !== null) times.push(ms);
    }
  }
  for (const c of comments) {
    if ((c.user?.login ?? '') !== login) {
      const ms = toMs(c.created_at);
      if (ms !== null) times.push(ms);
    }
  }
  return times.length > 0 ? Math.max(...times) : null;
};
```
> `if (ms !== null) times.push(ms);` 는 CODE_RULES 의 중괄호 규칙을 지켜 `if (ms !== null) { times.push(ms); }` 로 작성한다.

- [ ] **Step 5: 테스트 통과 확인 + 커밋**

Run: `pnpm test -- octokit-github.client` → PASS
```bash
git add src/github/domain/port/github-client.port.ts src/github/infrastructure/octokit-github.client.ts src/github/infrastructure/octokit-github.client.spec.ts
git commit -m "feat(github): assigned PR engagement 신호 best-effort 보강"
```

---

### Task 5: `ClassifyPullRequestEngagementUsecase`

**Files:**
- Create: `src/github/application/classify-pr-engagement.usecase.ts`
- Test: `src/github/application/classify-pr-engagement.usecase.spec.ts`
- Modify: `src/github/github.module.ts`

**Interfaces:**
- Consumes: `GITHUB_CLIENT_PORT.fetchPullRequestEngagement` (Task 4), `classifyPullRequestEngagement` (Task 1), `GithubPullRequest`, `WaitingItem`.
- Produces: `ClassifyPullRequestEngagementUsecase.execute(pullRequests: GithubPullRequest[]): Promise<EngagementSplit>` where `EngagementSplit { activePullRequests: GithubPullRequest[]; waitingItems: WaitingItem[] }`.

- [ ] **Step 1: 실패 테스트 작성**

`classify-pr-engagement.usecase.spec.ts`:
```ts
import { ClassifyPullRequestEngagementUsecase } from './classify-pr-engagement.usecase';

const pr = (n: number) => ({
  number: n, title: `PR${n}`, repo: 'o/r', url: `https://x/${n}`,
  draft: false, updatedAt: '', requestedReviewers: [], isApproved: false,
});

describe('ClassifyPullRequestEngagementUsecase', () => {
  it('WAITING 신호는 waitingItems 로, 나머지는 activePullRequests 로 분리', async () => {
    const client = {
      fetchPullRequestEngagement: jest.fn().mockResolvedValue([
        { repo: 'o/r', number: 1, title: 'PR1', url: 'https://x/1', isApproved: true, iAmAuthor: false, iAmRequestedReviewer: false, iRequestedChanges: false, iActedRecently: false, mergeableState: 'clean' },
        { repo: 'o/r', number: 2, title: 'PR2', url: 'https://x/2', isApproved: false, iAmAuthor: false, iAmRequestedReviewer: true, iRequestedChanges: false, iActedRecently: false, mergeableState: 'blocked' },
      ]),
    };
    const usecase = new ClassifyPullRequestEngagementUsecase(client as any);
    const result = await usecase.execute([pr(1), pr(2)]);
    expect(result.waitingItems).toHaveLength(1);
    expect(result.waitingItems[0].title).toBe('PR1');
    expect(result.activePullRequests.map((p) => p.number)).toEqual([2]);
  });

  it('신호 누락 PR 은 ACTIVE 로 보존 (signal 매칭 실패 graceful)', async () => {
    const client = { fetchPullRequestEngagement: jest.fn().mockResolvedValue([]) };
    const usecase = new ClassifyPullRequestEngagementUsecase(client as any);
    const result = await usecase.execute([pr(1)]);
    expect(result.activePullRequests).toHaveLength(1);
    expect(result.waitingItems).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- classify-pr-engagement.usecase`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: usecase 구현**

`src/github/application/classify-pr-engagement.usecase.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';

import { classifyPullRequestEngagement } from '../domain/classify-pr-engagement';
import { GithubPullRequest } from '../domain/github.type';
import { WaitingItem } from '../domain/pr-engagement.type';
import { GITHUB_CLIENT_PORT, GithubClientPort } from '../domain/port/github-client.port';

export interface EngagementSplit {
  activePullRequests: GithubPullRequest[];
  waitingItems: WaitingItem[];
}

// assigned PR 을 신호 보강 → 결정론 분류 → ACTIVE(LLM 노출) / WAITING(대기 섹션) 으로 분리.
// signal 이 매칭 안 되는 PR(보강 캡 외 등)은 ACTIVE 로 보존.
@Injectable()
export class ClassifyPullRequestEngagementUsecase {
  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async execute(pullRequests: GithubPullRequest[]): Promise<EngagementSplit> {
    if (pullRequests.length === 0) {
      return { activePullRequests: [], waitingItems: [] };
    }
    const signals = await this.githubClient.fetchPullRequestEngagement(pullRequests);
    const signalByKey = new Map(signals.map((s) => [`${s.repo}#${s.number}`, s]));

    const activePullRequests: GithubPullRequest[] = [];
    const waitingItems: WaitingItem[] = [];

    for (const pr of pullRequests) {
      const signal = signalByKey.get(`${pr.repo}#${pr.number}`);
      if (!signal) {
        activePullRequests.push(pr);
        continue;
      }
      const classification = classifyPullRequestEngagement(signal);
      if (classification.state === 'WAITING') {
        waitingItems.push({ title: pr.title, url: pr.url, reason: classification.reason });
      } else {
        activePullRequests.push(pr);
      }
    }

    return { activePullRequests, waitingItems };
  }
}
```

- [ ] **Step 4: 모듈 등록**

`github.module.ts` — `providers` 와 `exports` 에 `ClassifyPullRequestEngagementUsecase` 추가 (기존 `ListAssignedTasksUsecase` 와 동일 위치).

- [ ] **Step 5: 테스트 통과 확인 + 커밋**

Run: `pnpm test -- classify-pr-engagement.usecase` → PASS
```bash
git add src/github/application/classify-pr-engagement.usecase.ts src/github/application/classify-pr-engagement.usecase.spec.ts src/github/github.module.ts
git commit -m "feat(github): assigned PR 완료/대기 분리 usecase"
```

---

### Task 6: 컬렉터 분류 분기 + usecase `waitingItems` 반환

**Files:**
- Modify: `src/agent/pm/domain/pm-agent.type.ts`
- Modify: `src/agent/pm/application/daily-plan-context.collector.ts`
- Test: `src/agent/pm/application/daily-plan-context.collector.spec.ts`
- Modify: `src/agent/pm/application/generate-daily-plan.usecase.ts`
- Modify: `src/agent/pm/pm-agent.module.ts`

**Interfaces:**
- Consumes: `ClassifyPullRequestEngagementUsecase.execute` (Task 5), `WaitingItem` (Task 1).
- Produces:
  - `DailyPlanContext.waitingItems: WaitingItem[]` (collector 출력에 추가)
  - `collect({ userText, slackUserId, excludeApprovedPullRequests?, classifyWaitingPullRequests? })` — `classifyWaitingPullRequests=true` 면 분류 분기.
  - `DailyPlanResult.waitingItems: WaitingItem[]` (usecase 반환에 추가)

- [ ] **Step 1: 타입 추가**

`pm-agent.type.ts` — `import { WaitingItem } from '../../../github/domain/pr-engagement.type';` 추가 후 `DailyPlanResult` 에 필드 추가:
```ts
export interface DailyPlanResult {
  plan: DailyPlan;
  sources: DailyPlanSource[];
  // 아침 브리핑 완료/대기 강등 항목 (cron + 토글 ON 일 때만 채워짐. /today 는 빈 배열).
  waitingItems: WaitingItem[];
}
```

- [ ] **Step 2: 컬렉터 실패 테스트 작성**

`daily-plan-context.collector.spec.ts`에 추가 (기존 mock 구성 재사용):
```ts
it('classifyWaitingPullRequests=true → WAITING PR 은 waitingItems 로 분리되고 githubTasks 에서 빠짐', async () => {
  // listAssignedTasksUsecase 가 PR 2건 반환하도록 mock,
  // classifyEngagementUsecase.execute 가 {active:[pr2], waiting:[{title:'PR1',...}]} 반환하도록 mock
  // → context.githubTasks.pullRequests 에 pr2 만, context.waitingItems 에 PR1
  // (구체 mock 은 기존 spec 의 fetchGithubTasks mock 패턴을 따른다)
});

it('classifyWaitingPullRequests=false → 기존 동작(분류 미실행), waitingItems 빈 배열', async () => {
  // classifyEngagementUsecase.execute 가 호출되지 않음 + context.waitingItems === []
});
```
> 구현자는 기존 collector spec 의 `Promise.all` mock 구성과 `ListAssignedTasksUsecase` mock 을 그대로 활용하고, 새 `ClassifyPullRequestEngagementUsecase` mock 을 생성자에 추가한다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm test -- daily-plan-context.collector`
Expected: FAIL (`classifyWaitingPullRequests`/`waitingItems` 미지원).

- [ ] **Step 4: 컬렉터 구현**

`daily-plan-context.collector.ts`:
- 생성자에 `private readonly classifyEngagement: ClassifyPullRequestEngagementUsecase` 주입.
- `DailyPlanContext` 인터페이스에 `waitingItems: WaitingItem[]` 추가.
- `collect` 파라미터에 `classifyWaitingPullRequests = false` 추가.
- githubTasks 가공부 교체:
```ts
let githubTasks = githubTasksRaw;
let waitingItems: WaitingItem[] = [];

if (classifyWaitingPullRequests && githubTasksRaw) {
  const split = await this.classifyEngagement.execute(githubTasksRaw.pullRequests);
  githubTasks = { issues: githubTasksRaw.issues, pullRequests: split.activePullRequests };
  waitingItems = split.waitingItems;
} else if (excludeApprovedPullRequests && githubTasksRaw) {
  githubTasks = {
    issues: githubTasksRaw.issues,
    pullRequests: githubTasksRaw.pullRequests.filter((pr) => !pr.isApproved),
  };
}
```
- return 객체에 `waitingItems` 포함.

> import 추가: `ClassifyPullRequestEngagementUsecase`, `WaitingItem`. classifyEngagement 실패는 graceful 하게 try/catch 로 감싸 `waitingItems=[]` + 원본 githubTasks 유지(로그 warn) — usecase 내부가 이미 graceful 하지만 컬렉터 레벨에서도 한 번 더 방어.

- [ ] **Step 5: usecase 모드 결정 + waitingItems 반환**

`generate-daily-plan.usecase.ts`:
- 생성자에 `ConfigService` 주입(없으면 추가).
- `collect` 호출부 교체:
```ts
const waitingEnabled =
  this.configService.get<string>('BRIEFING_WAITING_SECTION_ENABLED') !== 'false';
const isCron = effectiveTriggerType === TriggerType.MORNING_BRIEFING_CRON;

const context = await this.contextCollector.collect({
  userText,
  slackUserId,
  classifyWaitingPullRequests: isCron && waitingEnabled,
  excludeApprovedPullRequests: isCron && !waitingEnabled,
});
```
- 최종 반환에 `waitingItems` 추가:
```ts
return {
  result: {
    plan: outcome.result,
    sources: extractSources(context),
    waitingItems: context.waitingItems,
  },
  modelUsed: outcome.modelUsed,
  agentRunId: outcome.agentRunId,
};
```

- [ ] **Step 6: 모듈 주입**

`pm-agent.module.ts` — `PmAgentModule` 이 `GithubModule` 을 이미 import 하므로(ListAssignedTasksUsecase 사용), Task 5에서 export 한 `ClassifyPullRequestEngagementUsecase` 가 주입 가능. 별도 변경은 GithubModule export 뿐(Task 5 완료). 확인만.

- [ ] **Step 7: 테스트 통과 + 기존 usecase spec 갱신 + 커밋**

`generate-daily-plan.usecase.spec.ts` — 반환 객체에 `waitingItems` 기대 추가, ConfigService mock 추가.
Run: `pnpm test -- daily-plan-context.collector generate-daily-plan`
Expected: PASS
```bash
git add src/agent/pm/
git commit -m "feat(pm): 데일리플랜 컨텍스트에 완료/대기 분리 + waitingItems 반환"
```

---

### Task 7: morning-briefing task 윤문 + 대기 섹션 wiring

**Files:**
- Modify: `src/autopilot/infrastructure/tasks/morning-briefing.autopilot-task.ts`
- Test: `src/autopilot/infrastructure/tasks/morning-briefing.autopilot-task.spec.ts`

**Interfaces:**
- Consumes: `humanizeDailyPlan` (Task 3), `formatWaitingSection` (Task 2), `HumanizeService` (기존), `outcome.result.waitingItems` (Task 6).

- [ ] **Step 1: 실패 테스트 작성/갱신**

`morning-briefing.autopilot-task.spec.ts`:
```ts
it('plan 을 윤문하고 대기 섹션을 summaryText 에 합성한다', async () => {
  const outcome = {
    result: {
      plan: { /* topPriority/morning/afternoon/varianceAnalysis/blocker/estimatedHours/reasoning */ },
      sources: [],
      waitingItems: [{ title: 'PR1', url: 'https://x/1', reason: '머지만 남음' }],
    },
    modelUsed: 'chatgpt',
    agentRunId: 1,
  };
  const generateDailyPlan = { execute: jest.fn().mockResolvedValue(outcome) };
  const humanizeService = { humanize: jest.fn().mockResolvedValue({ reasoning: '윤문', analysisReasoning: '윤문' }) };
  const task = new MorningBriefingAutopilotTask(generateDailyPlan as any, humanizeService as any);
  const result = await task.run({ ownerSlackUserId: 'U1', firedAtKst: '2026-06-30' });
  expect(result.summaryText).toContain('대기 중');
  expect(result.summaryText).toContain('머지만 남음');
});
```
> EMPTY_TASKS_INPUT 안내 경로 테스트는 기존 그대로 유지.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- morning-briefing.autopilot-task`
Expected: FAIL (생성자 인자/대기 섹션 미반영).

- [ ] **Step 3: task 구현**

`morning-briefing.autopilot-task.ts`:
```ts
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeDailyPlan } from '../../../humanize/application/humanize-report.adapter';
import { formatWaitingSection } from '../../../slack/format/waiting-section.formatter';
// ... 기존 import 유지

  constructor(
    private readonly generateDailyPlan: GenerateDailyPlanUsecase,
    private readonly humanizeService: HumanizeService,
  ) {}

  async run({ ownerSlackUserId }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    try {
      const outcome = await this.generateDailyPlan.execute({
        tasksText: '',
        slackUserId: ownerSlackUserId,
        triggerType: TriggerType.MORNING_BRIEFING_CRON,
      });
      const humanizedPlan = await humanizeDailyPlan(
        outcome.result.plan,
        this.humanizeService,
      );
      const text =
        formatDailyPlan(humanizedPlan) +
        formatWaitingSection(outcome.result.waitingItems) +
        formatModelFooter(outcome);
      return { skip: false, summaryText: text };
    } catch (error) {
      // ... 기존 EMPTY_TASKS_INPUT 분기 그대로
    }
  }
```
> `AutopilotModule` 은 `HumanizeModule` 을 이미 import 하므로 모듈 변경 불필요. `MorningBriefingAutopilotTask` 의 `useFactory`/`inject` 는 provider 클래스 자체라 생성자 주입이 자동 해결됨(추가 inject 배열 변경 불필요).

- [ ] **Step 4: 테스트 통과 확인 + 커밋**

Run: `pnpm test -- morning-briefing.autopilot-task` → PASS
```bash
git add src/autopilot/infrastructure/tasks/morning-briefing.autopilot-task.ts src/autopilot/infrastructure/tasks/morning-briefing.autopilot-task.spec.ts
git commit -m "feat(autopilot): 아침 브리핑 윤문 + 대기 중 섹션 합성"
```

---

### Task 8: env 추가 + 문서 동기 + 최종 게이트

**Files:**
- Modify: `src/config/app.config.ts`, `.env.example`, `.env`, `README.md`, `docs/env-catalog.md`

- [ ] **Step 1: env 5곳 동기 추가**

`BRIEFING_WAITING_SECTION_ENABLED`:
- `app.config.ts` — class-validator optional boolean string (기존 `HUMANIZE_REPORTS_ENABLED` 패턴 그대로 복제).
- `.env.example` — `BRIEFING_WAITING_SECTION_ENABLED=true` + 한 줄 주석(완료/대기 분류 토글).
- `.env` — `BRIEFING_WAITING_SECTION_ENABLED=true`.
- `README.md` — env 표에 행 추가.
- `docs/env-catalog.md` — 항목 추가.

- [ ] **Step 2: docs:check**

Run: `pnpm docs:check`
Expected: PASS (env-catalog 동기 확인). 실패 시 누락 문서 보강.

- [ ] **Step 3: 최종 3중 게이트**

Run:
```bash
pnpm lint:check && pnpm test && pnpm build
```
Expected: 모두 exit 0. 실패 시 수정 후 재실행.

- [ ] **Step 4: 커밋**

```bash
git add src/config/app.config.ts .env.example README.md docs/env-catalog.md
# .env 는 gitignore — 커밋 대상 아님 (로컬만 갱신)
git commit -m "chore(config): BRIEFING_WAITING_SECTION_ENABLED env + 문서 동기"
```

---

## Self-Review

**1. Spec coverage**
- 파트1 ① 신호 보강 → Task 4. ② 분류 → Task 1. ③ 분리/렌더 → Task 5(분리)·6(컬렉터/usecase)·2(formatter)·7(task 합성). ✅
- 파트2 윤문(humanizeDailyPlan 재사용) → Task 3·7. ✅
- env 1개 + docs:check → Task 8. ✅
- 토글 OFF=기존 동작 → Task 6 Step 5(분기). ✅
- graceful(보강/윤문 실패 시 원본) → Task 4(neutralSignals/try-catch), Task 3(humanize 내부), Task 6(컬렉터 방어). ✅
- /today 무변경 → Task 6(isCron 게이트, classifyWaiting=false). ✅

**2. Placeholder scan**
- Task 6 Step 2의 컬렉터 spec, Task 7 Step 1의 plan 객체는 "기존 mock 패턴 재사용" 지시 — 구현자가 기존 spec 파일의 동일 픽스처를 복제해야 하는 부분(완전 인라인이 길어 참조 지시로 둠). 그 외 모든 코드 스텝은 실제 코드 포함.

**3. Type consistency**
- `WaitingItem`(Task1) → formatter(Task2)·usecase(Task5)·DailyPlanResult(Task6)·task(Task7) 전부 동일 시그니처.
- `PullRequestEngagementSignals`(Task1) → octokit 반환(Task4) → usecase 입력(Task5) 일치.
- `fetchPullRequestEngagement(GithubPullRequest[])`(Task4 포트) = usecase 호출(Task5) 일치.
- `EngagementSplit{activePullRequests,waitingItems}`(Task5) = 컬렉터 소비(Task6) 일치.
- `humanizeDailyPlan(plan, humanizer)`(Task3) = task 호출(Task7) 일치.
