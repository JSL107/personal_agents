# 이직 메이트 Phase 4 구현 계획 — 이력서/프로필 보정 점검 (Calibration)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CAREER_MATE 에 `CALIBRATE_RESUME` action(온디맨드) + 주1회 cron 을 추가 — 내 역량 프로필을 현재 2026 채용 기준과 대조해 보정 진단(AI-slop/정량부족/구식표현/빠진키워드/액션). cron 은 Hermes 웹리서치로 최신 트렌드를 끌어와 augment.

**Architecture:** 한 usecase(`CalibrateResumeUsecase`)가 온디맨드·cron 양쪽 담당, 웹 노트는 optional 입력. 온디맨드=Claude 지식(빠름), cron=Hermes 웹 augment + Slack DM. 새 에이전트 X(CAREER_MATE 재사용), 무상태. cron 은 CeoMetaCron(BullMQ repeatable) 패턴 복제.

**Tech Stack:** NestJS 10, BullMQ repeatable cron, Slack(SlackNotifierPort), Hermes CLI(HermesRunnerPort, Tavily), class-validator, jest. LLM=Claude(model-router).

**선행:** Phase 1·2 (이미 main). 브랜치 `feat/career-mate-phase4` (main 기준).
**설계서:** `docs/superpowers/specs/2026-06-16-career-mate-phase4-calibration-design.md`

**확정 사실 (탐색 verbatim):**
- `HermesRunnerPort.run(prompt): Promise<{stdout,stderr}>` — 웹리서치 텍스트 = `result.stdout`. 토큰 `HERMES_RUNNER_PORT`. `HermesCliRunner`(blog/infrastructure)는 stateless → cron 모듈에서 `{provide:HERMES_RUNNER_PORT, useClass:HermesCliRunner}` 로 재provide (BlogModule 은 이 토큰 미export).
- `SLACK_NOTIFIER_PORT.postMessage({target,text})` — `{provide:SLACK_NOTIFIER_PORT, useExisting:SlackService}` + import SlackModule (CeoMeta 패턴).
- `NotificationPublisher.publishCronFailure({cronName, ownerSlackUserId, errorMessage})` — NotificationQueueModule import, @Optional inject.
- `CronIdempotencyService.acquireOnce(key, ttlSeconds)` — deliverOnce 중복 차단.
- `LONG_RUNNING_WORKER_OPTIONS` (`src/common/queue/worker-options.constant.ts`) — @Processor 2번째 인자.
- `AgentRunService.execute<T>({agentType,triggerType,inputSnapshot,run})` → `AgentRunOutcome<T>{result,modelUsed,agentRunId}`; run 콜백 `(context)=>{result,modelUsed,output}`.
- `CareerProfileRepositoryPort.findLatestBySlackUser(slackUserId)` / `BuildCareerProfileUsecase.execute({slackUserId})` 재사용.

---

## File Structure

**생성 (career-mate):**
- `src/agent/career-mate/domain/prompt/calibration.prompt.ts` — system + `buildCalibrationPrompt(profile, webTrendsNote?)` + `parseCalibrationOutput`
- `src/agent/career-mate/application/calibrate-resume.usecase.ts`
- 각 `*.spec.ts`

**생성 (`src/resume-calibration-cron/`, CeoMetaCron 복제):**
- `domain/resume-calibration-cron.type.ts`
- `application/resume-calibration-cron.scheduler.ts` (+spec)
- `infrastructure/resume-calibration-cron.consumer.ts` (+spec)
- `resume-calibration-cron.module.ts`

**수정:**
- `domain/career-mate.type.ts` — `CALIBRATE_RESUME` action + `CalibrationResultData` + `CalibrateResumeInput`
- `domain/prompt/career-mate-intent.prompt.ts` — `CALIBRATE_RESUME` 분류
- `infrastructure/career-mate.dispatcher.ts` — case + 생성자 inject
- `infrastructure/career-mate.formatter.ts` — `formatCalibrationReport`
- `career-mate.module.ts` — `CalibrateResumeUsecase` provider/export
- `app.module.ts` — `ResumeCalibrationCronModule` import
- `app.config.ts` + `.env.example` — `RESUME_CALIBRATION_*` env

---

## Task 1: 도메인 타입 (action + CalibrationResultData)

**Files:** Modify `src/agent/career-mate/domain/career-mate.type.ts`

- [ ] **Step 1: action + 타입 추가**

`CareerMateAction` 에 `'CALIBRATE_RESUME'` 추가 + 파일 끝에 타입:
```typescript
export type CareerMateAction =
  | 'BUILD_PROFILE'
  | 'RENDER_RESUME'
  | 'RENDER_PORTFOLIO'
  | 'ANALYZE_JD_GAP'
  | 'CALIBRATE_RESUME'
  | 'UNKNOWN';

export interface CalibrationResultData {
  verdict: string;
  aiSlopRisks: string[];
  underQuantified: string[];
  outdatedPhrasing: string[];
  missingKeywords: string[];
  actionItems: string[];
}

export interface CalibrateResumeInput {
  slackUserId: string;
  webTrendsNote?: string;
}
```

- [ ] **Step 2: build**

Run: `pnpm -C "<wt>" build`
Expected: 성공.

- [ ] **Step 3: Commit**

```bash
git add src/agent/career-mate/domain/career-mate.type.ts
git commit -m "feat(career-mate): CALIBRATE_RESUME action + CalibrationResultData 타입"
```

---

## Task 2: 보정 프롬프트 + 파서 (`calibration.prompt.ts`)

