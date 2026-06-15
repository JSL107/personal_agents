# 이직 메이트 Phase 1 구현 계획 (역량 프로필 허브 + 이력서/포트폴리오)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** merged PR 을 합성해 증거 기반 "역량 프로필"을 Postgres 에 영속하고, 거기서 이력서(STAR bullet)·포트폴리오(Notion 페이지)를 파생하는 단일 `CAREER_MATE` 에이전트(자연어 멘션 진입)를 추가한다.

**Architecture:** VACATION 디스패처 하이브리드 패턴(자연어→intent 파싱→결정론 switch) + PO_EVAL usecase 패턴(`agentRunService.execute` 래핑). LLM 은 BuildProfile 에서만 1회(+멘션 파싱 1회), Render(이력서/포트폴리오)는 허브를 결정론 포맷. 허브는 전용 `CareerProfile` Prisma 테이블(블롭 + 버저닝).

**Tech Stack:** NestJS 10, Prisma 6(PostgreSQL @5434), Slack Bolt 4, class-validator, jest. LLM=Claude(model-router 경유). 소스=`GithubClientPort.listAuthorMergedPullRequestsSince`. 미러=`NotionClientPort.findOrCreateChildPage`+`appendBlocks`.

**설계서:** `docs/superpowers/specs/2026-06-15-career-mate-phase1-design.md`

**스펙 대비 의도적 단순화 (실행 전 확인):**
- **진입은 자연어 멘션만** (BLOG 선례와 동일, `slashCommands: []`). 슬래시 3종은 Slack 앱 설정 UI 등록(코드 밖 owner 작업)이 필요하므로 Phase 1.5 로 미룸. 디스패처가 멘션 텍스트에서 BUILD/RESUME/PORTFOLIO sub-intent 를 파싱하므로 기능은 완전.
- **`/retry-run` 은 BLOG 식 "재멘션 안내"** (BuildProfile 재실행은 "프로필 다시 정리해줘" 자연어로 가능). retry-run 핸들러 내부 supported-case 구조를 건드리지 않음.

---

## File Structure

**생성 (`src/agent/career-mate/`):**
- `domain/career-mate-error-code.enum.ts` — 도메인 에러코드
- `domain/career-mate.exception.ts` — 예외 클래스
- `domain/career-mate.type.ts` — `CareerProfileData`, `CareerMateAction`, `CareerMateIntent`, usecase 입출력 타입
- `domain/prompt/career-mate-intent.prompt.ts` — 멘션→action 파싱 (system prompt + `parseCareerMateIntent`)
- `domain/prompt/career-profile-synth.prompt.ts` — PR→프로필 합성 (system prompt + `buildSynthPrompt` + `parseCareerProfileOutput`)
- `domain/port/career-profile.repository.port.ts` — 리포지토리 포트 + DI 토큰
- `infrastructure/career-profile.prisma.repository.ts` — Prisma 구현
- `infrastructure/career-mate.formatter.ts` — Slack mrkdwn + Notion blocks 빌더
- `application/build-career-profile.usecase.ts` — LLM 합성 (AgentRun 래핑)
- `application/render-resume.usecase.ts` — 허브→이력서 (없으면 자동 Build)
- `application/render-portfolio.usecase.ts` — 허브→Notion 미러 (없으면 자동 Build)
- `infrastructure/career-mate.dispatcher.ts` — AgentDispatcher 구현
- `career-mate.module.ts` — 모듈 와이어링
- 각 순수/조합 단위의 `*.spec.ts`

**수정:**
- `prisma/schema.prisma` — `CareerProfile` model + `AgentRun.careerProfiles` 역관계
- `src/model-router/domain/model-router.type.ts` — `AgentType.CAREER_MATE`
- `src/model-router/application/model-router.usecase.ts` — `AGENT_TO_PROVIDER`
- `src/agent-run/domain/agent-run.type.ts` — `TriggerType.SLACK_MENTION_CAREER_MATE`
- `src/common/exception/response-code.enum.ts` — `CAREER_MATE_*`
- `src/router/router.module.ts` — import + inject
- `src/router/domain/prompt/intent-classifier-system.prompt.ts` — 분류 후보
- `src/slack/handler/retry-run.handler.ts` — switch case
- `src/agent-registry/agent-registry.ts` — 엔트리
- `src/config/app.config.ts` — `CAREER_PORTFOLIO_NOTION_PAGE_ID`, `GITHUB_OWNER_LOGIN`
- `.env.example`, `.env`, `README.md` — env 동기

---

## Task 1: Prisma `CareerProfile` 모델 추가

**Files:**
- Modify: `prisma/schema.prisma` (AgentRun model + 신규 model)

- [ ] **Step 1: `AgentRun` model 에 역관계 한 줄 추가**

`prisma/schema.prisma` 의 `model AgentRun { ... }` 안, `prReviewOutcomes PrReviewOutcome[]` 줄 아래에 추가:

```prisma
  prReviewOutcomes PrReviewOutcome[]
  careerProfiles   CareerProfile[]
```

- [ ] **Step 2: 파일 끝에 `CareerProfile` model 추가**

```prisma
model CareerProfile {
  id          Int       @id @default(autoincrement())
  agentRunId  Int?      @map("agent_run_id")
  agentRun    AgentRun? @relation(fields: [agentRunId], references: [id], onDelete: SetNull)
  slackUserId String    @map("slack_user_id")
  githubLogin String    @map("github_login")
  windowStart DateTime  @map("window_start") @db.Date
  prCount     Int       @map("pr_count")
  summary     String    @db.Text
  profileJson Json      @map("profile_json")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@index([slackUserId, createdAt])
  @@map("career_profile")
}
```

- [ ] **Step 3: 포맷 + 스키마 동기화 + 클라이언트 재생성**

Run:
```bash
pnpm prisma format
pnpm db:push
pnpm prisma:generate
```
Expected: `db:push` 가 `career_profile` 테이블 생성 보고, `prisma:generate` 성공.

- [ ] **Step 4: 타입 확인용 빌드**

Run: `pnpm build`
Expected: 성공 (PrismaClient 에 `careerProfile` delegate 존재).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(career-mate): CareerProfile Prisma 모델 추가"
```

---

## Task 2: 도메인 — 에러코드 · 예외 · 타입

**Files:**
- Create: `src/agent/career-mate/domain/career-mate-error-code.enum.ts`
- Create: `src/agent/career-mate/domain/career-mate.exception.ts`
- Create: `src/agent/career-mate/domain/career-mate.type.ts`

- [ ] **Step 1: 에러코드 enum 작성**

`src/agent/career-mate/domain/career-mate-error-code.enum.ts`:
```typescript
export enum CareerMateErrorCode {
  NL_PARSE_FAILED = 'CAREER_MATE_NL_PARSE_FAILED',
  NO_EVIDENCE = 'CAREER_MATE_NO_EVIDENCE',
  INVALID_MODEL_OUTPUT = 'CAREER_MATE_INVALID_MODEL_OUTPUT',
  CONFIG_MISSING = 'CAREER_MATE_CONFIG_MISSING',
}
```

- [ ] **Step 2: 예외 클래스 작성 (VACATION 패턴 복제)**

`src/agent/career-mate/domain/career-mate.exception.ts`:
```typescript
import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CareerMateErrorCode } from './career-mate-error-code.enum';

