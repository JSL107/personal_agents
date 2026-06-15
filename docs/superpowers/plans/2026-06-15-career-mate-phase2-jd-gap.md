# 이직 메이트 Phase 2 구현 계획 — JD 갭 분석 → 주제 → BLOG 체인

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CAREER_MATE 에 `ANALYZE_JD_GAP` capability 추가 — JD 텍스트 + Phase 1 역량 허브 → 갭 리포트 + 갭 메우는 주제 N개 제안 → 사용자가 "N번" 선택 시 기존 BLOG 에이전트로 자동 체인.

**Architecture:** 새 에이전트 X. Phase 1 `CareerMateDispatcher` 에 action 추가 + `AnalyzeJdGapUsecase`(Claude, AgentRun 래핑) + PreviewGate(주제목록 TTL 보관) + `router-message.handler` 의 주제선택 intercept(기존 Y/N intercept 의 형제). 선택 시 `idaeriRouter.dispatch({text: 주제, agentTypeHint: BLOG})` 로 BLOG 직행 — handler 기존 의존성만 사용. 무상태(새 테이블 X).

**Tech Stack:** NestJS 10, Slack Bolt 4, class-validator, jest. LLM=Claude(model-router). PreviewGate(CreatePreview/Cancel/FindLatestPending). BLOG=기존 BlogDispatcher.

