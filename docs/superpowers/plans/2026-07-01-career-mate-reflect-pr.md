# CAREER_MATE `REFLECT_PR` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `CAREER_MATE`에 단일 PR 회고 액션 `REFLECT_PR`을 추가해, PR 하나를 읽어 STAR 회고를 만들고 이력서 프로필에 편입 + Notion 포트폴리오에 반영한다.

**Architecture:** 기존 CAREER_MATE 인프라(GitHub PR fetch·ProfileAccomplishment STAR 타입·CareerProfileRepository·RenderPortfolioUsecase·HumanizeService·AgentRunService)를 재사용한다. 신규 usecase `ReflectPrUsecase`가 fetch→LLM 합성→프로필 편입→humanize→save→포폴 append를 오케스트레이션하고, dispatcher 2차 intent에 `REFLECT_PR`을 추가한다. 1차 IntentClassifier 프롬프트를 교정해 오분류(PO_EVAL)를 없앤다.

**Tech Stack:** NestJS 10, TypeScript, Jest, Prisma 6 (스키마 변경 없음), pnpm@9.15.9.

## Global Constraints

- 패키지 매니저: `pnpm` 전용 (npm/yarn 금지).
- 검증 게이트: `pnpm lint:check && pnpm test && pnpm build` 3중 exit 0.
- `process.env` 직접 참조 금지 → `ConfigService.get(...)`.
- 커밋은 의미 단위 atomic, 한국어 OK, 형식 `<type>(<scope>): <subject>`. **사용자 명시 요청 전엔 push/PR 금지** (로컬 커밋은 각 Task 끝에서 수행).
- 변수명: 줄임말 금지(`error`/`found`/`repository`/`request`), `if` 단일라인도 중괄호, try-catch 안 `return await`.
- 신규 파일: kebab-case + role suffix, 각 소스에 `.spec.ts` 동반.
- 작업 위치: worktree `worktree-feat+career-mate-reflect-pr` (이미 생성됨, baseline 3중 green 확인 완료).
- DB 스키마 변경 없음. 신규 슬래시 커맨드 없음.

---

## File Structure

| 파일 | 책임 | 신규/수정 |
|---|---|---|
| `src/agent/career-mate/domain/career-mate.type.ts` | `REFLECT_PR` 액션 + `ReflectPrInput`/`ReflectPrResult`/`PrRetroSynth` 타입 | 수정 |
| `src/agent/career-mate/domain/career-mate-error-code.enum.ts` | `INVALID_PR_REFERENCE` | 수정 |
| `src/agent/career-mate/domain/extract-pr-reference.ts` | 자연어 문장에서 PR ref `{repo,number}` 추출 | 신규 |
| `src/agent/career-mate/domain/prompt/pr-retro-synth.prompt.ts` | 단일 PR→STAR 회고 시스템 프롬프트 + 프롬프트 빌더 + 파서 | 신규 |
| `src/agent/career-mate/application/merge-accomplishment.ts` | 프로필 편입(순수 함수): 최소 프로필 생성 / dedup append | 신규 |
| `src/agent/career-mate/application/reflect-pr.usecase.ts` | 오케스트레이션 (fetch→합성→편입→humanize→save→포폴) | 신규 |
| `src/agent/career-mate/infrastructure/career-mate.formatter.ts` | `formatPrRetro` | 수정 |
| `src/agent/career-mate/infrastructure/career-mate.dispatcher.ts` | `REFLECT_PR` case + DI | 수정 |
| `src/agent/career-mate/domain/prompt/career-mate-intent.prompt.ts` | 2차 intent `REFLECT_PR` | 수정 |
| `src/agent/career-mate/career-mate.module.ts` | provider/exports 등록 | 수정 |
| `src/router/domain/prompt/intent-classifier-system.prompt.ts` | 1차 라우팅 교정 | 수정 |

---

## Task 1: 타입 · 에러코드 · PR ref 추출 유틸

**Files:**
- Modify: `src/agent/career-mate/domain/career-mate.type.ts`
- Modify: `src/agent/career-mate/domain/career-mate-error-code.enum.ts`
- Create: `src/agent/career-mate/domain/extract-pr-reference.ts`
- Test: `src/agent/career-mate/domain/extract-pr-reference.spec.ts`

**Interfaces:**
- Produces:
  - `type CareerMateAction = ... | 'REFLECT_PR'`
  - `interface ParsedPrRef { repo: string; number: number }`
  - `extractPrReference(text: string): ParsedPrRef` (미검출 시 `CareerMateException(INVALID_PR_REFERENCE)`)
  - `interface ReflectPrInput { slackUserId: string; prText: string }`
  - `interface PrRetroAccomplishment` = 기존 `ProfileAccomplishment` 재사용
  - `interface PrRetroSynth { accomplishment: ProfileAccomplishment; narrative: string }`
  - `interface ReflectPrResult { accomplishment: ProfileAccomplishment; narrative: string; portfolioUrl: string; agentRunId: number; modelUsed: string }`
  - `CareerMateErrorCode.INVALID_PR_REFERENCE = 'CAREER_MATE_INVALID_PR_REFERENCE'`

- [ ] **Step 1: 실패 테스트 작성** — `extract-pr-reference.spec.ts`