**Files:**
- Create: `src/agent/career-mate/domain/prompt/calibration.prompt.ts`
- Test: `src/agent/career-mate/domain/prompt/calibration.prompt.spec.ts`

- [ ] **Step 1: 실패 테스트**

`calibration.prompt.spec.ts`:
```typescript
import { CareerMateException } from '../career-mate.exception';
import { CareerProfileData } from '../career-mate.type';
import {
  buildCalibrationPrompt,
  parseCalibrationOutput,
} from './calibration.prompt';

const PROFILE: CareerProfileData = {
  summary: '백엔드 5년차',
  skills: [
    { name: 'NestJS', category: 'FRAMEWORK', proficiency: 'EXPERT', evidence: [{ repo: 'o/r', pr: 1, url: 'https://x/1' }] },
  ],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

const VALID = JSON.stringify({
  verdict: '전반적으로 견고하나 정량 지표 보강 필요',
  aiSlopRisks: ['"다양한 업무 수행" 같은 모호한 표현'],
  underQuantified: ['성과에 수치 없음'],
  outdatedPhrasing: ['"열정적인" 류 진부 표현'],
  missingKeywords: ['관측가능성', 'IaC'],
  actionItems: ['각 성과에 정량 지표 추가'],
});

describe('buildCalibrationPrompt', () => {
  it('프로필 스킬을 프롬프트에 포함한다', () => {
    expect(buildCalibrationPrompt(PROFILE, undefined)).toContain('NestJS');
  });
  it('webTrendsNote 가 있으면 프롬프트에 포함한다', () => {
    const prompt = buildCalibrationPrompt(PROFILE, '2026 트렌드: AI 협업 경험 강조');
    expect(prompt).toContain('2026 트렌드');
  });
  it('webTrendsNote 가 없으면 트렌드 섹션을 넣지 않는다', () => {
    expect(buildCalibrationPrompt(PROFILE, undefined)).not.toContain('[최신 시장 트렌드]');
  });
});

describe('parseCalibrationOutput', () => {
  it('유효 JSON 을 CalibrationResultData 로 파싱한다', () => {
    const data = parseCalibrationOutput(VALID);
    expect(data.verdict).toContain('견고');
    expect(data.missingKeywords).toContain('IaC');
  });
  it('코드펜스 제거', () => {
    expect(parseCalibrationOutput('```json\n' + VALID + '\n```').actionItems.length).toBe(1);
  });
  it('배열 필드가 배열 아니면 INVALID_MODEL_OUTPUT', () => {
    expect(() =>
      parseCalibrationOutput('{"verdict":"x","aiSlopRisks":"no","underQuantified":[],"outdatedPhrasing":[],"missingKeywords":[],"actionItems":[]}'),
    ).toThrow(CareerMateException);
  });
  it('JSON 아니면 예외', () => {
    expect(() => parseCalibrationOutput('nope')).toThrow(CareerMateException);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm -C "<wt>" test calibration.prompt`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현**

`src/agent/career-mate/domain/prompt/calibration.prompt.ts`:
```typescript
import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { CareerMateException } from '../career-mate.exception';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';
import { CalibrationResultData, CareerProfileData } from '../career-mate.type';

export const CALIBRATION_SYSTEM_PROMPT = `너는 2026년 채용 시장 기준에 정통한 이력서 코치다.
지원자의 "증거 기반 역량 프로필"을 현재 이력서 작성 기준과 대조해 보정점을 진단한다.
[최신 시장 트렌드] 섹션이 주어지면 그 정보를 우선 반영한다.
아래 JSON 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

진단 기준:
- aiSlopRisks: generic/AI 티 나는 모호한 표현(구체성·고유성 부족).
- underQuantified: 정량 지표(수치/비율/규모)가 빠진 성과.
- outdatedPhrasing: 2026 기준 진부하거나 구식인 표현.
- missingKeywords: 타겟 직무에서 기대되나 프로필에 없는 역량/키워드.
- actionItems: 우선순위 개선 액션(구체적, 실행가능).
- verdict: 한 줄 총평 + 현재 기준 적합도.
과장 금지. 프로필에서 확인되는 것만.

스키마:
{"verdict":"...","aiSlopRisks":["..."],"underQuantified":["..."],"outdatedPhrasing":["..."],"missingKeywords":["..."],"actionItems":["..."]}`;

export const buildCalibrationPrompt = (
  profile: CareerProfileData,
  webTrendsNote?: string,
): string => {
  const skills = profile.skills
    .map((s) => `- ${s.name} (${s.category}/${s.proficiency})`)
    .join('\n');
  const accomplishments = profile.accomplishments
    .map((a) => `- ${a.bullet}`)
    .join('\n');
  const sections = [
    `[내 역량 프로필]`,
    `요약: ${profile.summary}`,
    `스킬:\n${skills || '(없음)'}`,
    `성과:\n${accomplishments || '(없음)'}`,
  ];
  if (webTrendsNote && webTrendsNote.trim().length > 0) {
    sections.push(`\n[최신 시장 트렌드]\n${webTrendsNote.trim()}`);
  }
  return sections.join('\n');
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

export const parseCalibrationOutput = (
  text: string,
): CalibrationResultData => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return invalid('보정 점검 실패 — 모델 출력이 JSON 이 아닙니다.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return invalid('보정 점검 실패 — 출력 형식 오류.');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.verdict !== 'string') {
    return invalid('보정 점검 실패 — verdict 누락.');
  }
  const arrays = [
    'aiSlopRisks',
    'underQuantified',
    'outdatedPhrasing',
    'missingKeywords',
    'actionItems',
  ];
  for (const key of arrays) {
    if (!Array.isArray(obj[key])) {
      return invalid(`보정 점검 실패 — ${key} 가 배열이 아닙니다.`);
    }
  }
  return parsed as CalibrationResultData;
};
```