**선행 의존성:** Phase 1(`feat/career-mate-phase1`, PR #90). 이 브랜치(`feat/career-mate-phase2`)는 그 위에 스택됨.

**설계서:** `docs/superpowers/specs/2026-06-15-career-mate-phase2-jd-gap-design.md`

**확정된 사실 (탐색 검증 완료):**
- `PreviewApplier.apply(preview)` 는 preview 만 받음 + `ApplyPreviewUsecase` 는 binary → **N지선다는 ApplyPreview 안 거치고 intercept 가 직접 처리**. applier 조회는 apply 시점 lazy(`apply-preview.usecase.ts:51`, 없으면 throw)라 **CAREER_JD_GAP_BLOG kind 는 applier 불필요**(ApplyPreview 안 함). 소비는 `CancelPreviewUsecase`(PENDING→CANCELLED).
- `PreviewGateModule`(global) 이 `CreatePreviewUsecase` export → 주입 가능.
- 라우터가 `agentTypeHint` 존중(`idaeri-router.usecase.ts:73`) → BLOG 직행 가능.
- `DispatchInput { source, slackUserId, text?, agentTypeHint?, contextRefs?, priorTurns?, conversationContext? }`.

---

## File Structure

**생성:**
- `src/agent/career-mate/domain/prompt/jd-gap.prompt.ts` — system prompt + `buildJdGapPrompt(profile, jdText)` + `parseGapAnalysisOutput(text)`
- `src/agent/career-mate/application/analyze-jd-gap.usecase.ts` — 허브 read(없으면 자동 Build) → Claude → preview 생성, AgentRun 래핑
- `src/slack/handler/topic-selection-detector.ts` — `parseTopicSelection(text, topicCount)`
- 각 `*.spec.ts`

**수정:**
- `src/preview-gate/domain/preview-action.type.ts` — `PREVIEW_KIND.CAREER_JD_GAP_BLOG`
- `src/agent/career-mate/domain/career-mate.type.ts` — `ANALYZE_JD_GAP`, `jdText`, `GapTopic`, `GapAnalysisData`, `AnalyzeJdGapInput`
- `src/agent/career-mate/domain/prompt/career-mate-intent.prompt.ts` — `ANALYZE_JD_GAP` 분류
- `src/agent/career-mate/domain/career-mate-error-code.enum.ts` + `src/common/exception/response-code.enum.ts` — `CAREER_MATE_JD_EMPTY`
- `src/agent/career-mate/infrastructure/career-mate.formatter.ts` — `formatGapReport(data)`
- `src/agent/career-mate/infrastructure/career-mate.dispatcher.ts` — `ANALYZE_JD_GAP` case
- `src/agent/career-mate/career-mate.module.ts` — `AnalyzeJdGapUsecase` 등록
- `src/slack/handler/router-message.handler.ts` — `tryHandleGapTopicSelection` intercept

---

## Task 1: PREVIEW_KIND 에 CAREER_JD_GAP_BLOG 추가

**Files:** Modify `src/preview-gate/domain/preview-action.type.ts`

- [ ] **Step 1: kind 추가**

`PREVIEW_KIND` const 에 추가 (`BE_SANDBOX_PUSH_PR` 줄 아래):
```typescript
export const PREVIEW_KIND = {
  PM_WRITE_BACK: 'PM_WRITE_BACK',
  PO_EVAL_CAREERLOG: 'PO_EVAL_CAREERLOG',
  BE_SANDBOX_APPLY: 'BE_SANDBOX_APPLY',
  BE_SANDBOX_PUSH_PR: 'BE_SANDBOX_PUSH_PR',
  // Phase 2 — JD 갭 분석 후 주제 선택 대기. applier 없음(ApplyPreview 안 거치고
  // router-message intercept 가 직접 BLOG 체인 + cancel 로 consume).
  CAREER_JD_GAP_BLOG: 'CAREER_JD_GAP_BLOG',
} as const;
```

- [ ] **Step 2: 빌드**

Run: `pnpm build`
Expected: 성공 (`PreviewKind` union 에 새 멤버 추가됨, exhaustive 소비처 없음 — apply 는 lazy find).

- [ ] **Step 3: Commit**

```bash
git add src/preview-gate/domain/preview-action.type.ts
git commit -m "feat(career-mate): PREVIEW_KIND 에 CAREER_JD_GAP_BLOG 추가"
```

---

## Task 2: 도메인 타입 + 에러코드

**Files:**
- Modify: `src/agent/career-mate/domain/career-mate.type.ts`
- Modify: `src/agent/career-mate/domain/career-mate-error-code.enum.ts`
- Modify: `src/common/exception/response-code.enum.ts`

- [ ] **Step 1: career-mate.type.ts — action/intent 확장 + 신규 타입**

`CareerMateAction` 과 `CareerMateIntent` 수정 + 파일 끝에 타입 추가:
```typescript
export type CareerMateAction =
  | 'BUILD_PROFILE'
  | 'RENDER_RESUME'
  | 'RENDER_PORTFOLIO'
  | 'ANALYZE_JD_GAP'
  | 'UNKNOWN';

export interface CareerMateIntent {
  action: CareerMateAction;
  windowMonths?: number;
}

export interface GapTopic {
  title: string;
  rationale: string;
}

export interface GapAnalysisData {
  fitSummary: string;
  have: string[];
  gaps: string[];
  topics: GapTopic[];
}

export interface AnalyzeJdGapInput {
  slackUserId: string;
  jdText: string;
}
```
> `jdText` 는 intent 에 안 넣음 — 디스패처가 `input.text` 전체를 jdText 로 usecase 에 넘김(intent 파서는 분류만).

- [ ] **Step 2: 에러코드 추가**

`src/agent/career-mate/domain/career-mate-error-code.enum.ts`:
```typescript
export enum CareerMateErrorCode {
  NL_PARSE_FAILED = 'CAREER_MATE_NL_PARSE_FAILED',
  NO_EVIDENCE = 'CAREER_MATE_NO_EVIDENCE',
  INVALID_MODEL_OUTPUT = 'CAREER_MATE_INVALID_MODEL_OUTPUT',
  CONFIG_MISSING = 'CAREER_MATE_CONFIG_MISSING',
  JD_EMPTY = 'CAREER_MATE_JD_EMPTY',
}
```

- [ ] **Step 3: ResponseCode 동기**

`src/common/exception/response-code.enum.ts` 의 career-mate 블록(`CAREER_MATE_CONFIG_MISSING` 줄 아래)에 추가:
```typescript
  CAREER_MATE_CONFIG_MISSING = 'CAREER_MATE_CONFIG_MISSING',
  CAREER_MATE_JD_EMPTY = 'CAREER_MATE_JD_EMPTY',
```

- [ ] **Step 4: 빌드**

Run: `pnpm build`
Expected: 성공.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/domain/career-mate.type.ts src/agent/career-mate/domain/career-mate-error-code.enum.ts src/common/exception/response-code.enum.ts
git commit -m "feat(career-mate): JD 갭 도메인 타입 + JD_EMPTY 에러코드"
```

---

## Task 3: JD 갭 프롬프트 + 출력 파서 (`jd-gap.prompt.ts`)

**Files:**
- Create: `src/agent/career-mate/domain/prompt/jd-gap.prompt.ts`
- Test: `src/agent/career-mate/domain/prompt/jd-gap.prompt.spec.ts`

- [ ] **Step 1: 실패 테스트**

`jd-gap.prompt.spec.ts`:
```typescript
import { CareerMateException } from '../career-mate.exception';
import { CareerProfileData } from '../career-mate.type';
import { buildJdGapPrompt, parseGapAnalysisOutput } from './jd-gap.prompt';

const PROFILE: CareerProfileData = {
  summary: '백엔드 5년차',
  skills: [
    { name: 'NestJS', category: 'FRAMEWORK', proficiency: 'EXPERT', evidence: [{ repo: 'o/r', pr: 1, url: 'https://x/1' }] },
  ],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

const VALID = JSON.stringify({
  fitSummary: '핵심 요건 부합, 분산처리 강점',
  have: ['NestJS', 'PostgreSQL'],
  gaps: ['Kubernetes', '대규모 트래픽'],
  topics: [
    { title: 'BullMQ 로 분산 큐 안정화한 경험', rationale: '대규모 트래픽 갭' },
    { title: 'K8s 입문 회고', rationale: 'Kubernetes 갭' },
  ],
});

describe('buildJdGapPrompt', () => {
  it('프로필 스킬과 JD 텍스트를 프롬프트에 포함한다', () => {
    const prompt = buildJdGapPrompt(PROFILE, '시니어 백엔드, K8s 필수');
    expect(prompt).toContain('NestJS');
    expect(prompt).toContain('K8s 필수');
  });
});

describe('parseGapAnalysisOutput', () => {
  it('유효 JSON 을 GapAnalysisData 로 파싱한다', () => {
    const data = parseGapAnalysisOutput(VALID);
    expect(data.gaps).toContain('Kubernetes');
    expect(data.topics[0].title).toContain('BullMQ');
  });

  it('코드펜스 제거', () => {
    expect(parseGapAnalysisOutput('```json\n' + VALID + '\n```').topics.length).toBe(2);
  });

  it('topics 가 배열 아니면 INVALID_MODEL_OUTPUT', () => {
    expect(() =>
      parseGapAnalysisOutput('{"fitSummary":"x","have":[],"gaps":[],"topics":"no"}'),
    ).toThrow(CareerMateException);
  });

  it('JSON 아니면 예외', () => {
    expect(() => parseGapAnalysisOutput('nope')).toThrow(CareerMateException);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test jd-gap.prompt`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**

`src/agent/career-mate/domain/prompt/jd-gap.prompt.ts`:
```typescript
import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { CareerMateException } from '../career-mate.exception';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';
import { CareerProfileData, GapAnalysisData } from '../career-mate.type';

export const JD_GAP_SYSTEM_PROMPT = `너는 이직 코치다. 지원자의 "증거 기반 역량 프로필"과 목표 공고(JD)를 대조해
적합도/보유/갭을 진단하고, 갭을 메우는 블로그·학습 주제를 제안한다.
아래 JSON 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

규칙:
- have: JD 요구 중 프로필에서 이미 입증된 역량.
- gaps: JD 요구 중 부족/미입증.
- topics: 갭을 메우는 블로그/학습 주제 3개. 각 title(한 줄) + rationale(어떤 갭을 왜 메우는지). 프로필의 실제 경험과 연결.
- 과장 금지. 프로필·JD 에서 확인되는 것만.

스키마:
{"fitSummary":"2~3문장","have":["..."],"gaps":["..."],"topics":[{"title":"...","rationale":"..."}]}`;

export const buildJdGapPrompt = (
  profile: CareerProfileData,
  jdText: string,
): string => {
  const skills = profile.skills
    .map((s) => `- ${s.name} (${s.category}/${s.proficiency})`)
    .join('\n');
  const accomplishments = profile.accomplishments
    .map((a) => `- ${a.bullet}`)
    .join('\n');
  return [
    `[내 역량 프로필]`,
    `요약: ${profile.summary}`,
    `스킬:\n${skills || '(없음)'}`,
    `성과:\n${accomplishments || '(없음)'}`,
    ``,
    `[목표 공고(JD)]`,
    jdText,
  ].join('\n');
};

const stripCodeFence = (text: string): string =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

const invalid = (message: string): never => {
  throw new CareerMateException({
    code: CareerMateErrorCode.INVALID_MODEL_OUTPUT,
    message,
    status: DomainStatus.BAD_GATEWAY,
  });
};

export const parseGapAnalysisOutput = (text: string): GapAnalysisData => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return invalid('갭 분석 실패 — 모델 출력이 JSON 이 아닙니다.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return invalid('갭 분석 실패 — 출력 형식 오류.');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.fitSummary !== 'string') {
    return invalid('갭 분석 실패 — fitSummary 누락.');
  }
  if (
    !Array.isArray(obj.have) ||
    !Array.isArray(obj.gaps) ||
    !Array.isArray(obj.topics)
  ) {
    return invalid('갭 분석 실패 — have/gaps/topics 가 배열이 아닙니다.');
  }
  return parsed as GapAnalysisData;
};
```

- [ ] **Step 4: 통과**

Run: `pnpm test jd-gap.prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/domain/prompt/jd-gap.prompt.ts src/agent/career-mate/domain/prompt/jd-gap.prompt.spec.ts
git commit -m "feat(career-mate): JD 갭 분석 프롬프트 + 출력 파서"
```

---

## Task 4: 멘션 intent 에 ANALYZE_JD_GAP 추가

**Files:**
- Modify: `src/agent/career-mate/domain/prompt/career-mate-intent.prompt.ts`
- Modify (test): `src/agent/career-mate/domain/prompt/career-mate-intent.prompt.spec.ts`

- [ ] **Step 1: 실패 테스트 추가**

`career-mate-intent.prompt.spec.ts` 의 `describe` 안에 추가:
```typescript
  it('ANALYZE_JD_GAP 를 파싱한다', () => {
    expect(parseCareerMateIntent('{"action":"ANALYZE_JD_GAP"}').action).toBe(
      'ANALYZE_JD_GAP',
    );
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test career-mate-intent.prompt`
Expected: FAIL (ANALYZE_JD_GAP 가 UNKNOWN 으로 정규화됨).

- [ ] **Step 3: 구현**

`career-mate-intent.prompt.ts` 의 `VALID_ACTIONS` 에 추가 + system prompt 에 한 줄 추가:
```typescript
const VALID_ACTIONS: CareerMateAction[] = [
  'BUILD_PROFILE',
  'RENDER_RESUME',
  'RENDER_PORTFOLIO',
  'ANALYZE_JD_GAP',
  'UNKNOWN',
];
```
system prompt 의 action 목록에 추가 (RENDER_PORTFOLIO 줄 아래):
```
- "ANALYZE_JD_GAP": 목표 공고(JD)와 내 역량을 대조해 갭/블로그주제 분석 ("이 공고 갭 분석", "이 JD 로 뭐가 부족한지", "이 포지션 분석해줘"). JD 본문이 함께 붙어온다.
```

- [ ] **Step 4: 통과**

Run: `pnpm test career-mate-intent.prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/domain/prompt/career-mate-intent.prompt.ts src/agent/career-mate/domain/prompt/career-mate-intent.prompt.spec.ts
git commit -m "feat(career-mate): intent 에 ANALYZE_JD_GAP 추가"
```

---

## Task 5: 주제 선택 파서 (`topic-selection-detector.ts`)

**Files:**
- Create: `src/slack/handler/topic-selection-detector.ts`
- Test: `src/slack/handler/topic-selection-detector.spec.ts`

- [ ] **Step 1: 실패 테스트**

`topic-selection-detector.spec.ts`:
```typescript
import { parseTopicSelection } from './topic-selection-detector';

describe('parseTopicSelection', () => {
  it('"2" → 2 (1-based, 범위 내)', () => {
    expect(parseTopicSelection('2', 3)).toBe(2);
  });
  it('"2번" / "2번으로" → 2', () => {
    expect(parseTopicSelection('2번', 3)).toBe(2);
    expect(parseTopicSelection('2번으로 써줘', 3)).toBe(2);
  });
  it('범위 밖(0, 4)이면 null', () => {
    expect(parseTopicSelection('0', 3)).toBeNull();
    expect(parseTopicSelection('4', 3)).toBeNull();
  });
  it('숫자 없으면 null', () => {
    expect(parseTopicSelection('아무거나', 3)).toBeNull();
  });
  it('너무 긴 문장이면 null (오탐 방지)', () => {
    expect(parseTopicSelection('2번 주제도 좋은데 사실 전체적으로 다시 고민해보면 어떨까 싶어요 길게', 3)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test topic-selection-detector`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**

`topic-selection-detector.ts`:
```typescript
// 갭 분석 후 "2" / "2번" / "2번으로 써줘" 처럼 주제 번호를 고른 응답을 1-based 인덱스로 파싱.
// 짧은 선택성 발화만 인정 (긴 문장은 일반 대화일 가능성 → null 로 fall through).
const MAX_LENGTH = 20;

export const parseTopicSelection = (
  text: string,
  topicCount: number,
): number | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENGTH) {
    return null;
  }
  const match = trimmed.match(/^(\d+)\s*(?:번)?/);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  if (!Number.isInteger(index) || index < 1 || index > topicCount) {
    return null;
  }
  return index;
};
```

- [ ] **Step 4: 통과**

Run: `pnpm test topic-selection-detector`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/slack/handler/topic-selection-detector.ts src/slack/handler/topic-selection-detector.spec.ts
git commit -m "feat(career-mate): 주제 선택 번호 파서"
```

---

## Task 6: AnalyzeJdGapUsecase

**Files:**
- Create: `src/agent/career-mate/application/analyze-jd-gap.usecase.ts`
- Test: `src/agent/career-mate/application/analyze-jd-gap.usecase.spec.ts`

- [ ] **Step 1: 실패 테스트**

`analyze-jd-gap.usecase.spec.ts`:
```typescript
import { CareerMateException } from '../domain/career-mate.exception';
import { CareerProfileData } from '../domain/career-mate.type';
import { AnalyzeJdGapUsecase } from './analyze-jd-gap.usecase';

const PROFILE: CareerProfileData = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

const GAP_JSON = JSON.stringify({
  fitSummary: 'f',
  have: ['NestJS'],
  gaps: ['K8s'],
  topics: [{ title: 'K8s 회고', rationale: 'K8s 갭' }],
});

const makeDeps = (latest: unknown) => {
  const repository = { findLatestBySlackUser: jest.fn().mockResolvedValue(latest) };
  const buildProfile = {
    execute: jest.fn().mockResolvedValue({ result: PROFILE, modelUsed: 'claude-cli', agentRunId: 88 }),
  };
  const modelRouter = {
    route: jest.fn().mockResolvedValue({ text: GAP_JSON, modelUsed: 'claude-cli', provider: 'CLAUDE' }),
  };
  const createPreview = { execute: jest.fn().mockResolvedValue({ id: 'pv1' }) };
  const agentRunService = {
    execute: jest.fn(async ({ run }: { run: (c: { agentRunId: number }) => Promise<{ result: unknown; modelUsed: string; output: unknown }> }) => {
      const r = await run({ agentRunId: 99 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 99 };
    }),
  };
  return { repository, buildProfile, modelRouter, createPreview, agentRunService };
};

const build = (d: ReturnType<typeof makeDeps>) =>
  new AnalyzeJdGapUsecase(
    d.repository as never,
    d.buildProfile as never,
    d.modelRouter as never,
    d.createPreview as never,
    d.agentRunService as never,
  );

describe('AnalyzeJdGapUsecase', () => {
  it('허브+JD 로 갭 분석 후 preview 를 생성한다', async () => {
    const d = makeDeps({ id: 1, agentRunId: 5, profileJson: PROFILE, createdAt: new Date() });
    const outcome = await build(d).execute({ slackUserId: 'U1', jdText: 'K8s 필수' });
    expect(outcome.result.gaps).toContain('K8s');
    expect(d.createPreview.execute).toHaveBeenCalledTimes(1);
    expect(d.createPreview.execute.mock.calls[0][0].kind).toBe('CAREER_JD_GAP_BLOG');
    expect(d.createPreview.execute.mock.calls[0][0].payload.topics[0].title).toBe('K8s 회고');
    expect(d.buildProfile.execute).not.toHaveBeenCalled();
  });

  it('허브 없으면 자동 Build 후 분석', async () => {
    const d = makeDeps(null);
    await build(d).execute({ slackUserId: 'U1', jdText: 'K8s 필수' });
    expect(d.buildProfile.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
  });

  it('JD 비어있으면 JD_EMPTY 예외', async () => {
    const d = makeDeps({ id: 1, agentRunId: 5, profileJson: PROFILE, createdAt: new Date() });
    await expect(build(d).execute({ slackUserId: 'U1', jdText: '   ' })).rejects.toBeInstanceOf(
      CareerMateException,
    );
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test analyze-jd-gap.usecase`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**

`src/agent/career-mate/application/analyze-jd-gap.usecase.ts`:
```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentRunOutcome, AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { CareerMateException } from '../domain/career-mate.exception';
import { CareerMateErrorCode } from '../domain/career-mate-error-code.enum';
import { AnalyzeJdGapInput, CareerProfileData, GapAnalysisData } from '../domain/career-mate.type';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  buildJdGapPrompt,
  JD_GAP_SYSTEM_PROMPT,
  parseGapAnalysisOutput,
} from '../domain/prompt/jd-gap.prompt';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

const PREVIEW_TTL_MS = 30 * 60 * 1000; // 30분 — 주제 선택 대기

@Injectable()
export class AnalyzeJdGapUsecase {
  private readonly logger = new Logger(AnalyzeJdGapUsecase.name);

  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly buildProfile: BuildCareerProfileUsecase,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly createPreview: CreatePreviewUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    slackUserId,
    jdText,
  }: AnalyzeJdGapInput): Promise<AgentRunOutcome<GapAnalysisData>> {
    if (jdText.trim().length === 0) {
      throw new CareerMateException({
        code: CareerMateErrorCode.JD_EMPTY,
        message: '분석할 공고(JD) 내용을 함께 붙여주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    return this.agentRunService.execute<GapAnalysisData>({
      agentType: AgentType.CAREER_MATE,
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
      inputSnapshot: { slackUserId, jdLength: jdText.length },
      run: async () => {
        const profile = await this.resolveProfile(slackUserId);
        const completion = await this.modelRouter.route({
          agentType: AgentType.CAREER_MATE,
          request: {
            prompt: buildJdGapPrompt(profile, jdText),
            systemPrompt: JD_GAP_SYSTEM_PROMPT,
          },
        });
        const data = parseGapAnalysisOutput(completion.text);
        await this.createPreview.execute({
          slackUserId,
          kind: PREVIEW_KIND.CAREER_JD_GAP_BLOG,
          payload: { topics: data.topics },
          previewText: 'JD 갭 분석 — 블로그 주제 선택 대기',
          responseUrl: null,
          ttlMs: PREVIEW_TTL_MS,
        });
        this.logger.log(
          `CAREER_MATE JD 갭 분석 — gaps=${data.gaps.length} topics=${data.topics.length}`,
        );
        return { result: data, modelUsed: completion.modelUsed, output: data };
      },
    });
  }

  private async resolveProfile(slackUserId: string): Promise<CareerProfileData> {
    const latest = await this.repository.findLatestBySlackUser(slackUserId);
    if (latest) {
      return latest.profileJson;
    }
    const built = await this.buildProfile.execute({ slackUserId });
    return built.result;
  }
}
```
> `DomainStatus.BAD_REQUEST` 존재 여부 확인 — 없으면 `INTERNAL` 사용(vacation 예외처럼). 구현 시 `domain-status.enum.ts` 확인.

- [ ] **Step 4: 통과**

Run: `pnpm test analyze-jd-gap.usecase`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/application/analyze-jd-gap.usecase.ts src/agent/career-mate/application/analyze-jd-gap.usecase.spec.ts
git commit -m "feat(career-mate): AnalyzeJdGapUsecase (허브⨯JD → 갭 + preview)"
```

---

## Task 7: 갭 리포트 포매터

**Files:**
- Modify: `src/agent/career-mate/infrastructure/career-mate.formatter.ts`
- Modify (test): `src/agent/career-mate/infrastructure/career-mate.formatter.spec.ts`

- [ ] **Step 1: 실패 테스트 추가**

`career-mate.formatter.spec.ts` 상단 import 에 `formatGapReport` 추가 + describe 안에 테스트 추가:
```typescript
import {
  buildPortfolioBlocks,
  formatGapReport,
  formatPortfolioLink,
  formatProfileSummary,
  formatResume,
  formatUnknownCareerMate,
} from './career-mate.formatter';

const GAP = {
  fitSummary: '핵심 부합 <b>강점</b>',
  have: ['NestJS'],
  gaps: ['K8s'],
  topics: [
    { title: 'K8s 회고', rationale: 'K8s 갭' },
    { title: '분산 큐 글', rationale: '트래픽 갭' },
  ],
};

it('formatGapReport 는 번호 매긴 주제 + 선택 안내 + escape 를 포함한다', () => {
  const text = formatGapReport(GAP as never);
  expect(text).toContain('1.');
  expect(text).toContain('K8s 회고');
  expect(text).toContain('번'); // "원하는 번호를 말해주세요" 안내
  expect(text).toContain('&lt;b&gt;'); // LLM 텍스트 escape
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test career-mate.formatter`
Expected: FAIL (formatGapReport 없음).

- [ ] **Step 3: 구현**

`career-mate.formatter.ts` 상단 import 에 `GapAnalysisData` 추가 + 함수 추가 (escapeSlackMrkdwn 는 같은 파일 하단 const 재사용):
```typescript
import { CareerProfileData, GapAnalysisData } from '../domain/career-mate.type';
```
```typescript
export const formatGapReport = (data: GapAnalysisData): string => {
  const have = data.have.map((h) => `• ${escapeSlackMrkdwn(h)}`).join('\n');
  const gaps = data.gaps.map((g) => `• ${escapeSlackMrkdwn(g)}`).join('\n');
  const topics = data.topics
    .map((t, i) => `${i + 1}. ${escapeSlackMrkdwn(t.title)} — _${escapeSlackMrkdwn(t.rationale)}_`)
    .join('\n');
  return [
    `*JD 갭 분석*`,
    escapeSlackMrkdwn(data.fitSummary),
    ``,
    `*보유*\n${have || '(없음)'}`,
    `*갭*\n${gaps || '(없음)'}`,
    ``,
    `*갭을 메우는 블로그 주제*\n${topics}`,
    ``,
    `원하는 주제 번호를 말해주세요 (예: "2번"). 취소하려면 "아니".`,
  ].join('\n');
};
```

- [ ] **Step 4: 통과**

Run: `pnpm test career-mate.formatter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/infrastructure/career-mate.formatter.ts src/agent/career-mate/infrastructure/career-mate.formatter.spec.ts
git commit -m "feat(career-mate): 갭 리포트 포매터 (번호 주제 + 선택 안내)"
```

---

## Task 8: 디스패처 ANALYZE_JD_GAP case

**Files:**
- Modify: `src/agent/career-mate/infrastructure/career-mate.dispatcher.ts`
- Modify (test): `src/agent/career-mate/infrastructure/career-mate.dispatcher.spec.ts`

- [ ] **Step 1: 실패 테스트 추가**

`career-mate.dispatcher.spec.ts` 의 `makeDispatcher` 에 analyzeJdGap mock 추가 + 생성자 인자 추가 + 테스트:
```typescript
  const analyzeJdGap = {
    execute: jest.fn().mockResolvedValue({
      result: { fitSummary: 'f', have: [], gaps: ['K8s'], topics: [{ title: 'K8s 회고', rationale: 'r' }] },
      modelUsed: 'claude-cli',
      agentRunId: 7,
    }),
  };
  const dispatcher = new CareerMateDispatcher(
    modelRouter as never,
    buildProfile as never,
    renderResume as never,
    renderPortfolio as never,
    analyzeJdGap as never,
  );
  return { dispatcher, buildProfile, renderResume, renderPortfolio, analyzeJdGap };
```
테스트:
```typescript
  it('ANALYZE_JD_GAP 의도면 analyzeJdGap 을 호출하고 갭 리포트를 반환한다', async () => {
    const d = makeDispatcher('{"action":"ANALYZE_JD_GAP"}');
    const outcome = await d.dispatcher.dispatch({ slackUserId: 'U1', text: '이 공고 갭 분석 K8s 필수' } as never);
    expect(d.analyzeJdGap.execute).toHaveBeenCalledWith({ slackUserId: 'U1', jdText: '이 공고 갭 분석 K8s 필수' });
    expect(outcome.formattedText).toContain('K8s 회고');
    expect(outcome.agentRunId).toBe(7);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test career-mate.dispatcher`
Expected: FAIL.

- [ ] **Step 3: 구현**

`career-mate.dispatcher.ts`:
- import `AnalyzeJdGapUsecase` + `formatGapReport`.
- 생성자에 `private readonly analyzeJdGap: AnalyzeJdGapUsecase` 추가 (마지막 인자).
- switch 에 case 추가 (default 위):
```typescript
      case 'ANALYZE_JD_GAP': {
        const outcome = await this.analyzeJdGap.execute({
          slackUserId,
          jdText: input.text ?? '',
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          outcome.modelUsed,
          formatGapReport(outcome.result),
        );
      }
```

- [ ] **Step 4: 통과**

Run: `pnpm test career-mate.dispatcher`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/infrastructure/career-mate.dispatcher.ts src/agent/career-mate/infrastructure/career-mate.dispatcher.spec.ts
git commit -m "feat(career-mate): 디스패처 ANALYZE_JD_GAP case"
```

---

## Task 9: 모듈 등록

**Files:** Modify `src/agent/career-mate/career-mate.module.ts`

- [ ] **Step 1: AnalyzeJdGapUsecase 등록**

`providers` 배열에 `AnalyzeJdGapUsecase` 추가 (import 도). `CreatePreviewUsecase` 는 PreviewGateModule(global) 이 export 하므로 별도 import 불필요. 확인: `git grep -n "exports" src/preview-gate/preview-gate.module.ts` 에 `CreatePreviewUsecase` 포함됨(검증됨).
```typescript
import { AnalyzeJdGapUsecase } from './application/analyze-jd-gap.usecase';
// ...
  providers: [
    { provide: CAREER_PROFILE_REPOSITORY_PORT, useClass: CareerProfilePrismaRepository },
    BuildCareerProfileUsecase,
    RenderResumeUsecase,
    RenderPortfolioUsecase,
    AnalyzeJdGapUsecase,
    CareerMateDispatcher,
  ],
  exports: [
    BuildCareerProfileUsecase,
    RenderResumeUsecase,
    RenderPortfolioUsecase,
    AnalyzeJdGapUsecase,
    CareerMateDispatcher,
  ],
```

- [ ] **Step 2: 빌드 + career-mate 테스트**

Run: `pnpm build && pnpm test career-mate`
Expected: 성공 (DI 해소 — CreatePreviewUsecase 는 global PreviewGateModule 에서 주입).

- [ ] **Step 3: Commit**

```bash
git add src/agent/career-mate/career-mate.module.ts
git commit -m "feat(career-mate): AnalyzeJdGapUsecase 모듈 등록"
```

---

## Task 10: router-message.handler 주제선택 intercept

**Files:**
- Modify: `src/slack/handler/router-message.handler.ts`
- Modify (test): `src/slack/handler/router-message.handler.spec.ts`

- [ ] **Step 1: 실패 테스트 추가**

`router-message.handler.spec.ts` 에 테스트 추가 (기존 mock 패턴 따름 — `findLatestPendingPreview`, `cancelPreviewUsecase`, `idaeriRouter` mock):
```typescript
  it('pending CAREER_JD_GAP_BLOG + "2번" → preview consume + BLOG 체인(agentTypeHint)', async () => {
    findLatestPendingPreview.execute.mockResolvedValue({
      id: 'pv1',
      kind: 'CAREER_JD_GAP_BLOG',
      payload: { topics: [{ title: 'A', rationale: 'r' }, { title: 'B글', rationale: 'r' }] },
    });
    idaeriRouter.dispatch.mockResolvedValue({
      agentRunId: 50, workerType: 'BLOG', output: {}, modelUsed: 'hermes', formattedText: '✅ notion-url',
    });
    // app_mention 핸들러로 "2번" 유입 시뮬레이션 (기존 spec 의 헬퍼 사용)
    await invokeMention({ text: '2번' });
    expect(cancelPreviewUsecase.execute).toHaveBeenCalledWith({ previewId: 'pv1', slackUserId: expect.any(String) });
    expect(idaeriRouter.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ agentTypeHint: 'BLOG', text: 'B글' }),
    );
  });
```
> 기존 spec 의 mention 호출 헬퍼/mock 셋업 구조에 맞춰 변수명 조정. (handler spec 이 이미 say/client/router mock 을 구성함.)

- [ ] **Step 2: 실패 확인**

Run: `pnpm test router-message.handler`
Expected: FAIL (intercept 없음 → "2번" 이 일반 dispatch 로 감).

- [ ] **Step 3: 구현**

`router-message.handler.ts`:
- import: `import { parseTopicSelection } from './topic-selection-detector';` + `import { AgentType } from '../../model-router/domain/model-router.type';` (이미 import 됐는지 확인).
- `processRouterMessage` 의 `tryHandlePreviewYesNo` 블록 **직후**(`if (handledByPreview) { ... return; }` 다음)에 추가:
```typescript
      const handledByTopic = await this.tryHandleGapTopicSelection({
        text,
        slackUserId,
        threadTs,
        say,
        memoryKey,
      });
      if (handledByTopic) {
        succeeded = true;
        return;
      }
```
- 신규 메서드 (tryHandlePreviewYesNo 옆):
```typescript
  // 갭 분석 후 "N번" 주제 선택 인터셉트 — pending CAREER_JD_GAP_BLOG preview 가 있을 때만.
  // preview consume(cancel) 후 선택 주제를 BLOG 로 체인(agentTypeHint 로 classify 우회).
  private async tryHandleGapTopicSelection({
    text,
    slackUserId,
    threadTs,
    say,
    memoryKey,
  }: {
    text: string;
    slackUserId: string;
    threadTs: string | undefined;
    say: SayFn;
    memoryKey: string;
  }): Promise<boolean> {
    const pending = await this.findLatestPendingPreview.execute({ slackUserId });
    if (!pending || pending.kind !== 'CAREER_JD_GAP_BLOG') {
      return false;
    }
    const payload = pending.payload as { topics?: { title: string }[] };
    const topics = payload.topics ?? [];
    const index = parseTopicSelection(text, topics.length);
    if (index === null) {
      return false;
    }
    const topicTitle = topics[index - 1].title;
    await this.cancelPreviewUsecase.execute({
      previewId: pending.id,
      slackUserId,
    });
    const result = await this.idaeriRouter.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId,
      text: topicTitle,
      agentTypeHint: AgentType.BLOG,
    });
    await this.conversationMemory.appendTurn(memoryKey, {
      role: 'user',
      text,
      agentType: result.workerType,
      agentRunId: result.agentRunId,
      timestampMs: Date.now(),
    });
    await say({ thread_ts: threadTs, text: buildRouterReply(result) });
    return true;
  }
```

- [ ] **Step 4: 통과 + 회귀**

Run: `pnpm test router-message.handler`
Expected: PASS (신규 + 기존 통과).

- [ ] **Step 5: Commit**

```bash
git add src/slack/handler/router-message.handler.ts src/slack/handler/router-message.handler.spec.ts
git commit -m "feat(career-mate): 주제선택 intercept → BLOG 체인"
```

---

## Task 11: 최종 검증 (4중 green)

- [ ] **Step 1**: `pnpm lint:check` → exit 0 (위반 시 fix).
- [ ] **Step 2**: `pnpm test` → exit 0 (career-mate + router + preview-gate + 회귀 전부. code-graph 트리시터 flake 는 기존 무관 이슈 — 단독 재실행으로 확인).
- [ ] **Step 3**: `pnpm build` → exit 0.
- [ ] **Step 4**: `pnpm docs:check` → OK (신규 에이전트/env 없음 → 드리프트 없어야 정상. 만약 드리프트면 `pnpm docs:sync` 후 커밋).
- [ ] **Step 5**: 4개 중 하나라도 비-0 이면 해당 Task 로 복귀 수정. 임의 스킵 금지.
- [ ] **Step 6 (owner 수동)**: Slack 에서 `@이대리 이 공고 갭 분석해줘 <JD>` → 갭 리포트 + 번호 주제 → "2번" → BLOG Notion URL 확인.

---

## 자기 점검 (작성자)

- **스펙 커버리지**: §3 흐름→Task 6/8/10, §4 컴포넌트→Task 1~10, §5 데이터(GapAnalysisData/무상태 preview payload)→Task 2/6, §6 선택 메커니즘→Task 5/10, §7 에러→Task 2/3/6, §8 테스트→각 Task TDD + Task 11. ✅
- **스펙 deviation**: §6 의 "ApplyPreview 에 selection 전달" 미결 → **intercept 가 직접 BLOG 체인 + cancel consume** 로 확정(applier·payload mutation 불필요). agentTypeHint 로 BLOG 직행(검증됨).
- **타입 일관성**: `GapAnalysisData`/`GapTopic`/`AnalyzeJdGapInput`/`parseGapAnalysisOutput`/`parseTopicSelection`/`formatGapReport`/`PREVIEW_KIND.CAREER_JD_GAP_BLOG` — Task 간 정의·사용 일치. ✅
- **placeholder**: 없음. (`DomainStatus.BAD_REQUEST` 존재 확인 1건 + handler spec mock 변수명 조정은 in-repo 확인 지시로 구체화.)
- **열린 항목**: `DomainStatus.BAD_REQUEST` 부재 시 INTERNAL(Task 6 Step 3 주석). router-message.handler.spec 의 기존 mock 셋업에 신규 테스트 변수명 맞추기(Task 10 Step 1).