```ts
import { CareerMateException } from './career-mate.exception';
import { extractPrReference } from './extract-pr-reference';

describe('extractPrReference', () => {
  it('문장 안의 full URL 을 추출한다', () => {
    const text =
      '이 PR 회고해서 https://github.com/schoolbell-e/sbe-workspace/pull/1692 이력서에 녹여줘';
    expect(extractPrReference(text)).toEqual({
      repo: 'schoolbell-e/sbe-workspace',
      number: 1692,
    });
  });

  it('shorthand(owner/repo#123) 를 추출한다', () => {
    expect(extractPrReference('schoolbell-e/sbe-workspace#42 회고')).toEqual({
      repo: 'schoolbell-e/sbe-workspace',
      number: 42,
    });
  });

  it('URL 과 shorthand 가 같이 있으면 URL 을 우선한다', () => {
    const text = 'a/b#1 말고 https://github.com/c/d/pull/2 회고';
    expect(extractPrReference(text)).toEqual({ repo: 'c/d', number: 2 });
  });

  it('PR ref 가 없으면 INVALID_PR_REFERENCE 예외', () => {
    try {
      extractPrReference('그냥 회고해줘');
      fail('예외가 발생해야 한다');
    } catch (error) {
      expect(error).toBeInstanceOf(CareerMateException);
      expect((error as CareerMateException).code).toBe(
        'CAREER_MATE_INVALID_PR_REFERENCE',
      );
    }
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm jest src/agent/career-mate/domain/extract-pr-reference.spec.ts`
Expected: FAIL — `extractPrReference` 모듈 없음.

- [ ] **Step 3: error code 추가** — `career-mate-error-code.enum.ts`

기존 enum 마지막 줄 뒤에 추가:
```ts
  INVALID_PR_REFERENCE = 'CAREER_MATE_INVALID_PR_REFERENCE',
```
> `CareerMateException`이 `.code`를 노출하는지 확인: 기존 `career-mate.exception.ts`는 생성자에서 `{ code, message, status }`를 받아 `this.code`에 담는다. (다른 usecase가 `CareerMateErrorCode`를 그대로 넘기므로 동일 패턴 사용.)

- [ ] **Step 4: 유틸 구현** — `extract-pr-reference.ts`

```ts
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CareerMateException } from './career-mate.exception';
import { ParsedPrRef } from './career-mate.type';
import { CareerMateErrorCode } from './career-mate-error-code.enum';

// 문장 안에서 첫 PR 참조를 추출한다 (앵커 없음 — 자연어 멘션에 URL 이 섞여 옴).
// URL 을 shorthand 보다 우선한다.
const URL_PATTERN =
  /https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/;
const SHORTHAND_PATTERN = /(?:^|\s)([\w.-]+\/[\w.-]+)#(\d+)(?=\s|$)/;

export const extractPrReference = (text: string): ParsedPrRef => {
  const urlMatch = text.match(URL_PATTERN);
  if (urlMatch) {
    return { repo: urlMatch[1], number: Number.parseInt(urlMatch[2], 10) };
  }
  const shortMatch = text.match(SHORTHAND_PATTERN);
  if (shortMatch) {
    return { repo: shortMatch[1], number: Number.parseInt(shortMatch[2], 10) };
  }
  throw new CareerMateException({
    code: CareerMateErrorCode.INVALID_PR_REFERENCE,
    message:
      'PR 링크를 찾지 못했습니다. 예: "이 PR 회고해줘 https://github.com/owner/repo/pull/123" 처럼 PR URL 을 함께 보내주세요.',
    status: DomainStatus.BAD_REQUEST,
  });
};
```

- [ ] **Step 5: 타입 추가** — `career-mate.type.ts`

`CareerMateAction` 유니온에 `| 'REFLECT_PR'` 추가. 파일 하단에 아래 타입 추가 (`ProfileAccomplishment`는 같은 파일에 이미 존재):
```ts
export interface ParsedPrRef {
  repo: string; // "owner/repo"
  number: number;
}

export interface ReflectPrInput {
  slackUserId: string;
  prText: string; // 사용자 원문 (dispatcher 가 input.text 를 그대로 전달)
}

export interface PrRetroSynth {
  accomplishment: ProfileAccomplishment;
  narrative: string;
}

export interface ReflectPrResult {
  accomplishment: ProfileAccomplishment;
  narrative: string;
  portfolioUrl: string;
  agentRunId: number;
  modelUsed: string;
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm jest src/agent/career-mate/domain/extract-pr-reference.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: 커밋**

```bash
git add src/agent/career-mate/domain/career-mate.type.ts \
  src/agent/career-mate/domain/career-mate-error-code.enum.ts \
  src/agent/career-mate/domain/extract-pr-reference.ts \
  src/agent/career-mate/domain/extract-pr-reference.spec.ts
git commit -m "feat(career-mate): REFLECT_PR 타입 + PR ref 문장 추출 유틸"
```

---

## Task 2: `pr-retro-synth` 프롬프트 + 파서

**Files:**
- Create: `src/agent/career-mate/domain/prompt/pr-retro-synth.prompt.ts`
- Test: `src/agent/career-mate/domain/prompt/pr-retro-synth.prompt.spec.ts`

**Interfaces:**
- Consumes: `PullRequestDetail`, `PullRequestDiff` (`src/github/domain/github.type.ts`), `PrRetroSynth`, `ProfileAccomplishment`.
- Produces:
  - `PR_RETRO_SYNTH_SYSTEM_PROMPT: string`
  - `buildPrRetroPrompt(input: { detail: PullRequestDetail; diff: PullRequestDiff }): string`
  - `parsePrRetroOutput(text: string): PrRetroSynth`

- [ ] **Step 1: 실패 테스트 작성** — `pr-retro-synth.prompt.spec.ts`

```ts
import { CareerMateException } from '../career-mate.exception';
import {
  buildPrRetroPrompt,
  parsePrRetroOutput,
} from './pr-retro-synth.prompt';