- [ ] **Step 4: 통과**

Run: `pnpm -C "<wt>" test calibration.prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/domain/prompt/calibration.prompt.ts src/agent/career-mate/domain/prompt/calibration.prompt.spec.ts
git commit -m "feat(career-mate): 이력서 보정 프롬프트 + 출력 파서"
```

---

## Task 3: intent 에 CALIBRATE_RESUME 추가

**Files:**
- Modify: `src/agent/career-mate/domain/prompt/career-mate-intent.prompt.ts`
- Modify (test): `src/agent/career-mate/domain/prompt/career-mate-intent.prompt.spec.ts`

- [ ] **Step 1: 실패 테스트 추가**

`career-mate-intent.prompt.spec.ts` describe 안에:
```typescript
  it('CALIBRATE_RESUME 를 파싱한다', () => {
    expect(parseCareerMateIntent('{"action":"CALIBRATE_RESUME"}').action).toBe(
      'CALIBRATE_RESUME',
    );
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm -C "<wt>" test career-mate-intent.prompt`
Expected: FAIL (UNKNOWN 으로 정규화).

- [ ] **Step 3: 구현**

`VALID_ACTIONS` 에 `'CALIBRATE_RESUME'` 추가 + system prompt 의 action 목록(ANALYZE_JD_GAP 줄 아래)에:
```
- "CALIBRATE_RESUME": 내 이력서/프로필을 현재 채용 기준과 대조해 보정 점검 ("이력서 점검해줘", "내 이력서 요즘 기준에 맞나", "이력서 보정", "이력서 검토").
```

- [ ] **Step 4: 통과**

Run: `pnpm -C "<wt>" test career-mate-intent.prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/domain/prompt/career-mate-intent.prompt.ts src/agent/career-mate/domain/prompt/career-mate-intent.prompt.spec.ts
git commit -m "feat(career-mate): intent 에 CALIBRATE_RESUME 추가"
```

---

## Task 4: CalibrateResumeUsecase

**Files:**
- Create: `src/agent/career-mate/application/calibrate-resume.usecase.ts`
- Test: `src/agent/career-mate/application/calibrate-resume.usecase.spec.ts`

- [ ] **Step 1: 실패 테스트**

`calibrate-resume.usecase.spec.ts`:
```typescript
import { CareerProfileData } from '../domain/career-mate.type';
import { CalibrateResumeUsecase } from './calibrate-resume.usecase';

const PROFILE: CareerProfileData = {
  summary: 's', skills: [], accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};
const CAL_JSON = JSON.stringify({
  verdict: 'ok', aiSlopRisks: [], underQuantified: ['x'],
  outdatedPhrasing: [], missingKeywords: ['IaC'], actionItems: ['정량화'],
});

const makeDeps = (latest: unknown) => {
  const repository = { findLatestBySlackUser: jest.fn().mockResolvedValue(latest) };
  const buildProfile = { execute: jest.fn().mockResolvedValue({ result: PROFILE, modelUsed: 'claude-cli', agentRunId: 88 }) };
  const modelRouter = { route: jest.fn().mockResolvedValue({ text: CAL_JSON, modelUsed: 'claude-cli', provider: 'CLAUDE' }) };
  const agentRunService = {
    execute: jest.fn(async ({ run }: { run: (c: { agentRunId: number }) => Promise<{ result: unknown; modelUsed: string; output: unknown }> }) => {
      const r = await run({ agentRunId: 99 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 99 };
    }),
  };
  return { repository, buildProfile, modelRouter, agentRunService };
};
const build = (d: ReturnType<typeof makeDeps>) =>
  new CalibrateResumeUsecase(d.repository as never, d.buildProfile as never, d.modelRouter as never, d.agentRunService as never);

describe('CalibrateResumeUsecase', () => {
  it('허브로 보정 진단을 반환한다', async () => {
    const d = makeDeps({ id: 1, agentRunId: 5, profileJson: PROFILE, createdAt: new Date() });
    const outcome = await build(d).execute({ slackUserId: 'U1' });
    expect(outcome.result.missingKeywords).toContain('IaC');
    expect(d.buildProfile.execute).not.toHaveBeenCalled();
  });
  it('허브 없으면 자동 Build 후 진단', async () => {
    const d = makeDeps(null);
    await build(d).execute({ slackUserId: 'U1' });
    expect(d.buildProfile.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
  });
  it('webTrendsNote 가 프롬프트에 반영된다', async () => {
    const d = makeDeps({ id: 1, agentRunId: 5, profileJson: PROFILE, createdAt: new Date() });
    await build(d).execute({ slackUserId: 'U1', webTrendsNote: '2026 트렌드 X' });
    const prompt = d.modelRouter.route.mock.calls[0][0].request.prompt;
    expect(prompt).toContain('2026 트렌드 X');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm -C "<wt>" test calibrate-resume.usecase`
Expected: FAIL.

- [ ] **Step 3: 구현**