type CareerMateExceptionOptions = {
  message: string;
  code: CareerMateErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class CareerMateException extends DomainException {
  readonly careerMateErrorCode: CareerMateErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.careerMateErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: CareerMateExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.careerMateErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
```

- [ ] **Step 3: 도메인 타입 작성**

`src/agent/career-mate/domain/career-mate.type.ts`:
```typescript
export type SkillCategory = 'LANGUAGE' | 'FRAMEWORK' | 'DOMAIN' | 'TOOL';
export type Proficiency = 'FAMILIAR' | 'PROFICIENT' | 'EXPERT';

export interface SkillEvidence {
  repo: string;
  pr: number;
  url: string;
}

export interface ProfileSkill {
  name: string;
  category: SkillCategory;
  proficiency: Proficiency;
  evidence: SkillEvidence[];
}

export interface AccomplishmentEvidence extends SkillEvidence {
  mergedAt: string;
}

export interface ProfileAccomplishment {
  title: string;
  bullet: string;
  star: { situation: string; task: string; action: string; result: string };
  techTags: string[];
  evidence: AccomplishmentEvidence[];
}

export interface CareerProfileData {
  summary: string;
  skills: ProfileSkill[];
  accomplishments: ProfileAccomplishment[];
  meta: { githubLogin: string; windowStart: string; prCount: number };
}

export type CareerMateAction =
  | 'BUILD_PROFILE'
  | 'RENDER_RESUME'
  | 'RENDER_PORTFOLIO'
  | 'UNKNOWN';

export interface CareerMateIntent {
  action: CareerMateAction;
  windowMonths?: number;
}

export interface BuildCareerProfileInput {
  slackUserId: string;
  windowMonths?: number;
}

export interface RenderResumeInput {
  slackUserId: string;
}

export interface RenderResumeResult {
  profile: CareerProfileData;
  agentRunId: number;
}

export interface RenderPortfolioInput {
  slackUserId: string;
}

export interface RenderPortfolioResult {
  url: string;
  pageId: string;
  agentRunId: number;
}
```

- [ ] **Step 4: 빌드 확인**

Run: `pnpm build`
Expected: 성공.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/domain/career-mate-error-code.enum.ts src/agent/career-mate/domain/career-mate.exception.ts src/agent/career-mate/domain/career-mate.type.ts
git commit -m "feat(career-mate): 도메인 에러코드·예외·타입 추가"
```

---

## Task 3: 멘션 intent 파싱 (`career-mate-intent.prompt.ts`)

**Files:**
- Create: `src/agent/career-mate/domain/prompt/career-mate-intent.prompt.ts`
- Test: `src/agent/career-mate/domain/prompt/career-mate-intent.prompt.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/agent/career-mate/domain/prompt/career-mate-intent.prompt.spec.ts`:
```typescript
import { CareerMateException } from '../career-mate.exception';
import { parseCareerMateIntent } from './career-mate-intent.prompt';

describe('parseCareerMateIntent', () => {
  it('BUILD_PROFILE 를 windowMonths 와 함께 파싱한다', () => {
    const intent = parseCareerMateIntent(
      '{"action":"BUILD_PROFILE","windowMonths":6}',
    );
    expect(intent).toEqual({ action: 'BUILD_PROFILE', windowMonths: 6 });
  });

  it('코드펜스로 감싼 JSON 도 파싱한다', () => {
    const intent = parseCareerMateIntent(
      '```json\n{"action":"RENDER_RESUME"}\n```',
    );
    expect(intent.action).toBe('RENDER_RESUME');
  });

  it('RENDER_PORTFOLIO 를 파싱한다', () => {
    expect(parseCareerMateIntent('{"action":"RENDER_PORTFOLIO"}').action).toBe(
      'RENDER_PORTFOLIO',
    );
  });

  it('알 수 없는 action 은 UNKNOWN 으로 정규화한다', () => {
    expect(parseCareerMateIntent('{"action":"FOO"}').action).toBe('UNKNOWN');
  });

  it('JSON 이 아니면 CareerMateException 을 던진다', () => {
    expect(() => parseCareerMateIntent('헛소리')).toThrow(CareerMateException);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test career-mate-intent.prompt`
Expected: FAIL ("Cannot find module './career-mate-intent.prompt'").

- [ ] **Step 3: 구현 작성**

`src/agent/career-mate/domain/prompt/career-mate-intent.prompt.ts`:
```typescript
import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { CareerMateException } from '../career-mate.exception';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';
import { CareerMateAction, CareerMateIntent } from '../career-mate.type';

export const CAREER_MATE_INTENT_SYSTEM_PROMPT = `너는 "이직 메이트"의 자연어 의도 분류기다.
사용자 메시지를 아래 JSON 하나로만 변환한다. 설명/주석 없이 JSON 만 출력한다.

action 은 다음 중 하나:
- "BUILD_PROFILE": 역량 프로필을 새로 만들거나 갱신 ("프로필 정리해줘", "내 역량 정리", "경력 업데이트"). 기간 언급이 있으면 windowMonths(정수 개월)로.
- "RENDER_RESUME": 이력서/성과 bullet 출력 ("이력서 뽑아줘", "성과 bullet", "resume").
- "RENDER_PORTFOLIO": 포트폴리오 페이지 생성 ("포트폴리오 정리", "포트폴리오 페이지").
- "UNKNOWN": 위에 해당 없음.

출력 예시:
{"action":"BUILD_PROFILE","windowMonths":12}
{"action":"RENDER_RESUME"}`;

const VALID_ACTIONS: CareerMateAction[] = [
  'BUILD_PROFILE',
  'RENDER_RESUME',
  'RENDER_PORTFOLIO',
  'UNKNOWN',
];

const stripCodeFence = (text: string): string =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

export const parseCareerMateIntent = (text: string): CareerMateIntent => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    throw new CareerMateException({
      code: CareerMateErrorCode.NL_PARSE_FAILED,
      message:
        '요청을 이해하지 못했습니다. "프로필 정리해줘" / "이력서 뽑아줘" / "포트폴리오 정리" 처럼 말씀해주세요.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || !('action' in parsed)) {
    return { action: 'UNKNOWN' };
  }
  const obj = parsed as Record<string, unknown>;
  const action = VALID_ACTIONS.includes(obj.action as CareerMateAction)
    ? (obj.action as CareerMateAction)
    : 'UNKNOWN';
  const windowMonths =
    Number.isInteger(obj.windowMonths) && Number(obj.windowMonths) > 0
      ? Number(obj.windowMonths)
      : undefined;
  return windowMonths ? { action, windowMonths } : { action };
};
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test career-mate-intent.prompt`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/domain/prompt/career-mate-intent.prompt.ts src/agent/career-mate/domain/prompt/career-mate-intent.prompt.spec.ts
git commit -m "feat(career-mate): 멘션 intent 파싱 추가"
```

---

## Task 4: 프로필 합성 프롬프트 + 출력 파싱 (`career-profile-synth.prompt.ts`)

**Files:**
- Create: `src/agent/career-mate/domain/prompt/career-profile-synth.prompt.ts`
- Test: `src/agent/career-mate/domain/prompt/career-profile-synth.prompt.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/agent/career-mate/domain/prompt/career-profile-synth.prompt.spec.ts`:
```typescript
import { CareerMateException } from '../career-mate.exception';
import {
  buildSynthPrompt,
  parseCareerProfileOutput,
} from './career-profile-synth.prompt';

const VALID = JSON.stringify({
  summary: '백엔드 5년차, 분산 처리 강점',
  skills: [
    {
      name: 'NestJS',
      category: 'FRAMEWORK',
      proficiency: 'EXPERT',
      evidence: [{ repo: 'o/r', pr: 1, url: 'https://x/1' }],
    },
  ],
  accomplishments: [
    {
      title: '큐 락 안정화',
      bullet: 'BullMQ lockDuration 재설계로 stalled 0 달성',
      star: { situation: 's', task: 't', action: 'a', result: 'r' },
      techTags: ['BullMQ'],
      evidence: [
        { repo: 'o/r', pr: 1, url: 'https://x/1', mergedAt: '2026-06-01' },
      ],
    },
  ],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
});

describe('buildSynthPrompt', () => {
  it('PR 제목과 repo 를 프롬프트에 포함한다', () => {
    const prompt = buildSynthPrompt([
      {
        number: 7,
        title: '큐 락 수정',
        body: 'lockDuration',
        repo: 'o/r',
        url: 'https://x/7',
        state: 'merged',
        mergedAt: '2026-06-01',
        updatedAt: '2026-06-01',
        additions: 10,
        deletions: 2,
        changedFilesCount: 3,
      },
    ]);
    expect(prompt).toContain('큐 락 수정');
    expect(prompt).toContain('o/r#7');
  });
});

describe('parseCareerProfileOutput', () => {
  it('유효한 JSON 을 CareerProfileData 로 파싱한다', () => {
    const data = parseCareerProfileOutput(VALID);
    expect(data.skills[0].name).toBe('NestJS');
    expect(data.accomplishments[0].evidence[0].pr).toBe(1);
  });

  it('코드펜스를 제거하고 파싱한다', () => {
    expect(parseCareerProfileOutput('```json\n' + VALID + '\n```').summary).toContain(
      '백엔드',
    );
  });

  it('skills 가 배열이 아니면 INVALID_MODEL_OUTPUT 예외', () => {
    expect(() =>
      parseCareerProfileOutput('{"summary":"x","skills":"no","accomplishments":[],"meta":{}}'),
    ).toThrow(CareerMateException);
  });

  it('JSON 이 아니면 예외', () => {
    expect(() => parseCareerProfileOutput('not json')).toThrow(
      CareerMateException,
    );
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test career-profile-synth.prompt`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현 작성**

`src/agent/career-mate/domain/prompt/career-profile-synth.prompt.ts`:
```typescript
import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { GithubPullRequestSummary } from '../../../../github/domain/github.type';
import { CareerMateException } from '../career-mate.exception';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';
import { CareerProfileData } from '../career-mate.type';

export const CAREER_PROFILE_SYNTH_SYSTEM_PROMPT = `너는 개발자의 merged PR 이력을 이직용 "역량 프로필"로 합성하는 전문가다.
입력으로 PR 목록(제목/본문/저장소/증감 줄수/머지일)을 받는다.
아래 JSON 스키마 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

규칙:
- 모든 skill 과 accomplishment 에는 근거가 된 PR 의 evidence(repo, pr 번호, url)를 반드시 1개 이상 포함한다. 증거 없는 항목은 만들지 않는다.
- accomplishment.bullet 은 이력서 한 줄: "행동 + 결과 + (가능하면) 정량 지표".
- star 는 situation/task/action/result 각 1~2문장.
- skills.category 는 LANGUAGE | FRAMEWORK | DOMAIN | TOOL 중 하나, proficiency 는 FAMILIAR | PROFICIENT | EXPERT 중 하나(증거 PR 수/난이도로 판단).
- 과장 금지. PR 에서 확인되는 것만.

스키마:
{
  "summary": "2~3문장 헤드라인",
  "skills": [{"name","category","proficiency","evidence":[{"repo","pr","url"}]}],
  "accomplishments": [{"title","bullet","star":{"situation","task","action","result"},"techTags":[],"evidence":[{"repo","pr","url","mergedAt"}]}],
  "meta": {"githubLogin","windowStart","prCount"}
}`;

export const buildSynthPrompt = (
  prs: GithubPullRequestSummary[],
): string => {
  const lines = prs.map((pr) => {
    const body = (pr.body ?? '').replace(/\s+/g, ' ').slice(0, 400);
    return `- ${pr.repo}#${pr.number} "${pr.title}" (+${pr.additions}/-${pr.deletions}, files ${pr.changedFilesCount}, merged ${pr.mergedAt}) url=${pr.url}\n  본문: ${body}`;
  });
  return `다음은 합성 대상 merged PR ${prs.length}건이다.\n\n${lines.join('\n')}`;
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

export const parseCareerProfileOutput = (text: string): CareerProfileData => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return invalid('프로필 생성 실패 — 모델 출력이 JSON 이 아닙니다.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return invalid('프로필 생성 실패 — 모델 출력 형식 오류.');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.summary !== 'string') {
    return invalid('프로필 생성 실패 — summary 누락.');
  }
  if (!Array.isArray(obj.skills) || !Array.isArray(obj.accomplishments)) {
    return invalid('프로필 생성 실패 — skills/accomplishments 가 배열이 아닙니다.');
  }
  if (typeof obj.meta !== 'object' || obj.meta === null) {
    return invalid('프로필 생성 실패 — meta 누락.');
  }
  return parsed as CareerProfileData;
};
```

> 참고: `GithubPullRequestSummary` 는 `src/github/domain/github.type.ts` 에 이미 정의됨 (number, title, body, repo, url, state, mergedAt, updatedAt, additions, deletions, changedFilesCount).

- [ ] **Step 4: 통과 확인**

Run: `pnpm test career-profile-synth.prompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/domain/prompt/career-profile-synth.prompt.ts src/agent/career-mate/domain/prompt/career-profile-synth.prompt.spec.ts
git commit -m "feat(career-mate): 프로필 합성 프롬프트 + 출력 파싱 추가"
```

---

## Task 5: 리포지토리 포트 + Prisma 구현

**Files:**
- Create: `src/agent/career-mate/domain/port/career-profile.repository.port.ts`
- Create: `src/agent/career-mate/infrastructure/career-profile.prisma.repository.ts`
- Test: `src/agent/career-mate/infrastructure/career-profile.prisma.repository.spec.ts`

- [ ] **Step 1: 포트 작성**

`src/agent/career-mate/domain/port/career-profile.repository.port.ts`:
```typescript
import { CareerProfileData } from '../career-mate.type';

export const CAREER_PROFILE_REPOSITORY_PORT = Symbol(
  'CAREER_PROFILE_REPOSITORY_PORT',
);

export interface SaveCareerProfileInput {
  agentRunId: number;
  slackUserId: string;
  githubLogin: string;
  windowStart: string; // YYYY-MM-DD
  prCount: number;
  summary: string;
  profileJson: CareerProfileData;
}

export interface CareerProfileSnapshot {
  id: number;
  agentRunId: number | null;
  profileJson: CareerProfileData;
  createdAt: Date;
}

export interface CareerProfileRepositoryPort {
  save(input: SaveCareerProfileInput): Promise<{ id: number }>;
  findLatestBySlackUser(
    slackUserId: string,
  ): Promise<CareerProfileSnapshot | null>;
}
```

- [ ] **Step 2: 실패 테스트 작성**

`src/agent/career-mate/infrastructure/career-profile.prisma.repository.spec.ts`:
```typescript
import { PrismaService } from '../../../prisma/prisma.service';
import { CareerProfileData } from '../domain/career-mate.type';
import { CareerProfilePrismaRepository } from './career-profile.prisma.repository';

const SAMPLE: CareerProfileData = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 0 },
};

describe('CareerProfilePrismaRepository', () => {
  it('save 는 prisma.careerProfile.create 를 호출하고 id 를 반환한다', async () => {
    const create = jest.fn().mockResolvedValue({ id: 42 });
    const prisma = { careerProfile: { create } } as unknown as PrismaService;
    const repo = new CareerProfilePrismaRepository(prisma);

    const result = await repo.save({
      agentRunId: 1,
      slackUserId: 'U1',
      githubLogin: 'octo',
      windowStart: '2025-06-15',
      prCount: 3,
      summary: 's',
      profileJson: SAMPLE,
    });

    expect(result).toEqual({ id: 42 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.slackUserId).toBe('U1');
  });

  it('findLatestBySlackUser 는 없으면 null', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = { careerProfile: { findFirst } } as unknown as PrismaService;
    const repo = new CareerProfilePrismaRepository(prisma);
    expect(await repo.findLatestBySlackUser('U1')).toBeNull();
  });

  it('findLatestBySlackUser 는 row 를 snapshot 으로 매핑한다', async () => {
    const createdAt = new Date('2026-06-15T00:00:00Z');
    const findFirst = jest
      .fn()
      .mockResolvedValue({ id: 9, agentRunId: 5, profileJson: SAMPLE, createdAt });
    const prisma = { careerProfile: { findFirst } } as unknown as PrismaService;
    const repo = new CareerProfilePrismaRepository(prisma);

    const snap = await repo.findLatestBySlackUser('U1');
    expect(snap).toEqual({ id: 9, agentRunId: 5, profileJson: SAMPLE, createdAt });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm test career-profile.prisma.repository`
Expected: FAIL (모듈 없음).

- [ ] **Step 4: 구현 작성**

`src/agent/career-mate/infrastructure/career-profile.prisma.repository.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { CareerProfileData } from '../domain/career-mate.type';
import {
  CareerProfileRepositoryPort,
  CareerProfileSnapshot,
  SaveCareerProfileInput,
} from '../domain/port/career-profile.repository.port';

@Injectable()
export class CareerProfilePrismaRepository
  implements CareerProfileRepositoryPort
{
  constructor(private readonly prisma: PrismaService) {}

  async save(input: SaveCareerProfileInput): Promise<{ id: number }> {
    const row = await this.prisma.careerProfile.create({
      data: {
        agentRunId: input.agentRunId,
        slackUserId: input.slackUserId,
        githubLogin: input.githubLogin,
        windowStart: new Date(input.windowStart),
        prCount: input.prCount,
        summary: input.summary,
        profileJson: input.profileJson as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async findLatestBySlackUser(
    slackUserId: string,
  ): Promise<CareerProfileSnapshot | null> {
    const row = await this.prisma.careerProfile.findFirst({
      where: { slackUserId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, agentRunId: true, profileJson: true, createdAt: true },
    });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      agentRunId: row.agentRunId,
      profileJson: row.profileJson as unknown as CareerProfileData,
      createdAt: row.createdAt,
    };
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm test career-profile.prisma.repository`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/career-mate/domain/port/career-profile.repository.port.ts src/agent/career-mate/infrastructure/career-profile.prisma.repository.ts src/agent/career-mate/infrastructure/career-profile.prisma.repository.spec.ts
git commit -m "feat(career-mate): CareerProfile 리포지토리 포트 + Prisma 구현"
```

---

## Task 6: 포매터 (Slack mrkdwn + Notion blocks)

**Files:**
- Create: `src/agent/career-mate/infrastructure/career-mate.formatter.ts`
- Test: `src/agent/career-mate/infrastructure/career-mate.formatter.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/agent/career-mate/infrastructure/career-mate.formatter.spec.ts`:
```typescript
import { CareerProfileData } from '../domain/career-mate.type';
import {
  buildPortfolioBlocks,
  formatPortfolioLink,
  formatProfileSummary,
  formatResume,
  formatUnknownCareerMate,
} from './career-mate.formatter';

const DATA: CareerProfileData = {
  summary: '백엔드 5년차',
  skills: [
    {
      name: 'NestJS',
      category: 'FRAMEWORK',
      proficiency: 'EXPERT',
      evidence: [{ repo: 'o/r', pr: 1, url: 'https://x/1' }],
    },
  ],
  accomplishments: [
    {
      title: '큐 락 안정화',
      bullet: 'BullMQ lockDuration 재설계로 stalled 0',
      star: { situation: 's', task: 't', action: 'a', result: 'r' },
      techTags: ['BullMQ'],
      evidence: [{ repo: 'o/r', pr: 1, url: 'https://x/1', mergedAt: '2026-06-01' }],
    },
  ],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

describe('career-mate.formatter', () => {
  it('formatProfileSummary 는 스킬/성과 수를 포함한다', () => {
    const text = formatProfileSummary(DATA);
    expect(text).toContain('스킬 1');
    expect(text).toContain('성과 1');
  });

  it('formatResume 는 bullet 을 포함한다', () => {
    expect(formatResume(DATA)).toContain('BullMQ lockDuration 재설계');
  });

  it('formatPortfolioLink 는 url 을 포함한다', () => {
    expect(formatPortfolioLink({ url: 'https://notion/abc' })).toContain(
      'https://notion/abc',
    );
  });

  it('buildPortfolioBlocks 는 heading 과 bullet 블록을 만든다', () => {
    const blocks = buildPortfolioBlocks(DATA);
    expect(blocks.some((b) => b.type === 'heading')).toBe(true);
    expect(blocks.some((b) => b.type === 'bullet')).toBe(true);
  });

  it('formatUnknownCareerMate 는 사용법을 안내한다', () => {
    expect(formatUnknownCareerMate()).toContain('프로필');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test career-mate.formatter`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현 작성**

`src/agent/career-mate/infrastructure/career-mate.formatter.ts`:
```typescript
import { NotionPlanBlock } from '../../../notion/domain/port/notion-client.port';
import { CareerProfileData } from '../domain/career-mate.type';

export const formatProfileSummary = (data: CareerProfileData): string => {
  const top = data.accomplishments
    .slice(0, 3)
    .map((a) => `• ${a.bullet}`)
    .join('\n');
  return [
    `*역량 프로필 갱신 완료* ✅`,
    `스킬 ${data.skills.length} · 성과 ${data.accomplishments.length} · 증거 PR ${data.meta.prCount}건`,
    ``,
    data.summary,
    top ? `\n*상위 성과*\n${top}` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

export const formatResume = (data: CareerProfileData): string => {
  const bullets = data.accomplishments
    .map((a) => `• ${a.bullet}`)
    .join('\n');
  const skills = data.skills.map((s) => s.name).join(', ');
  return [
    `*이력서 — 성과*`,
    bullets || '(성과 없음)',
    ``,
    `*기술 스택*`,
    skills || '(스킬 없음)',
  ].join('\n');
};

export const formatPortfolioLink = ({ url }: { url: string }): string =>
  `*포트폴리오 페이지 갱신 완료* ✅\n${url}`;

export const formatUnknownCareerMate = (): string =>
  '무엇을 도와드릴까요? "프로필 정리해줘" / "이력서 뽑아줘" / "포트폴리오 정리" 중에 말씀해주세요.';

export const buildPortfolioBlocks = (
  data: CareerProfileData,
): NotionPlanBlock[] => {
  const blocks: NotionPlanBlock[] = [
    { type: 'heading', text: '역량 요약' },
    { type: 'paragraph', text: data.summary },
    { type: 'divider' },
    { type: 'heading', text: '핵심 성과' },
  ];
  for (const a of data.accomplishments) {
    blocks.push({ type: 'subheading', text: a.title });
    blocks.push({ type: 'bullet', text: a.bullet });
    for (const e of a.evidence) {
      blocks.push({
        type: 'bullet',
        text: `근거: ${e.repo}#${e.pr}`,
        link: e.url,
      });
    }
  }
  blocks.push({ type: 'divider' });
  blocks.push({ type: 'heading', text: '기술 스택' });
  for (const s of data.skills) {
    blocks.push({
      type: 'bullet',
      text: `${s.name} (${s.category} · ${s.proficiency})`,
    });
  }
  return blocks;
};
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test career-mate.formatter`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/infrastructure/career-mate.formatter.ts src/agent/career-mate/infrastructure/career-mate.formatter.spec.ts
git commit -m "feat(career-mate): Slack/Notion 포매터 추가"
```

---

## Task 7: BuildCareerProfileUsecase

**Files:**
- Create: `src/agent/career-mate/application/build-career-profile.usecase.ts`
- Test: `src/agent/career-mate/application/build-career-profile.usecase.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/agent/career-mate/application/build-career-profile.usecase.spec.ts`:
```typescript
import { CareerMateException } from '../domain/career-mate.exception';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

const PR = {
  number: 1,
  title: '큐 락 수정',
  body: 'lockDuration',
  repo: 'o/r',
  url: 'https://x/1',
  state: 'merged' as const,
  mergedAt: '2026-06-01',
  updatedAt: '2026-06-01',
  additions: 10,
  deletions: 2,
  changedFilesCount: 3,
};

const PROFILE_JSON = JSON.stringify({
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
});

const makeDeps = (prs: unknown[]) => {
  const githubClient = {
    listAuthorMergedPullRequestsSince: jest.fn().mockResolvedValue(prs),
  };
  const modelRouter = {
    route: jest
      .fn()
      .mockResolvedValue({ text: PROFILE_JSON, modelUsed: 'claude-cli', provider: 'CLAUDE' }),
  };
  const repository = { save: jest.fn().mockResolvedValue({ id: 7 }), findLatestBySlackUser: jest.fn() };
  const agentRunService = {
    execute: jest.fn(async ({ run }: { run: (c: { agentRunId: number }) => Promise<{ result: unknown; modelUsed: string; output: unknown }> }) => {
      const r = await run({ agentRunId: 99 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 99 };
    }),
  };
  const config = { get: jest.fn().mockReturnValue('octo') };
  return { githubClient, modelRouter, repository, agentRunService, config };
};

describe('BuildCareerProfileUsecase', () => {
  it('PR 을 합성해 프로필을 저장하고 outcome 을 반환한다', async () => {
    const d = makeDeps([PR]);
    const usecase = new BuildCareerProfileUsecase(
      d.githubClient as never,
      d.modelRouter as never,
      d.repository as never,
      d.agentRunService as never,
      d.config as never,
    );

    const outcome = await usecase.execute({ slackUserId: 'U1' });

    expect(outcome.agentRunId).toBe(99);
    expect(d.repository.save).toHaveBeenCalledTimes(1);
    expect(d.repository.save.mock.calls[0][0].agentRunId).toBe(99);
    expect(d.repository.save.mock.calls[0][0].prCount).toBe(1);
  });

  it('merged PR 이 없으면 NO_EVIDENCE 예외', async () => {
    const d = makeDeps([]);
    const usecase = new BuildCareerProfileUsecase(
      d.githubClient as never,
      d.modelRouter as never,
      d.repository as never,
      d.agentRunService as never,
      d.config as never,
    );
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toBeInstanceOf(
      CareerMateException,
    );
  });

  it('GITHUB_OWNER_LOGIN 미설정 시 CONFIG_MISSING 예외', async () => {
    const d = makeDeps([PR]);
    d.config.get = jest.fn().mockReturnValue(undefined);
    const usecase = new BuildCareerProfileUsecase(
      d.githubClient as never,
      d.modelRouter as never,
      d.repository as never,
      d.agentRunService as never,
      d.config as never,
    );
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toBeInstanceOf(
      CareerMateException,
    );
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test build-career-profile.usecase`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현 작성**

`src/agent/career-mate/application/build-career-profile.usecase.ts`:
```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { AgentRunOutcome } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CareerMateException } from '../domain/career-mate.exception';
import { CareerMateErrorCode } from '../domain/career-mate-error-code.enum';
import {
  BuildCareerProfileInput,
  CareerProfileData,
} from '../domain/career-mate.type';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  buildSynthPrompt,
  CAREER_PROFILE_SYNTH_SYSTEM_PROMPT,
  parseCareerProfileOutput,
} from '../domain/prompt/career-profile-synth.prompt';

const DEFAULT_WINDOW_MONTHS = 12;
const PR_LIMIT = 100;

@Injectable()
export class BuildCareerProfileUsecase {
  private readonly logger = new Logger(BuildCareerProfileUsecase.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly agentRunService: AgentRunService,
    private readonly config: ConfigService,
  ) {}

  async execute({
    slackUserId,
    windowMonths = DEFAULT_WINDOW_MONTHS,
  }: BuildCareerProfileInput): Promise<AgentRunOutcome<CareerProfileData>> {
    const githubLogin = this.config.get<string>('GITHUB_OWNER_LOGIN');
    if (!githubLogin) {
      throw new CareerMateException({
        code: CareerMateErrorCode.CONFIG_MISSING,
        message:
          'GITHUB_OWNER_LOGIN 이 설정되지 않았습니다 (.env 확인). 프로필을 만들 수 없습니다.',
        status: DomainStatus.INTERNAL,
      });
    }

    const since = new Date();
    since.setMonth(since.getMonth() - windowMonths);
    const sinceIsoDate = since.toISOString().slice(0, 10);

    const prs = await this.githubClient.listAuthorMergedPullRequestsSince({
      repo: null,
      author: githubLogin,
      sinceIsoDate,
      limit: PR_LIMIT,
    });
    if (prs.length === 0) {
      throw new CareerMateException({
        code: CareerMateErrorCode.NO_EVIDENCE,
        message: `최근 ${windowMonths}개월 내 merged PR 이 없습니다 — 기간을 늘려 다시 요청하세요.`,
        status: DomainStatus.NOT_FOUND,
      });
    }

    return this.agentRunService.execute<CareerProfileData>({
      agentType: AgentType.CAREER_MATE,
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
      inputSnapshot: { slackUserId, windowMonths, sinceIsoDate, prCount: prs.length },
      run: async (context) => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.CAREER_MATE,
          request: {
            prompt: buildSynthPrompt(prs),
            systemPrompt: CAREER_PROFILE_SYNTH_SYSTEM_PROMPT,
          },
        });
        const data = parseCareerProfileOutput(completion.text);
        data.meta = {
          githubLogin,
          windowStart: sinceIsoDate,
          prCount: prs.length,
        };
        await this.repository.save({
          agentRunId: context.agentRunId,
          slackUserId,
          githubLogin,
          windowStart: sinceIsoDate,
          prCount: prs.length,
          summary: data.summary,
          profileJson: data,
        });
        this.logger.log(
          `CAREER_MATE 프로필 합성 완료 — PR ${prs.length}건, 스킬 ${data.skills.length}, 성과 ${data.accomplishments.length}`,
        );
        return { result: data, modelUsed: completion.modelUsed, output: data };
      },
    });
  }
}
```

> 참고: `AgentRunOutcome` 와 `AgentRunService` 는 같은 파일(`src/agent-run/application/agent-run.service.ts`)에서 export 됨. `evidence` 는 선택 인자라 생략(NO_EVIDENCE 가드가 사전 차단).

- [ ] **Step 4: 통과 확인**

Run: `pnpm test build-career-profile.usecase`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/application/build-career-profile.usecase.ts src/agent/career-mate/application/build-career-profile.usecase.spec.ts
git commit -m "feat(career-mate): BuildCareerProfileUsecase 추가"
```

---

## Task 8: RenderResumeUsecase (없으면 자동 Build)

**Files:**
- Create: `src/agent/career-mate/application/render-resume.usecase.ts`
- Test: `src/agent/career-mate/application/render-resume.usecase.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/agent/career-mate/application/render-resume.usecase.spec.ts`:
```typescript
import { CareerProfileData } from '../domain/career-mate.type';
import { RenderResumeUsecase } from './render-resume.usecase';

const PROFILE: CareerProfileData = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

describe('RenderResumeUsecase', () => {
  it('프로필이 있으면 그대로 반환한다 (Build 미호출)', async () => {
    const repository = {
      findLatestBySlackUser: jest
        .fn()
        .mockResolvedValue({ id: 1, agentRunId: 5, profileJson: PROFILE, createdAt: new Date() }),
    };
    const buildProfile = { execute: jest.fn() };
    const usecase = new RenderResumeUsecase(
      repository as never,
      buildProfile as never,
    );

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(result.profile).toEqual(PROFILE);
    expect(result.agentRunId).toBe(5);
    expect(buildProfile.execute).not.toHaveBeenCalled();
  });

  it('프로필이 없으면 자동 Build 후 반환한다', async () => {
    const repository = { findLatestBySlackUser: jest.fn().mockResolvedValue(null) };
    const buildProfile = {
      execute: jest
        .fn()
        .mockResolvedValue({ result: PROFILE, modelUsed: 'claude-cli', agentRunId: 88 }),
    };
    const usecase = new RenderResumeUsecase(
      repository as never,
      buildProfile as never,
    );

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(buildProfile.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    expect(result.agentRunId).toBe(88);
    expect(result.profile).toEqual(PROFILE);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test render-resume.usecase`
Expected: FAIL.

- [ ] **Step 3: 구현 작성**

`src/agent/career-mate/application/render-resume.usecase.ts`:
```typescript
import { Inject, Injectable } from '@nestjs/common';

import { RenderResumeInput, RenderResumeResult } from '../domain/career-mate.type';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

@Injectable()
export class RenderResumeUsecase {
  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly buildProfile: BuildCareerProfileUsecase,
  ) {}

  async execute({ slackUserId }: RenderResumeInput): Promise<RenderResumeResult> {
    const latest = await this.repository.findLatestBySlackUser(slackUserId);
    if (latest) {
      return { profile: latest.profileJson, agentRunId: latest.agentRunId ?? 0 };
    }
    const built = await this.buildProfile.execute({ slackUserId });
    return { profile: built.result, agentRunId: built.agentRunId };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test render-resume.usecase`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/application/render-resume.usecase.ts src/agent/career-mate/application/render-resume.usecase.spec.ts
git commit -m "feat(career-mate): RenderResumeUsecase 추가 (없으면 자동 Build)"
```

---

## Task 9: RenderPortfolioUsecase (Notion 미러, 없으면 자동 Build)

**Files:**
- Create: `src/agent/career-mate/application/render-portfolio.usecase.ts`
- Test: `src/agent/career-mate/application/render-portfolio.usecase.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/agent/career-mate/application/render-portfolio.usecase.spec.ts`:
```typescript
import { CareerMateException } from '../domain/career-mate.exception';
import { CareerProfileData } from '../domain/career-mate.type';
import { RenderPortfolioUsecase } from './render-portfolio.usecase';

const PROFILE: CareerProfileData = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

const makeDeps = (latest: unknown) => {
  const repository = { findLatestBySlackUser: jest.fn().mockResolvedValue(latest) };
  const buildProfile = {
    execute: jest
      .fn()
      .mockResolvedValue({ result: PROFILE, modelUsed: 'claude-cli', agentRunId: 88 }),
  };
  const notionClient = {
    findOrCreateChildPage: jest
      .fn()
      .mockResolvedValue({ pageId: 'p1', url: 'https://notion/p1' }),
    appendBlocks: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn().mockReturnValue('PARENT_PAGE') };
  return { repository, buildProfile, notionClient, config };
};

describe('RenderPortfolioUsecase', () => {
  it('프로필을 Notion 자식 페이지에 미러링하고 url 을 반환한다', async () => {
    const d = makeDeps({ id: 1, agentRunId: 5, profileJson: PROFILE, createdAt: new Date() });
    const usecase = new RenderPortfolioUsecase(
      d.repository as never,
      d.buildProfile as never,
      d.notionClient as never,
      d.config as never,
    );

    const result = await usecase.execute({ slackUserId: 'U1' });

    expect(d.notionClient.findOrCreateChildPage).toHaveBeenCalledTimes(1);
    expect(d.notionClient.appendBlocks).toHaveBeenCalledTimes(1);
    expect(result.url).toBe('https://notion/p1');
    expect(result.agentRunId).toBe(5);
  });

  it('CAREER_PORTFOLIO_NOTION_PAGE_ID 미설정 시 CONFIG_MISSING', async () => {
    const d = makeDeps({ id: 1, agentRunId: 5, profileJson: PROFILE, createdAt: new Date() });
    d.config.get = jest.fn().mockReturnValue(undefined);
    const usecase = new RenderPortfolioUsecase(
      d.repository as never,
      d.buildProfile as never,
      d.notionClient as never,
      d.config as never,
    );
    await expect(usecase.execute({ slackUserId: 'U1' })).rejects.toBeInstanceOf(
      CareerMateException,
    );
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test render-portfolio.usecase`
Expected: FAIL.

- [ ] **Step 3: 구현 작성**

`src/agent/career-mate/application/render-portfolio.usecase.ts`:
```typescript
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../../../notion/domain/port/notion-client.port';
import { CareerMateException } from '../domain/career-mate.exception';
import { CareerMateErrorCode } from '../domain/career-mate-error-code.enum';
import {
  CareerProfileData,
  RenderPortfolioInput,
  RenderPortfolioResult,
} from '../domain/career-mate.type';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import { buildPortfolioBlocks } from '../infrastructure/career-mate.formatter';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

@Injectable()
export class RenderPortfolioUsecase {
  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly buildProfile: BuildCareerProfileUsecase,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly config: ConfigService,
  ) {}

  async execute({
    slackUserId,
  }: RenderPortfolioInput): Promise<RenderPortfolioResult> {
    const parentPageId = this.config.get<string>(
      'CAREER_PORTFOLIO_NOTION_PAGE_ID',
    );
    if (!parentPageId) {
      throw new CareerMateException({
        code: CareerMateErrorCode.CONFIG_MISSING,
        message:
          'CAREER_PORTFOLIO_NOTION_PAGE_ID 가 설정되지 않았습니다 (.env 확인).',
        status: DomainStatus.INTERNAL,
      });
    }

    const latest = await this.repository.findLatestBySlackUser(slackUserId);
    let profile: CareerProfileData;
    let agentRunId: number;
    if (latest) {
      profile = latest.profileJson;
      agentRunId = latest.agentRunId ?? 0;
    } else {
      const built = await this.buildProfile.execute({ slackUserId });
      profile = built.result;
      agentRunId = built.agentRunId;
    }

    const page = await this.notionClient.findOrCreateChildPage({
      parentPageId,
      title: `포트폴리오 — ${profile.meta.windowStart}~`,
    });
    await this.notionClient.appendBlocks({
      pageId: page.pageId,
      blocks: buildPortfolioBlocks(profile),
    });

    return { url: page.url, pageId: page.pageId, agentRunId };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test render-portfolio.usecase`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/application/render-portfolio.usecase.ts src/agent/career-mate/application/render-portfolio.usecase.spec.ts
git commit -m "feat(career-mate): RenderPortfolioUsecase 추가 (Notion 미러)"
```

---

## Task 10: 디스패처 (하이브리드 폼)

**Files:**
- Create: `src/agent/career-mate/infrastructure/career-mate.dispatcher.ts`
- Test: `src/agent/career-mate/infrastructure/career-mate.dispatcher.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/agent/career-mate/infrastructure/career-mate.dispatcher.spec.ts`:
```typescript
import { CareerMateDispatcher } from './career-mate.dispatcher';

const PROFILE = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 1 },
};

const makeDispatcher = (intentText: string) => {
  const modelRouter = {
    route: jest
      .fn()
      .mockResolvedValue({ text: intentText, modelUsed: 'claude-cli', provider: 'CLAUDE' }),
  };
  const buildProfile = {
    execute: jest
      .fn()
      .mockResolvedValue({ result: PROFILE, modelUsed: 'claude-cli', agentRunId: 1 }),
  };
  const renderResume = {
    execute: jest.fn().mockResolvedValue({ profile: PROFILE, agentRunId: 2 }),
  };
  const renderPortfolio = {
    execute: jest
      .fn()
      .mockResolvedValue({ url: 'https://notion/x', pageId: 'x', agentRunId: 3 }),
  };
  const dispatcher = new CareerMateDispatcher(
    modelRouter as never,
    buildProfile as never,
    renderResume as never,
    renderPortfolio as never,
  );
  return { dispatcher, buildProfile, renderResume, renderPortfolio };
};

describe('CareerMateDispatcher', () => {
  it('BUILD_PROFILE 의도면 buildProfile 을 호출한다', async () => {
    const d = makeDispatcher('{"action":"BUILD_PROFILE"}');
    const outcome = await d.dispatcher.dispatch({ slackUserId: 'U1', text: '프로필 정리' } as never);
    expect(d.buildProfile.execute).toHaveBeenCalledTimes(1);
    expect(outcome.agentRunId).toBe(1);
  });

  it('RENDER_RESUME 의도면 renderResume 을 호출한다', async () => {
    const d = makeDispatcher('{"action":"RENDER_RESUME"}');
    await d.dispatcher.dispatch({ slackUserId: 'U1', text: '이력서' } as never);
    expect(d.renderResume.execute).toHaveBeenCalledTimes(1);
  });

  it('RENDER_PORTFOLIO 의도면 renderPortfolio 를 호출한다', async () => {
    const d = makeDispatcher('{"action":"RENDER_PORTFOLIO"}');
    const outcome = await d.dispatcher.dispatch({ slackUserId: 'U1', text: '포트폴리오' } as never);
    expect(d.renderPortfolio.execute).toHaveBeenCalledTimes(1);
    expect(outcome.formattedText).toContain('https://notion/x');
  });

  it('UNKNOWN 이면 안내 문구를 반환한다', async () => {
    const d = makeDispatcher('{"action":"UNKNOWN"}');
    const outcome = await d.dispatcher.dispatch({ slackUserId: 'U1', text: '?' } as never);
    expect(d.buildProfile.execute).not.toHaveBeenCalled();
    expect(outcome.formattedText).toContain('프로필');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test career-mate.dispatcher`
Expected: FAIL.

- [ ] **Step 3: 구현 작성**

`src/agent/career-mate/infrastructure/career-mate.dispatcher.ts`:
```typescript
import { Injectable } from '@nestjs/common';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import {
  CAREER_MATE_INTENT_SYSTEM_PROMPT,
  parseCareerMateIntent,
} from '../domain/prompt/career-mate-intent.prompt';
import { BuildCareerProfileUsecase } from '../application/build-career-profile.usecase';
import { RenderPortfolioUsecase } from '../application/render-portfolio.usecase';
import { RenderResumeUsecase } from '../application/render-resume.usecase';
import {
  formatPortfolioLink,
  formatProfileSummary,
  formatResume,
  formatUnknownCareerMate,
} from './career-mate.formatter';

@Injectable()
export class CareerMateDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.CAREER_MATE;

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly buildProfile: BuildCareerProfileUsecase,
    private readonly renderResume: RenderResumeUsecase,
    private readonly renderPortfolio: RenderPortfolioUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const slackUserId = input.slackUserId;
    const completion = await this.modelRouter.route({
      agentType: AgentType.CAREER_MATE,
      request: {
        prompt: input.text ?? '',
        systemPrompt: CAREER_MATE_INTENT_SYSTEM_PROMPT,
      },
    });
    const intent = parseCareerMateIntent(completion.text);

    switch (intent.action) {
      case 'BUILD_PROFILE': {
        const outcome = await this.buildProfile.execute({
          slackUserId,
          windowMonths: intent.windowMonths,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          outcome.modelUsed,
          formatProfileSummary(outcome.result),
        );
      }
      case 'RENDER_RESUME': {
        const result = await this.renderResume.execute({ slackUserId });
        return this.toOutcome(
          result.agentRunId,
          result.profile,
          'deterministic',
          formatResume(result.profile),
        );
      }
      case 'RENDER_PORTFOLIO': {
        const result = await this.renderPortfolio.execute({ slackUserId });
        return this.toOutcome(
          result.agentRunId,
          result,
          'deterministic',
          formatPortfolioLink({ url: result.url }),
        );
      }
      default:
        return this.toOutcome(
          0,
          { action: 'UNKNOWN' },
          'deterministic',
          formatUnknownCareerMate(),
        );
    }
  }

  private toOutcome(
    agentRunId: number,
    output: unknown,
    modelUsed: string,
    formattedText: string,
  ): DispatchOutcome {
    return { agentRunId, output, modelUsed, formattedText };
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test career-mate.dispatcher`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/infrastructure/career-mate.dispatcher.ts src/agent/career-mate/infrastructure/career-mate.dispatcher.spec.ts
git commit -m "feat(career-mate): CareerMateDispatcher 추가 (하이브리드 폼)"
```

---

## Task 11: 모듈 와이어링

**Files:**
- Create: `src/agent/career-mate/career-mate.module.ts`

- [ ] **Step 1: 모듈 작성**

> `GithubModule`/`NotionModule` 은 PM 에이전트가 이미 import 하는 모듈로, `GITHUB_CLIENT_PORT`/`NOTION_CLIENT_PORT` 토큰을 export 한다. 실제 파일명을 `Glob src/github/*.module.ts` `Glob src/notion/*.module.ts` 로 확인하고 import 경로를 맞춘다(아래는 표준 이름 가정).

`src/agent/career-mate/career-mate.module.ts`:
```typescript
import { Module } from '@nestjs/common';

import { AgentRunModule } from '../../agent-run/agent-run.module';
import { GithubModule } from '../../github/github.module';
import { ModelRouterModule } from '../../model-router/model-router.module';
import { NotionModule } from '../../notion/notion.module';
import { BuildCareerProfileUsecase } from './application/build-career-profile.usecase';
import { RenderPortfolioUsecase } from './application/render-portfolio.usecase';
import { RenderResumeUsecase } from './application/render-resume.usecase';
import { CAREER_PROFILE_REPOSITORY_PORT } from './domain/port/career-profile.repository.port';
import { CareerMateDispatcher } from './infrastructure/career-mate.dispatcher';
import { CareerProfilePrismaRepository } from './infrastructure/career-profile.prisma.repository';

// PrismaModule(@Global) / ConfigModule(isGlobal) 은 별도 import 불필요.
@Module({
  imports: [AgentRunModule, ModelRouterModule, GithubModule, NotionModule],
  providers: [
    {
      provide: CAREER_PROFILE_REPOSITORY_PORT,
      useClass: CareerProfilePrismaRepository,
    },
    BuildCareerProfileUsecase,
    RenderResumeUsecase,
    RenderPortfolioUsecase,
    CareerMateDispatcher,
  ],
  exports: [
    BuildCareerProfileUsecase,
    RenderResumeUsecase,
    RenderPortfolioUsecase,
    CareerMateDispatcher,
  ],
})
export class CareerMateModule {}
```

- [ ] **Step 2: 빌드 확인 (아직 AgentType 미정의라 다음 Task 와 함께 통과)**

Run: `pnpm build`
Expected: `AgentType.CAREER_MATE` 미정의로 **실패할 수 있음** → Task 12 에서 enum 추가 후 통과. (이 시점 실패는 정상.)

- [ ] **Step 3: Commit**

```bash
git add src/agent/career-mate/career-mate.module.ts
git commit -m "feat(career-mate): CareerMateModule 와이어링"
```

---

## Task 12: enum 등록 (AgentType · TriggerType · ResponseCode · AGENT_TO_PROVIDER)

**Files:**
- Modify: `src/model-router/domain/model-router.type.ts`
- Modify: `src/agent-run/domain/agent-run.type.ts`
- Modify: `src/common/exception/response-code.enum.ts`
- Modify: `src/model-router/application/model-router.usecase.ts`

- [ ] **Step 1: AgentType 추가**

`src/model-router/domain/model-router.type.ts` 의 `AgentType` enum 에서 `BLOG = 'BLOG',` 아래에 추가:
```typescript
  BLOG = 'BLOG',
  CAREER_MATE = 'CAREER_MATE',
}
```

- [ ] **Step 2: TriggerType 추가**

`src/agent-run/domain/agent-run.type.ts` 의 `TriggerType` enum 에서 `SLACK_MENTION_BLOG = 'SLACK_MENTION_BLOG',` 아래에 추가:
```typescript
  SLACK_MENTION_BLOG = 'SLACK_MENTION_BLOG',
  SLACK_MENTION_CAREER_MATE = 'SLACK_MENTION_CAREER_MATE',
}
```

- [ ] **Step 3: ResponseCode 추가**

`src/common/exception/response-code.enum.ts` 의 BLOG 블록(`BLOG_NOTION_URL_NOT_FOUND = ...`) 아래에 추가:
```typescript
  BLOG_NOTION_URL_NOT_FOUND = 'BLOG_NOTION_URL_NOT_FOUND',

  // Career Mate — CareerMateErrorCode 와 1:1 동기화
  CAREER_MATE_NL_PARSE_FAILED = 'CAREER_MATE_NL_PARSE_FAILED',
  CAREER_MATE_NO_EVIDENCE = 'CAREER_MATE_NO_EVIDENCE',
  CAREER_MATE_INVALID_MODEL_OUTPUT = 'CAREER_MATE_INVALID_MODEL_OUTPUT',
  CAREER_MATE_CONFIG_MISSING = 'CAREER_MATE_CONFIG_MISSING',
}
```

- [ ] **Step 4: AGENT_TO_PROVIDER 추가**

`src/model-router/application/model-router.usecase.ts` 의 `AGENT_TO_PROVIDER` Record 에서 `[AgentType.BLOG]: ModelProviderName.CLAUDE,` 아래에 추가:
```typescript
  [AgentType.BLOG]: ModelProviderName.CLAUDE,
  // CAREER_MATE — merged PR → 역량 프로필 구조 합성. 구조화 JSON 강점 → Claude.
  [AgentType.CAREER_MATE]: ModelProviderName.CLAUDE,
};
```

- [ ] **Step 5: 빌드 + 전체 테스트**

Run: `pnpm build && pnpm test`
Expected: 성공 (Record exhaustive 충족, 모듈 컴파일).

- [ ] **Step 6: Commit**

```bash
git add src/model-router/domain/model-router.type.ts src/agent-run/domain/agent-run.type.ts src/common/exception/response-code.enum.ts src/model-router/application/model-router.usecase.ts
git commit -m "feat(career-mate): AgentType/TriggerType/ResponseCode/AGENT_TO_PROVIDER 등록"
```

---

## Task 13: 라우터·분류기·레지스트리·retry-run 등록

**Files:**
- Modify: `src/router/router.module.ts`
- Modify: `src/router/domain/prompt/intent-classifier-system.prompt.ts`
- Modify: `src/agent-registry/agent-registry.ts`
- Modify: `src/slack/handler/retry-run.handler.ts`

- [ ] **Step 1: RouterModule import + inject**

`src/router/router.module.ts` 상단 import 에 추가:
```typescript
import { CareerMateModule } from '../agent/career-mate/career-mate.module';
import { CareerMateDispatcher } from '../agent/career-mate/infrastructure/career-mate.dispatcher';
```
`@Module({ imports: [...] })` 배열의 `BlogModule,` 뒤에 추가:
```typescript
    BlogModule,
    CareerMateModule,
```
`AGENT_DISPATCHER_PORT` 의 `inject` 배열에서 `BlogDispatcher,` 아래에 추가:
```typescript
        BlogDispatcher,
        CareerMateDispatcher,
      ],
```

- [ ] **Step 2: IntentClassifier 분류 후보 추가**

`src/router/domain/prompt/intent-classifier-system.prompt.ts` 의 BLOG 줄 아래에 추가:
```typescript
- BLOG: 블로그/회고 글 초안 작성 ("이거 블로그로 써줘", "방금 작업 회고 블로그 써줘", "React 서버컴포넌트 블로그 초안", "티스토리 글 써줘")
- CAREER_MATE: 이직용 역량 프로필/이력서/포트폴리오 ("프로필 정리해줘", "내 역량 정리", "이력서 성과 뽑아줘", "포트폴리오 페이지 만들어줘")
```

- [ ] **Step 3: AgentRegistry 엔트리 추가**

`src/agent-registry/agent-registry.ts` 의 BLOG 엔트리 객체 아래(배열 닫기 `];` 직전)에 추가:
```typescript
  {
    agentType: AgentType.CAREER_MATE,
    displayName: 'Career Mate',
    slashCommands: [],
    usecasePath:
      'src/agent/career-mate/application/build-career-profile.usecase.ts',
    description:
      '이직용 역량 프로필 허브 + 이력서/포트폴리오 (merged PR 합성, 자연어 멘션)',
  },
```

- [ ] **Step 4: retry-run case 추가 (BLOG 식 재멘션 안내)**

`src/slack/handler/retry-run.handler.ts` 의 `case 'BLOG': { ... return; }` 블록 아래에 추가:
```typescript
        case 'CAREER_MATE': {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `AgentRun #${id} (CAREER_MATE) 은 retry-run 대신 자연어로 다시 요청해주세요 (예: "@이대리 프로필 다시 정리해줘").`,
          });
          return;
        }
```

- [ ] **Step 5: 빌드 + 전체 테스트 (agent-registry.spec 망라 검증 포함)**

Run: `pnpm build && pnpm test`
Expected: 성공. `agent-registry.spec` 가 CAREER_MATE 엔트리의 usecasePath 실재 + AgentType 망라를 검증해 통과.

- [ ] **Step 6: Commit**

```bash
git add src/router/router.module.ts src/router/domain/prompt/intent-classifier-system.prompt.ts src/agent-registry/agent-registry.ts src/slack/handler/retry-run.handler.ts
git commit -m "feat(career-mate): 라우터/분류기/레지스트리/retry-run 등록"
```

---

## Task 14: env 등록 (4곳 동기)

**Files:**
- Modify: `src/config/app.config.ts`
- Modify: `.env.example`
- Modify: `.env`
- Modify: `README.md`

- [ ] **Step 1: app.config.ts 검증 선언 추가**

`src/config/app.config.ts` 의 `CAREER_LOG_NOTION_PAGE_ID?: string;` 아래에 추가:
```typescript
  // Career Mate — 포트폴리오 미러용 Notion 부모 페이지 id (RenderPortfolio 의 자식 페이지 생성 대상).
  @IsOptional()
  @IsString()
  CAREER_PORTFOLIO_NOTION_PAGE_ID?: string;

  // Career Mate — merged PR 조회 대상 owner 의 GitHub login. 1인 봇 단일 사용자 전제.
  @IsOptional()
  @IsString()
  GITHUB_OWNER_LOGIN?: string;
```

> `pnpm build` 후 `grep -n "GITHUB_OWNER_LOGIN\|GITHUB.*LOGIN\|owner" src/config/app.config.ts` 로 동일 목적의 기존 env 가 있으면 중복 추가하지 말고 그것을 BuildProfile 의 `config.get` 키로 교체한다.

- [ ] **Step 2: .env.example 추가**

`.env.example` 끝에 추가:
```
# Career Mate (이직 메이트)
CAREER_PORTFOLIO_NOTION_PAGE_ID=
GITHUB_OWNER_LOGIN=
```

- [ ] **Step 3: .env 추가 (로컬 실값)**

`.env` 끝에 추가 (owner 가 실제 값 주입):
```
CAREER_PORTFOLIO_NOTION_PAGE_ID=
GITHUB_OWNER_LOGIN=
```

- [ ] **Step 4: README env 표에 두 줄 추가**

`README.md` 의 env 표에 `CAREER_PORTFOLIO_NOTION_PAGE_ID`(포트폴리오 Notion 부모 페이지), `GITHUB_OWNER_LOGIN`(PR 조회 대상 GitHub login) 행 추가.

- [ ] **Step 5: 빌드 확인**

Run: `pnpm build`
Expected: 성공.

- [ ] **Step 6: Commit**

```bash
git add src/config/app.config.ts .env.example README.md
git commit -m "feat(career-mate): CAREER_PORTFOLIO_NOTION_PAGE_ID/GITHUB_OWNER_LOGIN env 추가"
```
> `.env` 는 커밋 금지 (gitignore). 스테이징하지 말 것.

---

## Task 15: 최종 검증 (3중 green)

- [ ] **Step 1: lint**

Run: `pnpm lint:check`
Expected: exit 0.

- [ ] **Step 2: test**

Run: `pnpm test`
Expected: exit 0 (career-mate 단위 전부 + agent-registry/AGENT_TO_PROVIDER 망라 통과).

- [ ] **Step 3: build**

Run: `pnpm build`
Expected: exit 0.

- [ ] **Step 4: 실패 시**

3개 중 하나라도 비-0 이면 해당 Task 로 돌아가 수정 후 재실행. 임의 우회/스킵 금지.

- [ ] **Step 5: (owner 수동) Slack E2E**

owner 가 Slack 에서 `@이대리 프로필 정리해줘` → 프로필 요약, `이력서 뽑아줘` → STAR bullet, `포트폴리오 정리` → Notion URL 확인. (실 LLM/GitHub/Notion 호출이라 자동 테스트 범위 밖.)

---

## 자기 점검 (작성자 체크 결과)

- **스펙 커버리지**: §3 골격→Task 10/11, §4 소스→Task 7, §5 도메인/영속→Task 1·2·5, §6 컴포넌트→Task 2~11, §7 흐름→Task 7·8·9·10, §8 등록 9단계→Task 12·13·14, §9 에러→Task 2(코드)+각 usecase, §10 테스트→각 Task TDD + Task 15. ✅
- **스펙 deviation (명시)**: §6 의 슬래시 3종 병행 → Phase 1 은 멘션 전용(`slashCommands: []`). §8 의 retry→rebuild → BLOG 식 재멘션 안내. 둘 다 상단 "의도적 단순화"에 기재.
- **타입 일관성**: `CareerProfileData`/`CareerMateAction`/`RenderResumeResult`/`RenderPortfolioResult`/`CareerProfileRepositoryPort.{save,findLatestBySlackUser}`/`buildSynthPrompt`/`parseCareerProfileOutput`/`parseCareerMateIntent`/formatter 함수명 — Task 간 호출부와 정의부 일치 확인. ✅
- **placeholder**: 없음. (env 중복 확인·모듈명 확인은 grep 지시로 구체화.)
- **열린 항목**: `GITHUB_OWNER_LOGIN` 기존 동등 env 존재 시 재사용(Task 14 Step 1 grep 지시). `GithubModule`/`NotionModule` 실제 파일명 확인(Task 11 Step 1 glob 지시).