const VALID = JSON.stringify({
  accomplishment: {
    title: '크롤 실패 대시보드 고도화',
    bullet: '원인 보존·board_id 폴백 도입으로 운영 관측성 향상',
    star: {
      situation: '크롤 실패 원인이 유실됐다',
      task: '원인 보존·폴백을 설계',
      action: 'board_id 폴백과 헬스띠를 구현',
      result: '실패 진단 시간을 단축',
    },
    techTags: ['NestJS', 'Notion API'],
    evidence: [
      {
        repo: 'schoolbell-e/sbe-workspace',
        pr: 1692,
        url: 'https://github.com/schoolbell-e/sbe-workspace/pull/1692',
        mergedAt: '2026-06-30',
      },
    ],
  },
  narrative: '이 작업에서 가장 큰 결정은 원인 보존 방식이었다...',
});

describe('pr-retro-synth', () => {
  it('buildPrRetroPrompt 는 PR 메타/본문/diff 를 담는다', () => {
    const prompt = buildPrRetroPrompt({
      detail: {
        number: 1692,
        title: 'T',
        body: 'B',
        repo: 'o/r',
        url: 'u',
        baseRef: 'main',
        headRef: 'feat',
        authorLogin: 'me',
        changedFiles: ['a.ts'],
        changedFilesTruncated: false,
        changedFilesTotalCount: 1,
        additions: 10,
        deletions: 2,
      },
      diff: { diff: 'diff-body', truncated: false, bytes: 9 },
    });
    expect(prompt).toContain('#1692');
    expect(prompt).toContain('diff-body');
  });

  it('parsePrRetroOutput 는 정상 JSON 을 파싱한다 (코드펜스 허용)', () => {
    const parsed = parsePrRetroOutput('```json\n' + VALID + '\n```');
    expect(parsed.accomplishment.evidence[0].pr).toBe(1692);
    expect(parsed.narrative).toContain('가장 큰 결정');
  });

  it('accomplishment 누락 시 예외', () => {
    expect(() => parsePrRetroOutput('{"narrative":"x"}')).toThrow(
      CareerMateException,
    );
  });

  it('narrative 누락 시 예외', () => {
    const noNarr = JSON.stringify({
      accomplishment: JSON.parse(VALID).accomplishment,
    });
    expect(() => parsePrRetroOutput(noNarr)).toThrow(CareerMateException);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm jest src/agent/career-mate/domain/prompt/pr-retro-synth.prompt.spec.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `pr-retro-synth.prompt.ts`

```ts
import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import {
  PullRequestDetail,
  PullRequestDiff,
} from '../../../../github/domain/github.type';
import { CareerMateException } from '../career-mate.exception';
import { PrRetroSynth } from '../career-mate.type';
import { CareerMateErrorCode } from '../career-mate-error-code.enum';

export const PR_RETRO_SYNTH_SYSTEM_PROMPT = `너는 개발자의 단일 PR 하나를 이직용 "프로젝트 회고 + 이력서 성과"로 변환하는 전문가다.
입력으로 PR 메타(제목/본문/변경파일/증감)와 unified diff 를 받는다.
아래 JSON 하나로만 출력한다. 설명/주석/코드펜스 없이 JSON 만.

규칙:
- accomplishment.evidence 는 입력으로 받은 그 PR 하나로 고정한다 (repo/pr/url/mergedAt). 다른 PR 을 지어내지 않는다.
- accomplishment.bullet 은 이력서 한 줄: "행동 + 결과 + (가능하면) 정량 지표". PR 에서 확인되는 것만. 과장 금지.
- star 는 situation/task/action/result 각 1~2문장. diff 에서 실제로 한 일 기준.
- techTags 는 diff/파일 경로에서 드러난 실제 기술 스택.
- narrative 는 이 PR 회고 서술 3~6문장: 무엇이 문제였고, 어떤 의사결정·트레이드오프가 있었고, 무엇을 배웠는지. 수치·파일경로·고유명사는 보존.

스키마:
{
  "accomplishment": {
    "title": "성과 한 줄 제목",
    "bullet": "이력서 bullet",
    "star": {"situation","task","action","result"},
    "techTags": [],
    "evidence": [{"repo","pr","url","mergedAt"}]
  },
  "narrative": "회고 서술"
}`;

export const buildPrRetroPrompt = ({
  detail,
  diff,
}: {
  detail: PullRequestDetail;
  diff: PullRequestDiff;
}): string => {
  const truncatedNote = detail.changedFilesTruncated
    ? ` (잘림: 전체 ${detail.changedFilesTotalCount}개 중 ${detail.changedFiles.length}개만 노출)`
    : '';
  const diffNote = diff.truncated
    ? `\n\n(diff 가 ${diff.bytes} bytes 라 일부만 전달됨 — 잘린 뒷부분은 모를 수 있음)`
    : '';
  return [
    `[PR 메타]`,
    `- repo: ${detail.repo}`,
    `- number: #${detail.number}`,
    `- title: ${detail.title}`,
    `- author: ${detail.authorLogin}`,
    `- branch: ${detail.headRef} → ${detail.baseRef}`,
    `- additions/deletions: +${detail.additions} / -${detail.deletions}`,
    `- url: ${detail.url}`,
    `- changed files${truncatedNote}:`,
    ...detail.changedFiles.map((file) => `  - ${file}`),
    ``,
    `[PR 본문]`,
    detail.body || '(없음)',
    ``,
    `[diff]${diffNote}`,
    '```diff',
    diff.diff,
    '```',
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

export const parsePrRetroOutput = (text: string): PrRetroSynth => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return invalid('PR 회고 생성 실패 — 모델 출력이 JSON 이 아닙니다.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return invalid('PR 회고 생성 실패 — 출력 형식 오류.');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.narrative !== 'string' || obj.narrative.trim().length === 0) {
    return invalid('PR 회고 생성 실패 — narrative 누락.');
  }
  if (!isAccomplishment(obj.accomplishment)) {
    return invalid('PR 회고 생성 실패 — accomplishment 형태 오류.');
  }
  return parsed as PrRetroSynth;
};

const isAccomplishment = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  const star = item.star as Record<string, unknown> | undefined;
  return (
    typeof item.title === 'string' &&
    typeof item.bullet === 'string' &&
    Array.isArray(item.evidence) &&
    item.evidence.length > 0 &&
    typeof star === 'object' &&
    star !== null &&
    typeof star.situation === 'string' &&
    typeof star.task === 'string' &&
    typeof star.action === 'string' &&
    typeof star.result === 'string'
  );
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm jest src/agent/career-mate/domain/prompt/pr-retro-synth.prompt.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/agent/career-mate/domain/prompt/pr-retro-synth.prompt.ts \
  src/agent/career-mate/domain/prompt/pr-retro-synth.prompt.spec.ts
git commit -m "feat(career-mate): 단일 PR 회고 합성 프롬프트 + 파서"
```

---

## Task 3: 프로필 편입 순수 함수 `mergeAccomplishment`

**Files:**
- Create: `src/agent/career-mate/application/merge-accomplishment.ts`
- Test: `src/agent/career-mate/application/merge-accomplishment.spec.ts`

**Interfaces:**
- Consumes: `CareerProfileData`, `ProfileAccomplishment` (`career-mate.type.ts`).
- Produces: `mergeAccomplishment(input: { latest: CareerProfileData | null; accomplishment: ProfileAccomplishment; githubLogin: string; todayIsoDate: string }): CareerProfileData`
  - `latest`가 있으면 `accomplishments`에서 같은 `evidence[0].repo`+`pr`을 제거 후 맨 앞에 append(교체), `meta.prCount = 편입 후 고유 PR 수`, `meta.windowStart`는 기존 유지.
  - `latest`가 없으면 이 accomplishment 하나로 최소 프로필 생성: `summary = accomplishment.bullet`, `skills = []`, `meta = { githubLogin, windowStart: evidence.mergedAt?.slice(0,10) ?? todayIsoDate, prCount: 1 }`.

> `todayIsoDate`는 호출자(usecase)가 주입한다 — 순수 함수 유지(테스트 결정성). usecase는 `new Date().toISOString().slice(0,10)`로 만든다 (usecase는 스크립트가 아니므로 `new Date()` 허용).

- [ ] **Step 1: 실패 테스트 작성** — `merge-accomplishment.spec.ts`

```ts
import { CareerProfileData, ProfileAccomplishment } from '../domain/career-mate.type';
import { mergeAccomplishment } from './merge-accomplishment';

const acc = (pr: number, bullet: string): ProfileAccomplishment => ({
  title: `t${pr}`,
  bullet,
  star: { situation: 's', task: 't', action: 'a', result: 'r' },
  techTags: ['NestJS'],
  evidence: [
    { repo: 'o/r', pr, url: `https://x/pull/${pr}`, mergedAt: '2026-06-30' },
  ],
});

describe('mergeAccomplishment', () => {
  it('프로필이 없으면 최소 프로필을 만든다', () => {
    const out = mergeAccomplishment({
      latest: null,
      accomplishment: acc(1692, 'first'),
      githubLogin: 'me',
      todayIsoDate: '2026-07-01',
    });
    expect(out.accomplishments).toHaveLength(1);
    expect(out.skills).toEqual([]);
    expect(out.meta.prCount).toBe(1);
    expect(out.meta.windowStart).toBe('2026-06-30');
    expect(out.summary).toBe('first');
  });

  it('기존 프로필에 새 PR 을 append 한다', () => {
    const latest: CareerProfileData = {
      summary: 'sum',
      skills: [],
      accomplishments: [acc(1, 'old')],
      meta: { githubLogin: 'me', windowStart: '2026-01-01', prCount: 1 },
    };
    const out = mergeAccomplishment({
      latest,
      accomplishment: acc(1692, 'new'),
      githubLogin: 'me',
      todayIsoDate: '2026-07-01',
    });
    expect(out.accomplishments.map((a) => a.evidence[0].pr).sort()).toEqual([
      1, 1692,
    ]);
    expect(out.meta.prCount).toBe(2);
    expect(out.meta.windowStart).toBe('2026-01-01');
  });

  it('같은 PR 재회고 시 교체(중복 누적 방지)', () => {
    const latest: CareerProfileData = {
      summary: 'sum',
      skills: [],
      accomplishments: [acc(1692, 'v1')],
      meta: { githubLogin: 'me', windowStart: '2026-01-01', prCount: 1 },
    };
    const out = mergeAccomplishment({
      latest,
      accomplishment: acc(1692, 'v2'),
      githubLogin: 'me',
      todayIsoDate: '2026-07-01',
    });
    expect(out.accomplishments).toHaveLength(1);
    expect(out.accomplishments[0].bullet).toBe('v2');
    expect(out.meta.prCount).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm jest src/agent/career-mate/application/merge-accomplishment.spec.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `merge-accomplishment.ts`

```ts
import {
  CareerProfileData,
  ProfileAccomplishment,
} from '../domain/career-mate.type';

const evidenceKey = (item: ProfileAccomplishment): string => {
  const first = item.evidence[0];
  return first ? `${first.repo}#${first.pr}` : '';
};

export const mergeAccomplishment = ({
  latest,
  accomplishment,
  githubLogin,
  todayIsoDate,
}: {
  latest: CareerProfileData | null;
  accomplishment: ProfileAccomplishment;
  githubLogin: string;
  todayIsoDate: string;
}): CareerProfileData => {
  const key = evidenceKey(accomplishment);
  const mergedAt = accomplishment.evidence[0]?.mergedAt;

  if (!latest) {
    return {
      summary: accomplishment.bullet,
      skills: [],
      accomplishments: [accomplishment],
      meta: {
        githubLogin,
        windowStart: mergedAt ? mergedAt.slice(0, 10) : todayIsoDate,
        prCount: 1,
      },
    };
  }

  const kept = latest.accomplishments.filter(
    (item) => evidenceKey(item) !== key,
  );
  const accomplishments = [accomplishment, ...kept];
  const prCount = new Set(
    accomplishments.map((item) => evidenceKey(item)).filter(Boolean),
  ).size;

  return {
    ...latest,
    accomplishments,
    meta: { ...latest.meta, githubLogin, prCount },
  };
};
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm jest src/agent/career-mate/application/merge-accomplishment.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/agent/career-mate/application/merge-accomplishment.ts \
  src/agent/career-mate/application/merge-accomplishment.spec.ts
git commit -m "feat(career-mate): PR 회고 프로필 편입 순수 함수 (dedup append)"
```

---

## Task 4: `ReflectPrUsecase` 오케스트레이션

**Files:**
- Create: `src/agent/career-mate/application/reflect-pr.usecase.ts`
- Test: `src/agent/career-mate/application/reflect-pr.usecase.spec.ts`

**Interfaces:**
- Consumes: `extractPrReference`, `buildPrRetroPrompt`/`parsePrRetroOutput`/`PR_RETRO_SYNTH_SYSTEM_PROMPT`, `mergeAccomplishment`, `humanizeCareerProfile`, `RenderPortfolioUsecase.execute`, `CareerProfileRepositoryPort`, `GithubClientPort.getPullRequest`/`getPullRequestDiff`, `AgentRunService.execute`, `ModelRouterUsecase.route`, `ConfigService`, `HumanizeService`.
- Produces: `ReflectPrUsecase.execute(input: ReflectPrInput): Promise<AgentRunOutcome<ReflectPrResult>>`.

> **패턴 참고:** `build-career-profile.usecase.ts`의 생성자 DI + `agentRunService.execute<T>({ agentType, triggerType, inputSnapshot, run })` 구조를 그대로 따른다. `run: async (context) => ({ result, modelUsed, output })`. `AgentRunOutcome`은 `{ agentRunId, result, modelUsed }`를 노출(`.result`/`.agentRunId` 사용).

- [ ] **Step 1: 실패 테스트 작성** — `reflect-pr.usecase.spec.ts`

```ts
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { CareerProfileRepositoryPort } from '../domain/port/career-profile.repository.port';
import { RenderPortfolioUsecase } from './render-portfolio.usecase';
import { ReflectPrUsecase } from './reflect-pr.usecase';

const SYNTH = JSON.stringify({
  accomplishment: {
    title: 'T',
    bullet: 'B',
    star: { situation: 's', task: 't', action: 'a', result: 'r' },
    techTags: ['NestJS'],
    evidence: [
      { repo: 'o/r', pr: 1692, url: 'https://x/pull/1692', mergedAt: '2026-06-30' },
    ],
  },
  narrative: '회고 서술',
});

describe('ReflectPrUsecase', () => {
  const github = {
    getPullRequest: jest.fn().mockResolvedValue({
      number: 1692, title: 'T', body: 'B', repo: 'o/r', url: 'u',
      baseRef: 'main', headRef: 'f', authorLogin: 'me',
      changedFiles: ['a.ts'], changedFilesTruncated: false,
      changedFilesTotalCount: 1, additions: 1, deletions: 0,
    }),
    getPullRequestDiff: jest.fn().mockResolvedValue({
      diff: 'd', truncated: false, bytes: 1,
    }),
  } as unknown as GithubClientPort;

  const modelRouter = {
    route: jest.fn().mockResolvedValue({ text: SYNTH, modelUsed: 'claude' }),
  } as unknown as ModelRouterUsecase;

  const repository = {
    findLatestBySlackUser: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue({ id: 7 }),
  } as unknown as CareerProfileRepositoryPort;

  const humanizer = {} as HumanizeService;

  const renderPortfolio = {
    execute: jest
      .fn()
      .mockResolvedValue({ url: 'https://notion/p', pageId: 'p', agentRunId: 0 }),
  } as unknown as RenderPortfolioUsecase;

  const config = {
    get: jest.fn().mockReturnValue('me'),
  } as unknown as ConfigService;

  // agentRunService.execute 는 run(context) 를 즉시 실행하고 outcome 을 반환하도록 mock.
  const agentRunService = {
    execute: jest.fn(async ({ run }) => {
      const out = await run({ agentRunId: 55 });
      return { agentRunId: 55, result: out.result, modelUsed: out.modelUsed };
    }),
  } as unknown as AgentRunService;

  it('PR fetch→합성→편입 저장→포폴 append 를 수행한다', async () => {
    const usecase = new ReflectPrUsecase(
      github, modelRouter, repository, agentRunService, config, humanizer, renderPortfolio,
    );
    const outcome = await usecase.execute({
      slackUserId: 'U1',
      prText: '이 PR 회고 https://github.com/o/r/pull/1692 이력서에',
    });

    expect(github.getPullRequest).toHaveBeenCalledWith({ repo: 'o/r', number: 1692 });
    expect(repository.save).toHaveBeenCalled();
    expect(renderPortfolio.execute).toHaveBeenCalledWith({ slackUserId: 'U1' });
    expect(outcome.result.portfolioUrl).toBe('https://notion/p');
    expect(outcome.result.accomplishment.evidence[0].pr).toBe(1692);
    expect(outcome.result.narrative).toBe('회고 서술');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm jest src/agent/career-mate/application/reflect-pr.usecase.spec.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `reflect-pr.usecase.ts`

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeCareerProfile } from '../../../humanize/application/humanize-career-profile.adapter';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { CareerMateException } from '../domain/career-mate.exception';
import { ReflectPrInput, ReflectPrResult } from '../domain/career-mate.type';
import { CareerMateErrorCode } from '../domain/career-mate-error-code.enum';
import { extractPrReference } from '../domain/extract-pr-reference';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import {
  buildPrRetroPrompt,
  parsePrRetroOutput,
  PR_RETRO_SYNTH_SYSTEM_PROMPT,
} from '../domain/prompt/pr-retro-synth.prompt';
import { mergeAccomplishment } from './merge-accomplishment';
import { RenderPortfolioUsecase } from './render-portfolio.usecase';

@Injectable()
export class ReflectPrUsecase {
  private readonly logger = new Logger(ReflectPrUsecase.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly agentRunService: AgentRunService,
    private readonly config: ConfigService,
    private readonly humanizer: HumanizeService,
    private readonly renderPortfolio: RenderPortfolioUsecase,
  ) {}

  async execute({
    slackUserId,
    prText,
  }: ReflectPrInput): Promise<AgentRunOutcome<ReflectPrResult>> {
    const ref = extractPrReference(prText); // 미검출 시 INVALID_PR_REFERENCE
    const githubLogin = this.config.get<string>('IMPACT_REPORT_GITHUB_AUTHOR');
    if (!githubLogin) {
      throw new CareerMateException({
        code: CareerMateErrorCode.CONFIG_MISSING,
        message:
          'IMPACT_REPORT_GITHUB_AUTHOR 가 설정되지 않았습니다 (.env 확인).',
        status: DomainStatus.INTERNAL,
      });
    }

    return this.agentRunService.execute<ReflectPrResult>({
      agentType: AgentType.CAREER_MATE,
      triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
      inputSnapshot: { slackUserId, repo: ref.repo, prNumber: ref.number },
      run: async (context) => {
        const [detail, diff] = await Promise.all([
          this.githubClient.getPullRequest(ref),
          this.githubClient.getPullRequestDiff(ref),
        ]);

        const completion = await this.modelRouter.route({
          agentType: AgentType.CAREER_MATE,
          request: {
            prompt: buildPrRetroPrompt({ detail, diff }),
            systemPrompt: PR_RETRO_SYNTH_SYSTEM_PROMPT,
          },
        });
        const { accomplishment, narrative } = parsePrRetroOutput(
          completion.text,
        );

        const latest =
          await this.repository.findLatestBySlackUser(slackUserId);
        const todayIsoDate = new Date().toISOString().slice(0, 10);
        const merged = mergeAccomplishment({
          latest: latest?.profileJson ?? null,
          accomplishment,
          githubLogin,
          todayIsoDate,
        });
        const humanized = await humanizeCareerProfile(merged, this.humanizer);

        await this.repository.save({
          agentRunId: context.agentRunId,
          slackUserId,
          githubLogin,
          windowStart: humanized.meta.windowStart,
          prCount: humanized.meta.prCount,
          summary: humanized.summary,
          profileJson: humanized,
        });

        const portfolio = await this.renderPortfolio.execute({ slackUserId });

        this.logger.log(
          `CAREER_MATE REFLECT_PR 완료 — ${ref.repo}#${ref.number}, 성과 ${humanized.accomplishments.length}건`,
        );

        const result: ReflectPrResult = {
          accomplishment,
          narrative,
          portfolioUrl: portfolio.url,
          agentRunId: context.agentRunId,
          modelUsed: completion.modelUsed,
        };
        return { result, modelUsed: completion.modelUsed, output: result };
      },
    });
  }
}
```

> **확인 사항 (구현 중):** `agentRunService.execute`의 `run(context)` 콜백이 받는 `context`에 `agentRunId`가 있는지 `build-career-profile.usecase.ts:95`에서 확인(있음). `inputSnapshot` 필드명은 자유 형식 JSON 이라 `repo`/`prNumber` 사용 무방. `humanizeCareerProfile`가 `meta`를 보존하는지 확인 — build usecase는 humanize **후** `data.meta`를 덮어쓴다. 여기선 merge 단계에서 이미 meta 를 확정하므로, humanize 가 meta 를 건드리면 저장 전 `humanized.meta = merged.meta`로 복원한다(구현 시 humanize adapter 동작 확인 후 필요하면 1줄 추가).

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm jest src/agent/career-mate/application/reflect-pr.usecase.spec.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/agent/career-mate/application/reflect-pr.usecase.ts \
  src/agent/career-mate/application/reflect-pr.usecase.spec.ts
git commit -m "feat(career-mate): ReflectPrUsecase — 단일 PR 회고 오케스트레이션"
```

---

## Task 5: formatter + dispatcher + module 배선

**Files:**
- Modify: `src/agent/career-mate/infrastructure/career-mate.formatter.ts`
- Modify: `src/agent/career-mate/infrastructure/career-mate.dispatcher.ts`
- Modify: `src/agent/career-mate/career-mate.module.ts`
- Modify: `src/agent/career-mate/infrastructure/career-mate.formatter.spec.ts` (formatPrRetro 케이스 추가)
- Modify: `src/agent/career-mate/infrastructure/career-mate.dispatcher.spec.ts` (REFLECT_PR 케이스 추가)

**Interfaces:**
- Consumes: `ReflectPrResult`, `ReflectPrUsecase`.
- Produces: `formatPrRetro(result: ReflectPrResult): string`.

- [ ] **Step 1: formatter 테스트 추가** — `career-mate.formatter.spec.ts`

```ts
it('formatPrRetro 는 회고·이력서 bullet·포폴 링크를 담는다', () => {
  const out = formatPrRetro({
    accomplishment: {
      title: 'T', bullet: 'B',
      star: { situation: 's', task: 't', action: 'a', result: 'r' },
      techTags: ['NestJS'],
      evidence: [{ repo: 'o/r', pr: 1692, url: 'u', mergedAt: '2026-06-30' }],
    },
    narrative: '회고 서술 본문',
    portfolioUrl: 'https://notion/p',
    agentRunId: 1,
    modelUsed: 'claude',
  });
  expect(out).toContain('회고 서술 본문');
  expect(out).toContain('B');
  expect(out).toContain('https://notion/p');
});
```
> `formatPrRetro` import 를 spec 상단에 추가.

- [ ] **Step 2: formatter 구현** — `career-mate.formatter.ts`

파일 하단(escape 함수 위)에 추가. `import { ReflectPrResult } from '../domain/career-mate.type';`를 기존 import 블록에 병합:
```ts
export const formatPrRetro = (result: ReflectPrResult): string => {
  const a = result.accomplishment;
  const star = a.star;
  return [
    `*PR 회고 — ${escapeSlackMrkdwn(a.title)}*`,
    escapeSlackMrkdwn(result.narrative),
    ``,
    `*이력서 bullet*`,
    `• ${escapeSlackMrkdwn(a.bullet)}`,
    ``,
    `*STAR*`,
    `• S: ${escapeSlackMrkdwn(star.situation)}`,
    `• T: ${escapeSlackMrkdwn(star.task)}`,
    `• A: ${escapeSlackMrkdwn(star.action)}`,
    `• R: ${escapeSlackMrkdwn(star.result)}`,
    ``,
    `*포트폴리오 반영 완료* ✅\n${result.portfolioUrl}`,
  ].join('\n');
};
```

- [ ] **Step 3: dispatcher 배선** — `career-mate.dispatcher.ts`

생성자에 `private readonly reflectPr: ReflectPrUsecase` 주입(맨 끝 파라미터). import 추가. switch 에 case 추가:
```ts
      case 'REFLECT_PR': {
        const outcome = await this.reflectPr.execute({
          slackUserId,
          prText: input.text ?? '',
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          outcome.result.modelUsed,
          formatPrRetro(outcome.result),
        );
      }
```
> `formatPrRetro`를 `./career-mate.formatter` import 목록에 추가.

- [ ] **Step 4: module 등록** — `career-mate.module.ts`

`ReflectPrUsecase` import 후 `providers`/`exports` 배열에 추가.

- [ ] **Step 5: dispatcher 테스트 추가** — `career-mate.dispatcher.spec.ts`

기존 spec 의 mock 구성(각 usecase mock)을 따라 `reflectPr = { execute: jest.fn().mockResolvedValue({ agentRunId, result: {...ReflectPrResult} }) }`를 생성자에 전달하고, intent parser 가 `REFLECT_PR`을 반환하도록 modelRouter mock 텍스트를 `{"action":"REFLECT_PR"}`로 두면, `dispatch` 가 `reflectPr.execute`를 호출하고 `formatPrRetro` 결과를 담는지 검증한다.

```ts
it('REFLECT_PR intent 는 reflectPr.execute 를 호출한다', async () => {
  modelRouter.route.mockResolvedValueOnce({ text: '{"action":"REFLECT_PR"}' });
  reflectPr.execute.mockResolvedValue({
    agentRunId: 9,
    result: {
      accomplishment: {
        title: 'T', bullet: 'B',
        star: { situation: 's', task: 't', action: 'a', result: 'r' },
        techTags: [], evidence: [{ repo: 'o/r', pr: 1, url: 'u', mergedAt: '2026-06-30' }],
      },
      narrative: 'N', portfolioUrl: 'https://notion/p', agentRunId: 9, modelUsed: 'claude',
    },
  });
  const outcome = await dispatcher.dispatch({ slackUserId: 'U', text: 'https://github.com/o/r/pull/1 회고' } as any);
  expect(reflectPr.execute).toHaveBeenCalledWith({ slackUserId: 'U', prText: 'https://github.com/o/r/pull/1 회고' });
  expect(outcome.formattedText).toContain('https://notion/p');
});
```
> 기존 dispatcher spec 의 생성자 인자 순서에 맞춰 `reflectPr` mock 을 마지막 인자로 추가.

- [ ] **Step 6: 관련 테스트 실행**

Run: `pnpm jest src/agent/career-mate/infrastructure`
Expected: PASS (formatter + dispatcher).

- [ ] **Step 7: 커밋**

```bash
git add src/agent/career-mate/infrastructure/career-mate.formatter.ts \
  src/agent/career-mate/infrastructure/career-mate.formatter.spec.ts \
  src/agent/career-mate/infrastructure/career-mate.dispatcher.ts \
  src/agent/career-mate/infrastructure/career-mate.dispatcher.spec.ts \
  src/agent/career-mate/career-mate.module.ts
git commit -m "feat(career-mate): REFLECT_PR formatter + dispatcher + module 배선"
```

---

## Task 6: 라우팅 교정 (2차 intent + 1차 IntentClassifier)

**Files:**
- Modify: `src/agent/career-mate/domain/prompt/career-mate-intent.prompt.ts`
- Modify: `src/agent/career-mate/domain/prompt/career-mate-intent.prompt.spec.ts`
- Modify: `src/router/domain/prompt/intent-classifier-system.prompt.ts`

- [ ] **Step 1: 2차 intent 테스트 추가** — `career-mate-intent.prompt.spec.ts`

```ts
it('REFLECT_PR 을 유효 action 으로 파싱한다', () => {
  expect(parseCareerMateIntent('{"action":"REFLECT_PR"}')).toEqual({
    action: 'REFLECT_PR',
  });
});
```

- [ ] **Step 2: 2차 intent 구현** — `career-mate-intent.prompt.ts`

`VALID_ACTIONS` 배열에 `'REFLECT_PR'` 추가. 시스템 프롬프트 action 목록에 추가(BUILD_PROFILE 위 또는 아래):
```
- "REFLECT_PR": 특정 PR 하나를 회고해서 이력서/포트폴리오에 반영 ("이 PR 회고해줘", "이 PR 이력서에 녹여줘", "이 작업 회고해서 성과로"). PR URL 또는 owner/repo#번호 가 함께 온다.
```

- [ ] **Step 3: 2차 intent 테스트 통과**

Run: `pnpm jest src/agent/career-mate/domain/prompt/career-mate-intent.prompt.spec.ts`
Expected: PASS.

- [ ] **Step 4: 1차 IntentClassifier 교정** — `intent-classifier-system.prompt.ts`

- PO_EVAL 라인(현 line 15)을 아래로 교체:
```
- PO_EVAL: 직전 Work Reviewer / PO Shadow / Impact Reporter 결과 통합 + 이력서용 careerLog ("이번 주 정리해줘", "이번 주 통합 회고", "/po-eval 같은 의미"). 특정 PR 하나가 아니라 기간(주간) 단위 통합일 때만.
```
- CAREER_MATE 라인(현 line 19)을 아래로 교체:
```
- CAREER_MATE: 이직용 역량 프로필/이력서/포트폴리오 ("프로필 정리해줘", "내 역량 정리", "이력서 성과 뽑아줘", "포트폴리오 페이지 만들어줘"). **특정 PR 하나를 회고해서 이력서/포트폴리오에 녹이는 요청도 여기** ("이 PR 회고해서 이력서에 녹여줘" + PR URL).
```
- `## UNKNOWN` 섹션 바로 앞에 구분 규칙 추가:
```
## CODE_REVIEWER vs CAREER_MATE (PR URL 이 있을 때)
PR URL/reference 가 포함돼도 동사로 구분한다:
- "리뷰/봐줘/피드백/검토해줘" → CODE_REVIEWER (코드 품질 리뷰)
- "회고/이력서/포트폴리오/녹여/성과로 정리" → CAREER_MATE (경력 자산화)
```

- [ ] **Step 5: 전체 게이트**

Run: `pnpm lint:check && pnpm test && pnpm build`
Expected: 모두 exit 0.

- [ ] **Step 6: 커밋**

```bash
git add src/agent/career-mate/domain/prompt/career-mate-intent.prompt.ts \
  src/agent/career-mate/domain/prompt/career-mate-intent.prompt.spec.ts \
  src/router/domain/prompt/intent-classifier-system.prompt.ts
git commit -m "fix(router): 단일 PR 회고를 CAREER_MATE.REFLECT_PR 로 라우팅 (PO_EVAL 오분류 교정)"
```

---

## Task 7: 최종 검증 + spec/plan 문서 커밋

- [ ] **Step 1: 3중 green 재확인**

Run: `pnpm lint:check && pnpm test && pnpm build`
Expected: 모두 exit 0.

- [ ] **Step 2: docs 커밋** (docs/ 가 gitignore 면 `-f`)

```bash
git add -f docs/superpowers/specs/2026-07-01-career-mate-reflect-pr-design.md \
  docs/superpowers/plans/2026-07-01-career-mate-reflect-pr.md
git commit -m "docs(career-mate): REFLECT_PR spec + 구현 계획"
```

- [ ] **Step 3: 수동 E2E 안내 (사용자 터미널)**

`@이대리 https://github.com/schoolbell-e/sbe-workspace/pull/1692 이 PR 회고해서 이력서·포트폴리오에 녹여줘` 로 실제 실행 → 그 PR 단독 회고 + 이력서 bullet + Notion 포폴 링크가 나오는지 확인. (LLM/GitHub/Notion 실호출은 로컬 실행에서만 검증 가능.)

---

## Self-Review (계획 작성자 체크)

- **Spec 커버리지**: §5 라우팅(Task 6) / §6 usecase(Task 4) / §7 편입(Task 3) / §8 프롬프트(Task 2) / §9 formatter(Task 5) / §10 dispatcher(Task 5) / §11 module(Task 5) / §13 리스크(각 예외 경로) / §14 검증(각 spec + Task 7) — 모두 태스크 존재. ✅
- **spec 대비 변경점**: PR ref 파싱을 dispatcher→**usecase(extractPrReference)** 로 이동, 포폴 append 를 **RenderPortfolioUsecase 재사용**으로 확정. (더 나은 응집/재사용 — spec 방향과 상충 없음.)
- **타입 일관성**: `extractPrReference→ParsedPrRef`, `parsePrRetroOutput→PrRetroSynth{accomplishment,narrative}`, `mergeAccomplishment→CareerProfileData`, `ReflectPrResult`(portfolioUrl/modelUsed 포함) — Task 간 시그니처 일치. ✅
- **placeholder 스캔**: 각 코드 스텝에 실제 코드 존재. Task 4 Step 3 의 "구현 중 확인 사항"은 humanize meta 보존 여부 1줄 방어로 명시(모호성 아님). ✅
- **미해결 확인 1건**: `humanizeCareerProfile`가 `meta`를 변형하는지 — Task 4에서 실제 adapter 확인 후 필요시 `humanized.meta = merged.meta` 복원. (실패해도 저장 정확성만 영향, 회귀 아님.)