`src/agent/career-mate/application/calibrate-resume.usecase.ts`:
```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  CalibrateResumeInput,
  CalibrationResultData,
  CareerProfileData,
} from '../domain/career-mate.type';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  buildCalibrationPrompt,
  CALIBRATION_SYSTEM_PROMPT,
  parseCalibrationOutput,
} from '../domain/prompt/calibration.prompt';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

@Injectable()
export class CalibrateResumeUsecase {
  private readonly logger = new Logger(CalibrateResumeUsecase.name);

  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly buildProfile: BuildCareerProfileUsecase,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    slackUserId,
    webTrendsNote,
  }: CalibrateResumeInput): Promise<AgentRunOutcome<CalibrationResultData>> {
    return this.agentRunService.execute<CalibrationResultData>({
      agentType: AgentType.CAREER_MATE,
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
      inputSnapshot: { slackUserId, hasWebTrends: Boolean(webTrendsNote) },
      run: async () => {
        const profile = await this.resolveProfile(slackUserId);
        const completion = await this.modelRouter.route({
          agentType: AgentType.CAREER_MATE,
          request: {
            prompt: buildCalibrationPrompt(profile, webTrendsNote),
            systemPrompt: CALIBRATION_SYSTEM_PROMPT,
          },
        });
        const data = parseCalibrationOutput(completion.text);
        this.logger.log(
          `CAREER_MATE 보정 점검 — actions=${data.actionItems.length} web=${Boolean(webTrendsNote)}`,
        );
        return { result: data, modelUsed: completion.modelUsed, output: data };
      },
    });
  }

  private async resolveProfile(
    slackUserId: string,
  ): Promise<CareerProfileData> {
    const latest = await this.repository.findLatestBySlackUser(slackUserId);
    if (latest) {
      return latest.profileJson;
    }
    const built = await this.buildProfile.execute({ slackUserId });
    return built.result;
  }
}
```

- [ ] **Step 4: 통과**

Run: `pnpm -C "<wt>" test calibrate-resume.usecase`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/application/calibrate-resume.usecase.ts src/agent/career-mate/application/calibrate-resume.usecase.spec.ts
git commit -m "feat(career-mate): CalibrateResumeUsecase (허브 → Claude 보정 진단)"
```

---

## Task 5: 보정 리포트 포매터

**Files:**
- Modify: `src/agent/career-mate/infrastructure/career-mate.formatter.ts`
- Modify (test): `src/agent/career-mate/infrastructure/career-mate.formatter.spec.ts`

- [ ] **Step 1: 실패 테스트 추가**

import 에 `formatCalibrationReport` 추가 + 테스트:
```typescript
const CAL = {
  verdict: '견고 <b>하나</b> 정량 보강',
  aiSlopRisks: ['모호한 표현'],
  underQuantified: ['수치 없음'],
  outdatedPhrasing: [],
  missingKeywords: ['IaC'],
  actionItems: ['정량 지표 추가'],
};
it('formatCalibrationReport 는 섹션 + escape 를 포함한다', () => {
  const text = formatCalibrationReport(CAL as never);
  expect(text).toContain('정량 지표 추가');
  expect(text).toContain('IaC');
  expect(text).toContain('&lt;b&gt;'); // LLM 텍스트 escape
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm -C "<wt>" test career-mate.formatter`
Expected: FAIL.

- [ ] **Step 3: 구현**

import 에 `CalibrationResultData` 추가 + 함수(escapeSlackMrkdwn 는 파일 하단 const 재사용):
```typescript
import {
  CalibrationResultData,
  CareerProfileData,
  GapAnalysisData,
} from '../domain/career-mate.type';
```
```typescript
export const formatCalibrationReport = (
  data: CalibrationResultData,
): string => {
  const section = (title: string, items: string[]): string =>
    items.length === 0
      ? ''
      : `*${title}*\n${items.map((i) => `• ${escapeSlackMrkdwn(i)}`).join('\n')}`;
  return [
    `*이력서 보정 점검*`,
    escapeSlackMrkdwn(data.verdict),
    ``,
    section('🤖 AI-slop 위험', data.aiSlopRisks),
    section('📊 정량 보강 필요', data.underQuantified),
    section('🕰️ 구식 표현', data.outdatedPhrasing),
    section('🔑 빠진 키워드', data.missingKeywords),
    section('✅ 액션', data.actionItems),
  ]
    .filter((line) => line.length > 0)
    .join('\n\n');
};
```

- [ ] **Step 4: 통과**

Run: `pnpm -C "<wt>" test career-mate.formatter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/infrastructure/career-mate.formatter.ts src/agent/career-mate/infrastructure/career-mate.formatter.spec.ts
git commit -m "feat(career-mate): 보정 리포트 포매터"
```

---

## Task 6: 디스패처 case + 모듈 등록

**Files:**
- Modify: `src/agent/career-mate/infrastructure/career-mate.dispatcher.ts`
- Modify (test): `src/agent/career-mate/infrastructure/career-mate.dispatcher.spec.ts`
- Modify: `src/agent/career-mate/career-mate.module.ts`

- [ ] **Step 1: 실패 테스트 추가 (dispatcher)**

`career-mate.dispatcher.spec.ts` 의 makeDispatcher 에 calibrateResume mock + 6번째 생성자 인자 추가:
```typescript
  const calibrateResume = {
    execute: jest.fn().mockResolvedValue({
      result: { verdict: 'ok', aiSlopRisks: [], underQuantified: [], outdatedPhrasing: [], missingKeywords: ['IaC'], actionItems: ['정량화'] },
      modelUsed: 'claude-cli', agentRunId: 11,
    }),
  };
  const dispatcher = new CareerMateDispatcher(
    modelRouter as never, buildProfile as never, renderResume as never,
    renderPortfolio as never, analyzeJdGap as never, calibrateResume as never,
  );
  return { dispatcher, buildProfile, renderResume, renderPortfolio, analyzeJdGap, calibrateResume };
```
테스트:
```typescript
  it('CALIBRATE_RESUME 의도면 calibrateResume 을 호출한다', async () => {
    const d = makeDispatcher('{"action":"CALIBRATE_RESUME"}');
    const outcome = await d.dispatcher.dispatch({ slackUserId: 'U1', text: '이력서 점검' } as never);
    expect(d.calibrateResume.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    expect(outcome.formattedText).toContain('IaC');
  });
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm -C "<wt>" test career-mate.dispatcher`
Expected: FAIL.

- [ ] **Step 3: 구현 (dispatcher)**

import `CalibrateResumeUsecase` + `formatCalibrationReport`. 생성자 마지막 인자 추가:
```typescript
    private readonly calibrateResume: CalibrateResumeUsecase,
```
switch 에 case(default 위):
```typescript
      case 'CALIBRATE_RESUME': {
        const outcome = await this.calibrateResume.execute({ slackUserId });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          outcome.modelUsed,
          formatCalibrationReport(outcome.result),
        );
      }
```

- [ ] **Step 4: 모듈 등록**

`career-mate.module.ts` — import `CalibrateResumeUsecase`, providers/exports 에 추가:
```typescript
    AnalyzeJdGapUsecase,
    CalibrateResumeUsecase,
    CareerMateDispatcher,
```
(exports 에도 `CalibrateResumeUsecase` 추가 — cron 이 주입.)

- [ ] **Step 5: 통과 + 빌드**

Run: `pnpm -C "<wt>" test career-mate.dispatcher && pnpm -C "<wt>" build`
Expected: PASS + 빌드 성공.

- [ ] **Step 6: Commit**

```bash
git add src/agent/career-mate/infrastructure/career-mate.dispatcher.ts src/agent/career-mate/infrastructure/career-mate.dispatcher.spec.ts src/agent/career-mate/career-mate.module.ts
git commit -m "feat(career-mate): 디스패처 CALIBRATE_RESUME case + 모듈 등록"
```

---

## Task 7: 주1회 cron 모듈 (CeoMetaCron 복제)

**Files:**
- Create: `src/resume-calibration-cron/domain/resume-calibration-cron.type.ts`
- Create: `src/resume-calibration-cron/application/resume-calibration-cron.scheduler.ts` (+spec)
- Create: `src/resume-calibration-cron/infrastructure/resume-calibration-cron.consumer.ts` (+spec)
- Create: `src/resume-calibration-cron/resume-calibration-cron.module.ts`

- [ ] **Step 1: 타입/상수**

`domain/resume-calibration-cron.type.ts`:
```typescript
export const RESUME_CALIBRATION_CRON_QUEUE = 'resume-calibration-cron';

export interface ResumeCalibrationCronJobData {
  ownerSlackUserId: string;
  target: string;
}

// 주 1회 — 월요일 10:00 KST 기본. 한 주 시작에 이력서 현재 기준 점검.
export const DEFAULT_RESUME_CALIBRATION_CRON = '0 10 * * 1';
export const DEFAULT_RESUME_CALIBRATION_TIMEZONE = 'Asia/Seoul';

// Hermes 웹리서치 프롬프트 — 현재 2026 이력서/채용 트렌드 조사 요약.
export const RESUME_TREND_RESEARCH_PROMPT =
  '웹검색으로 2026년 현재 개발자 이력서 작성 best practice 와 채용 트렌드를 조사해 핵심만 8줄 이내로 요약해줘. ' +
  'ATS, 정량화, AI 시대 이력서 주의점(generic AI 표현 회피), 최근 강조되는 역량 키워드 중심. 블로그 작성하지 말고 요약 텍스트만.';
```

- [ ] **Step 2: 스케줄러 (CeoMetaCron 복제)**

`application/resume-calibration-cron.scheduler.ts`:
```typescript
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  DEFAULT_RESUME_CALIBRATION_CRON,
  DEFAULT_RESUME_CALIBRATION_TIMEZONE,
  RESUME_CALIBRATION_CRON_QUEUE,
  ResumeCalibrationCronJobData,
} from '../domain/resume-calibration-cron.type';

const RESUME_CALIBRATION_CRON_JOB_NAME = 'resume-calibration-cron';

@Injectable()
export class ResumeCalibrationCronScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ResumeCalibrationCronScheduler.name);

  constructor(
    @InjectQueue(RESUME_CALIBRATION_CRON_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const owner = this.readOwnerOrNull();
    if (!owner) {
      this.logger.log(
        'Resume Calibration Cron 비활성 (RESUME_CALIBRATION_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }
    const target = this.readNonEmpty('RESUME_CALIBRATION_TARGET', owner);
    const cron = this.readNonEmpty(
      'RESUME_CALIBRATION_CRON',
      DEFAULT_RESUME_CALIBRATION_CRON,
    );
    const tz = this.readNonEmpty(
      'RESUME_CALIBRATION_TIMEZONE',
      DEFAULT_RESUME_CALIBRATION_TIMEZONE,
    );

    await this.cleanupExistingRepeatables();

    const payload: ResumeCalibrationCronJobData = {
      ownerSlackUserId: owner,
      target,
    };
    await this.queue.add(RESUME_CALIBRATION_CRON_JOB_NAME, payload, {
      repeat: { pattern: cron, tz },
      jobId: `resume-calibration-cron:${owner}->${target}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });
    this.logger.log(
      `Resume Calibration Cron 활성화 — owner=${owner}, target=${target}, cron="${cron}" (${tz})`,
    );
  }

  private readOwnerOrNull(): string | null {
    const raw = this.configService.get<string>(
      'RESUME_CALIBRATION_OWNER_SLACK_USER_ID',
    );
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

- [ ] **Step 3: 스케줄러 spec**

`resume-calibration-cron.scheduler.spec.ts`:
```typescript
import { ResumeCalibrationCronScheduler } from './resume-calibration-cron.scheduler';

const makeQueue = () => ({
  add: jest.fn().mockResolvedValue(undefined),
  getRepeatableJobs: jest.fn().mockResolvedValue([]),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
});

describe('ResumeCalibrationCronScheduler', () => {
  it('owner 미설정이면 비활성(add 미호출)', async () => {
    const queue = makeQueue();
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const s = new ResumeCalibrationCronScheduler(queue as never, config as never);
    await s.onApplicationBootstrap();
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('owner 설정 시 repeatable 등록', async () => {
    const queue = makeQueue();
    const config = { get: jest.fn((k: string) => (k === 'RESUME_CALIBRATION_OWNER_SLACK_USER_ID' ? 'U1' : undefined)) };
    const s = new ResumeCalibrationCronScheduler(queue as never, config as never);
    await s.onApplicationBootstrap();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0][1]).toEqual({ ownerSlackUserId: 'U1', target: 'U1' });
  });
});
```
Run: `pnpm -C "<wt>" test resume-calibration-cron.scheduler` → PASS.

- [ ] **Step 4: 컨슈머 (CeoMetaCron 복제 + Hermes graceful)**

`infrastructure/resume-calibration-cron.consumer.ts`:
```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import { CalibrateResumeUsecase } from '../../agent/career-mate/application/calibrate-resume.usecase';
import { CareerMateException } from '../../agent/career-mate/domain/career-mate.exception';
import { CareerMateErrorCode } from '../../agent/career-mate/domain/career-mate-error-code.enum';
import { formatCalibrationReport } from '../../agent/career-mate/infrastructure/career-mate.formatter';
import {
  HERMES_RUNNER_PORT,
  HermesRunnerPort,
} from '../../agent/blog/domain/port/hermes-runner.port';
import { getTodayKstDate } from '../../common/date/kst-date.util';
import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { CronIdempotencyService } from '../../common/cron/cron-idempotency.service';
import { SLACK_NOTIFIER_PORT } from '../../morning-briefing/domain/port/slack-notifier.port';
import { SlackNotifierPort } from '../../morning-briefing/domain/port/slack-notifier.port';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import {
  RESUME_CALIBRATION_CRON_QUEUE,
  RESUME_TREND_RESEARCH_PROMPT,
  ResumeCalibrationCronJobData,
} from '../domain/resume-calibration-cron.type';

const SENT_GUARD_TTL_SECONDS = 90_000;

@Processor(RESUME_CALIBRATION_CRON_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class ResumeCalibrationCronConsumer extends WorkerHost {
  private readonly logger = new Logger(ResumeCalibrationCronConsumer.name);

  constructor(
    private readonly calibrateResume: CalibrateResumeUsecase,
    @Inject(HERMES_RUNNER_PORT)
    private readonly hermesRunner: HermesRunnerPort,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<ResumeCalibrationCronJobData>): Promise<void> {
    const { ownerSlackUserId, target } = job.data;
    const todayKst = getTodayKstDate();
    this.logger.log(
      `Resume Calibration Cron 시작 — owner=${ownerSlackUserId} → target=${target}`,
    );
    try {
      const webTrendsNote = await this.safeResearch();
      const outcome = await this.calibrateResume.execute({
        slackUserId: ownerSlackUserId,
        webTrendsNote,
      });
      const text =
        `🔍 *이력서 보정 점검 — ${todayKst} (주간 자동${webTrendsNote ? ' · 웹 트렌드 반영' : ''})*\n\n` +
        formatCalibrationReport(outcome.result);
      await this.deliverOnce(target, text);
    } catch (error) {
      if (
        error instanceof CareerMateException &&
        error.careerMateErrorCode === CareerMateErrorCode.NO_EVIDENCE
      ) {
        this.logger.warn(
          `Resume Calibration Cron skip — 역량 프로필/증거 없음 (owner=${ownerSlackUserId})`,
        );
        await this.deliverOnce(
          target,
          `🌙 *이력서 보정 점검 — ${todayKst} skip*\n_역량 프로필이 없어 점검을 건너뜁니다. "@이대리 프로필 정리해줘" 먼저 실행해주세요._`,
        );
        return;
      }
      this.logger.error(
        `Resume Calibration Cron 실패 (owner=${ownerSlackUserId})`,
        error,
      );
      this.notifyOwnerFailure(ownerSlackUserId, error);
      throw error;
    }
  }

  // Hermes 웹리서치 — 실패해도 throw 안 함(웹 없이 Claude 지식만으로 graceful degrade).
  private async safeResearch(): Promise<string | undefined> {
    try {
      const result = await this.hermesRunner.run(RESUME_TREND_RESEARCH_PROMPT);
      const note = result.stdout.trim();
      return note.length > 0 ? note : undefined;
    } catch (error) {
      this.logger.warn(
        `Hermes 이력서 트렌드 리서치 실패 — 웹 없이 진행: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private async deliverOnce(target: string, text: string): Promise<void> {
    const dateKey = getTodayKstDate();
    const firstRun = await this.cronIdempotency.acquireOnce(
      `cron:${RESUME_CALIBRATION_CRON_QUEUE}:${dateKey}`,
      SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(
        `Resume Calibration Cron 중복 발송 차단 — ${dateKey} 이미 발송됨`,
      );
      return;
    }
    await this.slackNotifier.postMessage({ target, text });
    this.logger.log(`Resume Calibration Cron 발송 완료 — target=${target}`);
  }

  private notifyOwnerFailure(ownerSlackUserId: string, error: unknown): void {
    if (!this.notificationPublisher) {
      return;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.notificationPublisher.publishCronFailure({
      cronName: 'Resume Calibration Cron',
      ownerSlackUserId,
      errorMessage,
    });
  }
}
```
> 주의: `getTodayKstDate` 경로(`common/date/kst-date.util`)·`CronIdempotencyService` 경로·`NotificationPublisher`/`CronFailureJobData` 경로는 CeoMetaCron consumer 의 import 와 **동일하게** 맞춰라(구현 시 CeoMetaCron consumer import 줄을 그대로 참고). `SlackNotifierPort` 는 type import.

- [ ] **Step 5: 컨슈머 spec**

`resume-calibration-cron.consumer.spec.ts`:
```typescript
import { ResumeCalibrationCronConsumer } from './resume-calibration-cron.consumer';

const CAL = { verdict: 'ok', aiSlopRisks: [], underQuantified: [], outdatedPhrasing: [], missingKeywords: [], actionItems: ['x'] };

const makeConsumer = (opts: { hermesOk: boolean }) => {
  const calibrateResume = { execute: jest.fn().mockResolvedValue({ result: CAL, modelUsed: 'claude-cli', agentRunId: 1 }) };
  const hermesRunner = {
    run: opts.hermesOk
      ? jest.fn().mockResolvedValue({ stdout: '2026 트렌드 요약', stderr: '' })
      : jest.fn().mockRejectedValue(new Error('hermes down')),
  };
  const slackNotifier = { postMessage: jest.fn().mockResolvedValue(undefined) };
  const cronIdempotency = { acquireOnce: jest.fn().mockResolvedValue(true) };
  const consumer = new ResumeCalibrationCronConsumer(
    calibrateResume as never, hermesRunner as never, slackNotifier as never, cronIdempotency as never,
  );
  return { consumer, calibrateResume, hermesRunner, slackNotifier };
};

describe('ResumeCalibrationCronConsumer', () => {
  it('Hermes 성공 시 webTrendsNote 를 calibrate 에 전달하고 Slack 발송', async () => {
    const d = makeConsumer({ hermesOk: true });
    await d.consumer.process({ data: { ownerSlackUserId: 'U1', target: 'U1' } } as never);
    expect(d.calibrateResume.execute).toHaveBeenCalledWith({ slackUserId: 'U1', webTrendsNote: '2026 트렌드 요약' });
    expect(d.slackNotifier.postMessage).toHaveBeenCalledTimes(1);
  });
  it('Hermes 실패해도 graceful — webTrendsNote undefined 로 진행', async () => {
    const d = makeConsumer({ hermesOk: false });
    await d.consumer.process({ data: { ownerSlackUserId: 'U1', target: 'U1' } } as never);
    expect(d.calibrateResume.execute).toHaveBeenCalledWith({ slackUserId: 'U1', webTrendsNote: undefined });
    expect(d.slackNotifier.postMessage).toHaveBeenCalledTimes(1);
  });
});
```
Run: `pnpm -C "<wt>" test resume-calibration-cron.consumer` → PASS.

- [ ] **Step 6: 모듈 (CeoMetaCron 모듈 복제)**

`resume-calibration-cron.module.ts`:
```typescript
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { CareerMateModule } from '../agent/career-mate/career-mate.module';
import { HermesCliRunner } from '../agent/blog/infrastructure/hermes-cli.runner';
import { HERMES_RUNNER_PORT } from '../agent/blog/domain/port/hermes-runner.port';
import { SLACK_NOTIFIER_PORT } from '../morning-briefing/domain/port/slack-notifier.port';
import { NotificationQueueModule } from '../notification/notification-queue.module';
import { SlackModule } from '../slack/slack.module';
import { SlackService } from '../slack/slack.service';
import { ResumeCalibrationCronScheduler } from './application/resume-calibration-cron.scheduler';
import { RESUME_CALIBRATION_CRON_QUEUE } from './domain/resume-calibration-cron.type';
import { ResumeCalibrationCronConsumer } from './infrastructure/resume-calibration-cron.consumer';

@Module({
  imports: [
    BullModule.registerQueue({ name: RESUME_CALIBRATION_CRON_QUEUE }),
    CareerMateModule,
    SlackModule,
    NotificationQueueModule,
  ],
  providers: [
    ResumeCalibrationCronScheduler,
    ResumeCalibrationCronConsumer,
    { provide: HERMES_RUNNER_PORT, useClass: HermesCliRunner },
    { provide: SLACK_NOTIFIER_PORT, useExisting: SlackService },
  ],
})
export class ResumeCalibrationCronModule {}
```
> `CronIdempotencyService` 가 전역 제공이 아니면 (CeoMetaCron 모듈이 어떻게 얻는지 확인 후) imports/providers 에 맞춰 추가. CeoMetaCron 모듈과 동일하게.

- [ ] **Step 7: Commit**

```bash
git add src/resume-calibration-cron/
git commit -m "feat(career-mate): 주1회 이력서 보정 cron (Hermes 웹 augment + Slack DM)"
```

---

## Task 8: app.module 등록 + env

**Files:**
- Modify: `src/app.module.ts`
- Modify: `src/config/app.config.ts`
- Modify: `.env.example`

- [ ] **Step 1: app.module 등록**

`CeoMetaCronModule` import 줄 옆에 추가 + imports 배열에:
```typescript
import { ResumeCalibrationCronModule } from './resume-calibration-cron/resume-calibration-cron.module';
// ...
    CeoMetaCronModule,
    ResumeCalibrationCronModule,
```

- [ ] **Step 2: app.config env (CeoMeta 패턴)**

`CEO_META_CRON_RANGE` 블록 아래에:
```typescript
  // ====== Resume Calibration Cron — 주 1회 이력서 보정 점검 (Phase 4) ======
  // - RESUME_CALIBRATION_OWNER_SLACK_USER_ID: 점검 주체. 미설정 시 모듈 비활성.
  // - RESUME_CALIBRATION_TARGET: 발송 대상 (Slack user/channel). 미설정 시 OWNER DM.
  // - RESUME_CALIBRATION_CRON: BullMQ cron (default 월 10:00 — `0 10 * * 1`).
  // - RESUME_CALIBRATION_TIMEZONE: default Asia/Seoul.
  @IsOptional()
  @IsString()
  RESUME_CALIBRATION_OWNER_SLACK_USER_ID?: string;

  @IsOptional()
  @IsString()
  RESUME_CALIBRATION_TARGET?: string;

  @IsOptional()
  @IsString()
  RESUME_CALIBRATION_CRON?: string;

  @IsOptional()
  @IsString()
  RESUME_CALIBRATION_TIMEZONE?: string;
```

- [ ] **Step 3: .env.example**

CEO_META_CRON 블록 아래에:
```
# Resume Calibration Cron (Phase 4) — 주1회 이력서 보정 점검 DM
RESUME_CALIBRATION_OWNER_SLACK_USER_ID=
RESUME_CALIBRATION_TARGET=
RESUME_CALIBRATION_CRON=0 10 * * 1
RESUME_CALIBRATION_TIMEZONE=Asia/Seoul
```

- [ ] **Step 4: build**

Run: `pnpm -C "<wt>" build`
Expected: 성공 (DI 해소 — CareerMateModule export 한 CalibrateResumeUsecase + global PreviewGate/Prisma).

- [ ] **Step 5: Commit**

```bash
git add src/app.module.ts src/config/app.config.ts .env.example
git commit -m "feat(career-mate): ResumeCalibrationCronModule 등록 + RESUME_CALIBRATION_* env"
```

---

## Task 9: 최종 검증 (4중 green)

- [ ] **Step 1**: `pnpm -C "<wt>" lint:check` → 0 errors.
- [ ] **Step 2**: `pnpm -C "<wt>" test "calibration|calibrate-resume|career-mate|resume-calibration-cron"` → 전부 pass. (code-graph 트리시터 flake 는 메인에서도 재현되는 기존 무관 이슈.)
- [ ] **Step 3**: `pnpm -C "<wt>" build` → exit 0.
- [ ] **Step 4**: `pnpm -C "<wt>" docs:check` → OK (신규 에이전트/env 추가 — 에이전트 카탈로그는 CAREER_MATE 동일이라 무변, env 카탈로그는 RESUME_CALIBRATION_* 추가로 드리프트 가능 → 드리프트면 `pnpm -C "<wt>" docs:sync` 후 커밋).
- [ ] **Step 5**: 4개 중 비-0 이면 해당 Task 복귀. 임의 스킵 금지.
- [ ] **Step 6 (owner 수동)**: `.env` 에 `RESUME_CALIBRATION_OWNER_SLACK_USER_ID` 등 + 봇 재시작 → `@이대리 이력서 점검해줘` 즉시 점검 / 주1회 cron 자동 DM 확인.

---

## 자기 점검 (작성자)

- **스펙 커버리지**: §3 온디맨드→Task 4/6, cron→Task 7 / §4 컴포넌트→Task 1~8 / §5 데이터→Task 1/2 / §6 흐름→Task 4(usecase)·7(consumer safeResearch graceful) / §7 에러(NO_EVIDENCE skip, Hermes graceful)→Task 7 / §8 테스트→각 Task + Task 9. ✅
- **placeholder**: 없음. (cron consumer 의 `getTodayKstDate`/`CronIdempotencyService`/`NotificationPublisher` import 경로는 "CeoMetaCron consumer 와 동일" 지시 — 구현 시 그 파일 import 줄 복사로 확정. 정당한 in-repo 확인.)
- **타입 일관성**: `CalibrationResultData`/`CalibrateResumeInput`/`parseCalibrationOutput`/`buildCalibrationPrompt`/`formatCalibrationReport`/`CALIBRATE_RESUME`/`RESUME_CALIBRATION_CRON_QUEUE` — Task 간 일치. ✅
- **docs:check**: Phase 1 교훈 반영 — env 추가라 env-catalog 드리프트 가능 → Task 9 에 docs:sync 명시.
- **열린 항목**: `HermesRunResult.stdout` 사용(확인됨). cron 의 CronIdempotency 모듈 wiring 은 CeoMetaCron 모듈과 동일하게(구현 시 확인).
