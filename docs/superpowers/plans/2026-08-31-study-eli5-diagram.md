# 오늘의 공부 그림 자동 첨부 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 오늘의 공부(09:30 cron)가 만드는 노션 페이지 맨 위에, codex가 그린 eli5 스타일 그림 한 장을 PNG로 붙인다.

**Architecture:** codex에게 HTML+인라인 SVG를 받아 puppeteer로 띄우고, 캡처 직전에 글자 크기·가로 넘침·세로 높이를 재서 기준 미달이면 사유를 넣어 1회 재작업시킨다. 통과한 것만 PNG로 찍어 노션 파일 업로드 API로 올리고 `image` 블록으로 페이지에 첨부한다. 어느 단계에서 실패해도 그림만 생략되고 페이지·Slack은 평소대로 나간다.

**Tech Stack:** NestJS 10 · TypeScript · puppeteer(이미 설치됨) · Notion REST API(파일 업로드는 SDK 미지원이라 raw fetch) · jest · ts-pattern

**Spec:** [docs/superpowers/specs/2026-08-31-study-eli5-diagram-design.md](../specs/2026-08-31-study-eli5-diagram-design.md)

## Global Constraints

레포 전역 규칙이다. 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **패키지 매니저는 `pnpm@9.15.9`** 고정. `npm`·`yarn` 사용 금지.
- **테스트 필터는 `pnpm exec jest src/<경로>`** 를 쓴다. `pnpm test`는 jest를 두 번 실행하는 스크립트라 `pnpm test -- <경로>` 형태의 필터가 먹지 않는다.
- **`process.env` 직접 참조 금지.** 값은 `ConfigService.get(...)`으로 읽는다.
- **ORM은 Prisma만.** TypeORM import 금지.
- **CLI 자식 프로세스 env는 `buildSafeChildEnv`만** 사용하고, 프롬프트는 stdin으로 넘긴다(argv 금지).
- 코드 스타일: `catch (error)`(`err` 금지) · `if` 단일 라인도 중괄호 · `try` 안에서 `return await` 유지 · 인라인 반환 타입 금지(별도 interface로 추출) · 파일명 kebab-case + 역할 접미사.
- **새 환경변수는 네 곳을 함께 갱신**한다: `.env.example` · `.env` · `src/config/app.config.ts` · README 표. 여기에 `docs/env-catalog.md`도 채운다.
- **완료 판정은 `pnpm lint:check && pnpm test && pnpm build` 3중 통과**. 환경변수를 건드린 태스크는 `pnpm docs:check`도 함께 돌린다.
- **`main`에 직접 커밋하지 않는다.** 착수 전 `git branch --show-current`로 현재 트리를 확인하고 작업 브랜치를 나눈다. 태스크별 커밋 문구는 각 태스크에 적혀 있다.
- **브라우저를 직접 띄우는 코드에는 spec을 붙이지 않는다** — 이 레포 관행이다(`crawler.requester.ts`에 spec 없음). 대신 측정과 판정을 분리해 판정 로직만 단위 테스트한다.

### 이 계획이 확정하지 않은 값 두 개

아래 두 값은 **Task 8에서 실측으로 확정**한다. 그때까지 코드에는 환경변수로만 존재하고, 추정치를 기본값으로 박지 않는다.

| 값 | 왜 미확정인가 |
|---|---|
| 노션 본문 폭(px) | 공식 문서에 명시가 없고 공개 자료가 엇갈린다. 실제 페이지에 올려 축소 여부를 눈으로 확인해야 한다 |
| 파일 업로드용 `Notion-Version` | SDK 2.3.0이 보내는 값이 파일 업로드를 지원하는지 불확실하다. 실호출로 확인한다 |

---

### Task 1: 렌더 판정 순수 함수

브라우저가 잰 측정값을 받아 "이 그림을 올려도 되는가"를 판정한다. 브라우저에 의존하지 않는 순수 함수라 단위 테스트가 가능하다.

**Files:**
- Create: `src/study-brief-cron/domain/study-diagram.checker.ts`
- Test: `src/study-brief-cron/domain/study-diagram.checker.spec.ts`

**Interfaces:**
- Consumes: (없음 — 첫 태스크)
- Produces:
  - `DiagramMeasurements { texts: DiagramTextMeasurement[]; contentWidth: number; contentHeight: number }`
  - `DiagramTextMeasurement { label: string; renderedFontPx: number }`
  - `DiagramLimits { widthPx: number; minFontPx: number; maxHeightPx: number }`
  - `DiagramViolation { rule: DiagramViolationRule; detail: string }`
  - `DiagramViolationRule = 'FONT_TOO_SMALL' | 'OVERFLOW_X' | 'TOO_TALL'`
  - `findDiagramViolations(measurements: DiagramMeasurements, limits: DiagramLimits): DiagramViolation[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/study-brief-cron/domain/study-diagram.checker.spec.ts`:

```ts
import { findDiagramViolations } from './study-diagram.checker';

const limits = { widthPx: 700, minFontPx: 14, maxHeightPx: 1600 };
const clean = {
  texts: [
    { label: 'svg>text "요청"', renderedFontPx: 18 },
    { label: 'div.caption', renderedFontPx: 14 },
  ],
  contentWidth: 700,
  contentHeight: 900,
};

describe('findDiagramViolations', () => {
  it('모든 기준을 만족하면 위반이 없다', () => {
    expect(findDiagramViolations(clean, limits)).toEqual([]);
  });

  it('하한과 같은 글자 크기는 통과시킨다', () => {
    const measurements = {
      ...clean,
      texts: [{ label: 'svg>text', renderedFontPx: 14 }],
    };

    expect(findDiagramViolations(measurements, limits)).toEqual([]);
  });

  it('하한 미만 글자가 하나라도 있으면 FONT_TOO_SMALL 을 낸다', () => {
    const measurements = {
      ...clean,
      texts: [
        { label: 'svg>text "정상"', renderedFontPx: 18 },
        { label: 'svg>text "작음"', renderedFontPx: 9 },
      ],
    };

    const violations = findDiagramViolations(measurements, limits);

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('FONT_TOO_SMALL');
    expect(violations[0].detail).toContain('svg>text "작음"');
    expect(violations[0].detail).toContain('9');
    expect(violations[0].detail).toContain('14');
  });

  it('작은 글자가 여러 개면 detail 에 함께 담는다', () => {
    const measurements = {
      ...clean,
      texts: [
        { label: 'a', renderedFontPx: 8 },
        { label: 'b', renderedFontPx: 10 },
      ],
    };

    const violations = findDiagramViolations(measurements, limits);

    expect(violations).toHaveLength(1);
    expect(violations[0].detail).toContain('a');
    expect(violations[0].detail).toContain('b');
  });

  it('내용이 캔버스 폭을 넘으면 OVERFLOW_X 를 낸다', () => {
    const violations = findDiagramViolations(
      { ...clean, contentWidth: 812 },
      limits,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('OVERFLOW_X');
    expect(violations[0].detail).toContain('812');
    expect(violations[0].detail).toContain('700');
  });

  it('세로가 상한을 넘으면 TOO_TALL 을 낸다', () => {
    const violations = findDiagramViolations(
      { ...clean, contentHeight: 2400 },
      limits,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('TOO_TALL');
    expect(violations[0].detail).toContain('2400');
  });

  it('여러 규칙을 동시에 위반하면 모두 반환한다', () => {
    const violations = findDiagramViolations(
      {
        texts: [{ label: 'tiny', renderedFontPx: 6 }],
        contentWidth: 900,
        contentHeight: 3000,
      },
      limits,
    );

    expect(violations.map((violation) => violation.rule)).toEqual([
      'FONT_TOO_SMALL',
      'OVERFLOW_X',
      'TOO_TALL',
    ]);
  });

  it('잰 글자가 하나도 없으면 빈 그림으로 보고 FONT_TOO_SMALL 을 낸다', () => {
    const violations = findDiagramViolations(
      { ...clean, texts: [] },
      limits,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe('FONT_TOO_SMALL');
  });
});
```

마지막 케이스가 중요하다. 글자가 0개인 그림은 "위반 0건"으로 통과해 버리면 빈 화면이 노션에 올라간다. 조용한 0건은 에러보다 오래 산다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm exec jest src/study-brief-cron/domain/study-diagram.checker.spec.ts`
Expected: FAIL — `Cannot find module './study-diagram.checker'`

- [ ] **Step 3: 구현한다**

`src/study-brief-cron/domain/study-diagram.checker.ts`:

```ts
export type DiagramViolationRule =
  | 'FONT_TOO_SMALL'
  | 'OVERFLOW_X'
  | 'TOO_TALL';

export interface DiagramTextMeasurement {
  // 사람이 로그에서 어느 요소인지 알아볼 수 있는 표식. 재작업 프롬프트에도 그대로 실린다.
  label: string;
  // CSS font-size 가 아니라 실제 렌더 높이 기반 값. SVG viewBox 스케일이 반영된 크기다.
  renderedFontPx: number;
}

export interface DiagramMeasurements {
  texts: DiagramTextMeasurement[];
  contentWidth: number;
  contentHeight: number;
}

export interface DiagramLimits {
  widthPx: number;
  minFontPx: number;
  maxHeightPx: number;
}

export interface DiagramViolation {
  rule: DiagramViolationRule;
  detail: string;
}

export const findDiagramViolations = (
  measurements: DiagramMeasurements,
  limits: DiagramLimits,
): DiagramViolation[] => {
  const violations: DiagramViolation[] = [];

  const tooSmall = measurements.texts.filter(
    (text) => text.renderedFontPx < limits.minFontPx,
  );
  if (measurements.texts.length === 0) {
    violations.push({
      rule: 'FONT_TOO_SMALL',
      detail: '글자를 하나도 찾지 못했습니다. 빈 그림일 가능성이 높습니다.',
    });
  } else if (tooSmall.length > 0) {
    const listed = tooSmall
      .map((text) => `${text.label}(${Math.round(text.renderedFontPx)}px)`)
      .join(', ');
    violations.push({
      rule: 'FONT_TOO_SMALL',
      detail: `글자 하한 ${limits.minFontPx}px 미만: ${listed}`,
    });
  }

  if (measurements.contentWidth > limits.widthPx) {
    violations.push({
      rule: 'OVERFLOW_X',
      detail: `내용 폭 ${Math.round(measurements.contentWidth)}px 가 캔버스 ${limits.widthPx}px 를 넘었습니다.`,
    });
  }

  if (measurements.contentHeight > limits.maxHeightPx) {
    violations.push({
      rule: 'TOO_TALL',
      detail: `내용 높이 ${Math.round(measurements.contentHeight)}px 가 상한 ${limits.maxHeightPx}px 를 넘었습니다.`,
    });
  }

  return violations;
};
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm exec jest src/study-brief-cron/domain/study-diagram.checker.spec.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/study-brief-cron/domain/study-diagram.checker.ts src/study-brief-cron/domain/study-diagram.checker.spec.ts
git commit -m "feat(study-diagram): 그림 렌더 판정 순수 함수 — 글자 하한·가로 넘침·세로 상한"
```

---

### Task 2: codex 출력에서 HTML 꺼내기

codex가 돌려준 텍스트에서 그림 HTML만 골라낸다. 설명 산문이나 외부 리소스를 참조하는 HTML은 거부한다.

**Files:**
- Create: `src/study-brief-cron/domain/study-diagram.parser.ts`
- Test: `src/study-brief-cron/domain/study-diagram.parser.spec.ts`

**Interfaces:**
- Consumes: (없음)
- Produces:
  - `StudyDiagramParsed { html: string }`
  - `StudyDiagramRejected { rejectedReason: string }`
  - `parseStudyDiagram(raw: string): StudyDiagramParsed | StudyDiagramRejected`

**설계 메모:** 형제 파서인 `study-research.parser.ts`는 실패 시 예외를 던지지만, 이 파서는 **유니온을 반환한다.** 그림 실패는 파이프라인을 멈출 사유가 아니라 정상 분기이기 때문이다. 호출부는 `'rejectedReason' in result`로 갈라 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/study-brief-cron/domain/study-diagram.parser.spec.ts`:

```ts
import { parseStudyDiagram } from './study-diagram.parser';

const svgDocument = [
  '<!doctype html>',
  '<html><body style="margin:0">',
  '<svg viewBox="0 0 700 900" width="700" height="900">',
  '<text x="20" y="40" font-size="20">요청</text>',
  '</svg>',
  '</body></html>',
].join('\n');

describe('parseStudyDiagram', () => {
  it('html 코드펜스 안의 문서를 꺼낸다', () => {
    const result = parseStudyDiagram(
      '아래와 같이 그렸습니다.\n\n```html\n' + svgDocument + '\n```\n',
    );

    expect(result).toEqual({ html: svgDocument });
  });

  it('언어 표시가 없는 코드펜스도 받는다', () => {
    const result = parseStudyDiagram('```\n' + svgDocument + '\n```');

    expect(result).toEqual({ html: svgDocument });
  });

  it('진행 로그가 앞에 붙어도 코드펜스만 골라낸다', () => {
    const result = parseStudyDiagram(
      '[progress] drawing\n[progress] done\n```html\n' + svgDocument + '\n```',
    );

    expect(result).toEqual({ html: svgDocument });
  });

  it('코드펜스가 여러 개면 그림 문서인 쪽을 고른다', () => {
    const raw = [
      '설명 먼저 드리면,',
      '```text',
      '이 그림은 요청과 응답의 흐름을 보여줍니다.',
      '```',
      '실제 그림입니다.',
      '```html',
      svgDocument,
      '```',
    ].join('\n');

    expect(parseStudyDiagram(raw)).toEqual({ html: svgDocument });
  });

  it('코드펜스가 없으면 거부한다', () => {
    const result = parseStudyDiagram('그림을 그리지 못했습니다.');

    expect(result).toMatchObject({
      rejectedReason: expect.stringContaining('코드펜스'),
    });
  });

  it('펜스는 있지만 svg 도 html 도 없으면 거부한다', () => {
    const result = parseStudyDiagram('```html\n<p>설명만 있습니다</p>\n```');

    expect(result).toMatchObject({
      rejectedReason: expect.stringContaining('그림'),
    });
  });

  it.each([
    ['<img src="https://cdn.example/a.png">', 'https'],
    ['<script src="//cdn.example/b.js"></script>', '//'],
    ['<link rel="stylesheet" href="http://cdn.example/c.css">', 'http'],
  ])('외부 리소스(%s)를 참조하면 거부한다', (tag) => {
    const raw = '```html\n<html><body>' + tag + '<svg><text font-size="20">가</text></svg></body></html>\n```';

    const result = parseStudyDiagram(raw);

    expect(result).toMatchObject({
      rejectedReason: expect.stringContaining('외부'),
    });
  });

  it('data URI 는 외부 리소스로 보지 않는다', () => {
    const raw =
      '```html\n<html><body><img src="data:image/png;base64,iVBOR">' +
      '<svg><text font-size="20">가</text></svg></body></html>\n```';

    expect(parseStudyDiagram(raw)).toMatchObject({
      html: expect.stringContaining('data:image/png'),
    });
  });

  it('빈 문자열을 거부한다', () => {
    expect(parseStudyDiagram('   ')).toMatchObject({
      rejectedReason: expect.any(String),
    });
  });
});
```

"코드펜스가 여러 개면 그림 문서인 쪽을 고른다" 케이스가 핵심이다. 위치로 고르면(첫 번째/마지막) 설명 블록을 집어 든다. **내용으로 검증해 고른다.**

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm exec jest src/study-brief-cron/domain/study-diagram.parser.spec.ts`
Expected: FAIL — `Cannot find module './study-diagram.parser'`

- [ ] **Step 3: 구현한다**

`src/study-brief-cron/domain/study-diagram.parser.ts`:

```ts
export interface StudyDiagramParsed {
  html: string;
}

export interface StudyDiagramRejected {
  rejectedReason: string;
}

// 코드펜스 블록을 통째로 집어내는 패턴. 여는 줄의 언어 표시는 있어도 없어도 된다.
const FENCE_BLOCK = /```[a-z0-9_-]*\s*\r?\n([\s\S]*?)\r?\n?```/gi;
// 외부 호스트를 가리키는 src/href. data: 와 상대 경로는 여기 걸리지 않는다.
const EXTERNAL_RESOURCE = /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i;

export const parseStudyDiagram = (
  raw: string,
): StudyDiagramParsed | StudyDiagramRejected => {
  const candidates = collectFencedBlocks(raw);
  if (candidates.length === 0) {
    return {
      rejectedReason: '출력에 코드펜스 블록이 없습니다.',
    };
  }

  const drawings = candidates.filter(isDrawingDocument);
  if (drawings.length === 0) {
    return {
      rejectedReason:
        '코드펜스는 있으나 svg 나 html 문서로 보이는 그림이 없습니다.',
    };
  }

  // 그림이 여러 개면 마지막 것을 쓴다 — 모델이 고쳐 그린 경우 뒤쪽이 최종본이다.
  const html = drawings[drawings.length - 1];
  if (EXTERNAL_RESOURCE.test(html)) {
    return {
      rejectedReason:
        '외부 리소스를 참조합니다. 인라인 SVG·CSS 만 허용합니다.',
    };
  }

  return { html };
};

const collectFencedBlocks = (raw: string): string[] => {
  const blocks: string[] = [];
  for (const match of raw.matchAll(FENCE_BLOCK)) {
    const body = match[1].trim();
    if (body.length > 0) {
      blocks.push(body);
    }
  }
  return blocks;
};

const isDrawingDocument = (block: string): boolean =>
  /<svg[\s>]/i.test(block) || /<html[\s>]/i.test(block);
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm exec jest src/study-brief-cron/domain/study-diagram.parser.spec.ts`
Expected: PASS (10 tests — `it.each` 3건 포함)

- [ ] **Step 5: 커밋**

```bash
git add src/study-brief-cron/domain/study-diagram.parser.ts src/study-brief-cron/domain/study-diagram.parser.spec.ts
git commit -m "feat(study-diagram): codex 출력에서 그림 HTML 추출 — 내용으로 후보 검증, 외부 리소스 거부"
```

---

### Task 3: 프롬프트 (최초 · 재작업)

codex에게 그림을 시키는 문장을 만든다. 재작업 프롬프트는 지시를 **덧붙이지 않고 치환한다** — 원래 지시가 남아 있으면 충돌해서 무시되는 사례가 이 레포에 축적되어 있다.

**Files:**
- Create: `src/study-brief-cron/domain/study-diagram.prompt.ts`
- Test: `src/study-brief-cron/domain/study-diagram.prompt.spec.ts`

**Interfaces:**
- Consumes: `DiagramLimits`, `DiagramViolation` (Task 1)
- Produces:
  - `BuildStudyDiagramPromptInput { topic: string; kind: StudyResearchKind; reportMd: string; limits: DiagramLimits }`
  - `buildStudyDiagramPrompt(input: BuildStudyDiagramPromptInput): string`
  - `buildStudyDiagramRetryPrompt(input: BuildStudyDiagramPromptInput & { violations: DiagramViolation[] }): string`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/study-brief-cron/domain/study-diagram.prompt.spec.ts`:

```ts
import {
  buildStudyDiagramPrompt,
  buildStudyDiagramRetryPrompt,
} from './study-diagram.prompt';

const input = {
  topic: 'durable execution',
  kind: 'CONCEPT' as const,
  reportMd: '워크플로가 중단돼도 이어서 실행하는 방식이다.',
  limits: { widthPx: 700, minFontPx: 14, maxHeightPx: 1600 },
};

describe('buildStudyDiagramPrompt', () => {
  it('주제와 본문을 프롬프트에 싣는다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toContain('durable execution');
    expect(prompt).toContain('워크플로가 중단돼도');
  });

  it('수치를 변수 이름이 아니라 실제 값으로 박는다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toContain('700');
    expect(prompt).toContain('14');
    expect(prompt).toContain('1600');
    expect(prompt).not.toContain('STUDY_DIAGRAM_WIDTH_PX');
    expect(prompt).not.toContain('MIN_FONT');
  });

  it('외부 리소스 금지와 인라인 조건을 명시한다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toContain('인라인');
    expect(prompt).toMatch(/CDN|외부/);
  });

  it('SVG 의 width·height 를 viewBox 와 맞추라고 지시한다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toContain('viewBox');
  });

  it('출력 형식을 html 코드펜스 하나로 고정한다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toContain('```html');
  });

  it('공개 발행 대비 익명화 조건을 넣는다', () => {
    const prompt = buildStudyDiagramPrompt(input);

    expect(prompt).toMatch(/회사명|사내/);
  });
});

describe('buildStudyDiagramRetryPrompt', () => {
  const violations = [
    { rule: 'FONT_TOO_SMALL' as const, detail: '글자 하한 14px 미만: svg>text(9px)' },
  ];

  it('무엇이 왜 걸렸는지를 그대로 싣는다', () => {
    const prompt = buildStudyDiagramRetryPrompt({ ...input, violations });

    expect(prompt).toContain('svg>text(9px)');
  });

  it('원래 프롬프트의 주제와 본문은 그대로 유지한다', () => {
    const prompt = buildStudyDiagramRetryPrompt({ ...input, violations });

    expect(prompt).toContain('durable execution');
    expect(prompt).toContain('워크플로가 중단돼도');
  });

  it('직전 시도가 거부됐다는 사실을 알린다', () => {
    const prompt = buildStudyDiagramRetryPrompt({ ...input, violations });

    expect(prompt).toMatch(/거부|다시/);
  });

  it('위반이 여러 건이면 모두 싣는다', () => {
    const prompt = buildStudyDiagramRetryPrompt({
      ...input,
      violations: [
        ...violations,
        { rule: 'OVERFLOW_X' as const, detail: '내용 폭 812px 가 캔버스 700px 를 넘었습니다.' },
      ],
    });

    expect(prompt).toContain('812px');
    expect(prompt).toContain('9px');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm exec jest src/study-brief-cron/domain/study-diagram.prompt.spec.ts`
Expected: FAIL — `Cannot find module './study-diagram.prompt'`

- [ ] **Step 3: 구현한다**

`src/study-brief-cron/domain/study-diagram.prompt.ts`:

```ts
import { DiagramLimits, DiagramViolation } from './study-diagram.checker';
import { StudyResearchKind } from './study-research.parser';

export interface BuildStudyDiagramPromptInput {
  topic: string;
  kind: StudyResearchKind;
  reportMd: string;
  limits: DiagramLimits;
}

export interface BuildStudyDiagramRetryPromptInput
  extends BuildStudyDiagramPromptInput {
  violations: DiagramViolation[];
}

// 오늘의 공부 노션 페이지 맨 위에 붙일 그림 한 장을 그리게 하는 프롬프트.
//
// 캔버스 가로를 노션 본문 폭과 같게 잡는 것이 이 설계의 핵심이다. 더 넓게 그리면
// 노션이 액자에 맞춰 이미지를 통째로 축소하고, 그림 안 글자도 같은 비율로 줄어
// 읽을 수 없게 된다. 세로는 축소를 유발하지 않으므로 넉넉히 쓴다.
export const buildStudyDiagramPrompt = ({
  topic,
  kind,
  reportMd,
  limits,
}: BuildStudyDiagramPromptInput): string =>
  [
    '아래 주제를 그림 한 장으로 설명하는 HTML 문서를 써라.',
    '이 그림은 그 주제를 처음 보는 사람이 글을 읽기 전에 먼저 보는 자료다.',
    '',
    `[주제] ${topic} (${kind === 'CONCEPT' ? '개념' : '도구'})`,
    '',
    '[조사 본문 — 그림의 재료]',
    reportMd,
    '',
    ...buildCanvasRules(limits),
    '',
    ...buildDrawingRules(),
    '',
    ...buildOutputRules(),
  ].join('\n');

// 재작업 프롬프트. 원래 지시를 그대로 두고 사유만 덧붙이면, 충돌하는 지시가 남아
// 무시되는 경우가 있다. 위반한 항목의 지시문 자체를 수치와 함께 다시 쓴다.
export const buildStudyDiagramRetryPrompt = ({
  topic,
  kind,
  reportMd,
  limits,
  violations,
}: BuildStudyDiagramRetryPromptInput): string =>
  [
    '직전에 그린 그림이 기준 미달로 거부됐다. 같은 주제로 다시 그려라.',
    '',
    '[거부 사유 — 이번에는 반드시 피해야 하는 것]',
    ...violations.map((violation) => `- ${violation.detail}`),
    '',
    `[주제] ${topic} (${kind === 'CONCEPT' ? '개념' : '도구'})`,
    '',
    '[조사 본문 — 그림의 재료]',
    reportMd,
    '',
    ...buildCanvasRules(limits),
    '',
    ...buildDrawingRules(),
    '- 글자 수를 줄이고 도형을 키워라. 직전 실패는 대부분 글을 많이 넣어서 생긴다.',
    '',
    ...buildOutputRules(),
  ].join('\n');

const buildCanvasRules = (limits: DiagramLimits): string[] => [
  '[캔버스 — 어기면 자동으로 거부된다]',
  `- 가로는 정확히 ${limits.widthPx}px 다. 이 폭을 넘는 요소를 두지 마라.`,
  `- 세로는 ${limits.maxHeightPx}px 이내면 자유롭다. 세로로 흐르는 구성으로 짜도 된다.`,
  `- 모든 글자는 화면에서 ${limits.minFontPx}px 이상으로 보여야 한다. 하나라도 작으면 거부된다.`,
  '- SVG 의 width·height 속성을 viewBox 의 크기와 같은 값으로 둬라. 축소 변환이 끼면 글자가 기준보다 작아진다.',
];

const buildDrawingRules = (): string[] => [
  '[그림]',
  '- 설명의 뼈대는 도형·화살표·크기 대비가 진다. 글은 이름표 역할만 한다.',
  '- 문장을 넣지 마라. 낱말과 짧은 구로 쓴다.',
  '- 비유를 써도 좋다. 정확한 용어보다 그림이 먼저 이해되는 쪽을 고른다.',
  '- 색은 서너 개로 제한하고, 배경은 흰색으로 둔다.',
  '- 회사명·학교명·사내 시스템 이름·업무 데이터를 쓰지 마라.',
];

const buildOutputRules = (): string[] => [
  '[출력 — 문자 그대로 준수]',
  '- 인라인 SVG 와 인라인 CSS 만 쓴다. CDN·외부 폰트·외부 이미지·fetch 를 쓰면 거부된다.',
  '- 설명 문장을 붙이지 말고 코드펜스 하나만 출력한다.',
  '```html',
  '<!doctype html> ... </html>',
  '```',
];
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm exec jest src/study-brief-cron/domain/study-diagram.prompt.spec.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/study-brief-cron/domain/study-diagram.prompt.ts src/study-brief-cron/domain/study-diagram.prompt.spec.ts
git commit -m "feat(study-diagram): 그림 생성·재작업 프롬프트 — 재작업은 지시 치환 방식"
```

---

### Task 4: 노션에 이미지 넣기 (블록 타입 + 파일 업로드)

노션 페이지에 PNG를 붙이는 두 조각을 함께 만든다. 블록 타입만 있으면 붙일 파일이 없고, 업로드만 있으면 붙일 자리가 없다.

**Files:**
- Modify: `src/notion/domain/port/notion-client.port.ts` (`NotionPlanBlock` 유니온에 `image` 추가)
- Modify: `src/notion/infrastructure/notion-api.client.ts:827-891` (`toNotionBlock` 에 분기 추가)
- Create: `src/notion/domain/port/notion-file-upload.port.ts`
- Create: `src/notion/infrastructure/notion-file-upload.client.ts`
- Test: `src/notion/infrastructure/notion-file-upload.client.spec.ts`
- Test: `src/notion/infrastructure/notion-api.client.spec.ts` (기존 파일에 image 케이스 추가 — 없으면 생성)

**Interfaces:**
- Consumes: (없음)
- Produces:
  - `NotionPlanBlock` 에 `{ type: 'image'; fileUploadId: string }` 추가
  - `NOTION_FILE_UPLOAD_PORT` 심볼
  - `UploadNotionImageInput { filename: string; png: Buffer }`
  - `NotionFileUploadPort { uploadImage(input: UploadNotionImageInput): Promise<string> }` — 반환값은 `file_upload` id

**주의:** `toNotionBlock` 은 `ts-pattern` 의 `.exhaustive()` 를 쓴다. 유니온에 `image` 를 추가하면 분기를 넣기 전까지 **컴파일이 깨진다.** 이건 안전장치이지 오류가 아니다.

**주의 2:** `image` 는 텍스트 블록이 아니므로 `NotionTextBlock` 교차 타입에 넣지 않는다. `divider` 와 같은 자리에 둔다.

- [ ] **Step 1: 업로드 클라이언트의 실패하는 테스트를 쓴다**

`src/notion/infrastructure/notion-file-upload.client.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';

import { NotionFileUploadClient } from './notion-file-upload.client';

const buildConfigService = (
  values: Record<string, string | undefined>,
): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('NotionFileUploadClient', () => {
  const png = Buffer.from('fake-png-bytes');
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const okJson = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;

  it('생성 → 전송 두 단계를 거쳐 file_upload id 를 돌려준다', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ id: 'upload-1', upload_url: 'https://upload.example/put' }))
      .mockResolvedValueOnce(okJson({ id: 'upload-1', status: 'uploaded' }));
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    const fileUploadId = await client.uploadImage({
      filename: 'diagram.png',
      png,
    });

    expect(fileUploadId).toBe('upload-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('첫 호출은 filename 과 content_type 을 보낸다', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ id: 'upload-2', upload_url: 'https://upload.example/put' }))
      .mockResolvedValueOnce(okJson({ status: 'uploaded' }));
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await client.uploadImage({ filename: 'diagram.png', png });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.notion.com/v1/file_uploads');
    expect(JSON.parse(init.body)).toEqual({
      filename: 'diagram.png',
      content_type: 'image/png',
    });
  });

  it('모든 호출에 인증과 Notion-Version 헤더를 붙인다', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ id: 'upload-3', upload_url: 'https://upload.example/put' }))
      .mockResolvedValueOnce(okJson({ status: 'uploaded' }));
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await client.uploadImage({ filename: 'diagram.png', png });

    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers.Authorization).toBe('Bearer secret-token');
      expect(init.headers['Notion-Version']).toEqual(expect.any(String));
    }
  });

  it('전송 단계는 multipart 로 보내고 JSON Content-Type 을 붙이지 않는다', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ id: 'upload-4', upload_url: 'https://upload.example/put' }))
      .mockResolvedValueOnce(okJson({ status: 'uploaded' }));
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await client.uploadImage({ filename: 'diagram.png', png });

    const [, sendInit] = fetchMock.mock.calls[1];
    expect(sendInit.body).toBeInstanceOf(FormData);
    expect(sendInit.headers['Content-Type']).toBeUndefined();
  });

  it('NOTION_TOKEN 이 없으면 호출 전에 끊는다', async () => {
    const client = new NotionFileUploadClient(buildConfigService({}));

    await expect(
      client.uploadImage({ filename: 'diagram.png', png }),
    ).rejects.toThrow(/NOTION_TOKEN/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('생성 단계가 실패하면 상태코드와 본문을 담아 던진다', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"message":"bad request"}',
    } as unknown as Response);
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await expect(
      client.uploadImage({ filename: 'diagram.png', png }),
    ).rejects.toThrow(/400/);
  });

  it('전송 단계가 실패하면 던진다', async () => {
    fetchMock
      .mockResolvedValueOnce(okJson({ id: 'upload-5', upload_url: 'https://upload.example/put' }))
      .mockResolvedValueOnce({
        ok: false,
        status: 413,
        text: async () => 'too large',
      } as unknown as Response);
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await expect(
      client.uploadImage({ filename: 'diagram.png', png }),
    ).rejects.toThrow(/413/);
  });

  it('id 없이 성공 응답이 오면 던진다', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ upload_url: 'https://upload.example/put' }));
    const client = new NotionFileUploadClient(
      buildConfigService({ NOTION_TOKEN: 'secret-token' }),
    );

    await expect(
      client.uploadImage({ filename: 'diagram.png', png }),
    ).rejects.toThrow(/id/);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm exec jest src/notion/infrastructure/notion-file-upload.client.spec.ts`
Expected: FAIL — `Cannot find module './notion-file-upload.client'`

- [ ] **Step 3: 포트를 만든다**

`src/notion/domain/port/notion-file-upload.port.ts`:

```ts
export const NOTION_FILE_UPLOAD_PORT = Symbol('NOTION_FILE_UPLOAD_PORT');

export interface UploadNotionImageInput {
  filename: string;
  png: Buffer;
}

export interface NotionFileUploadPort {
  // 반환값은 Notion file_upload id. 1시간 안에 블록에 첨부하지 않으면 자동 폐기된다.
  uploadImage(input: UploadNotionImageInput): Promise<string>;
}
```

- [ ] **Step 4: 업로드 클라이언트를 구현한다**

`src/notion/infrastructure/notion-file-upload.client.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  NotionFileUploadPort,
  UploadNotionImageInput,
} from '../domain/port/notion-file-upload.port';

const FILE_UPLOAD_ENDPOINT = 'https://api.notion.com/v1/file_uploads';
// SDK(@notionhq/client@2.3.0) 가 보내는 버전은 파일 업로드를 지원하지 않을 수 있어
// 이 경로에만 별도로 명시한다. 실제 최소 지원 버전은 실호출로 확인했다.
const FILE_UPLOAD_NOTION_VERSION = '2022-06-28';
const CONTENT_TYPE_PNG = 'image/png';

interface CreatedFileUpload {
  id: string;
}

@Injectable()
export class NotionFileUploadClient implements NotionFileUploadPort {
  constructor(private readonly configService: ConfigService) {}

  async uploadImage({ filename, png }: UploadNotionImageInput): Promise<string> {
    const token = this.configService.get<string>('NOTION_TOKEN')?.trim();
    if (!token) {
      throw new Error('NOTION_TOKEN 이 설정되지 않아 파일을 올릴 수 없습니다.');
    }

    const created = await this.createFileUpload({ token, filename });
    await this.sendFileContent({ token, fileUploadId: created.id, filename, png });
    return created.id;
  }

  private async createFileUpload({
    token,
    filename,
  }: {
    token: string;
    filename: string;
  }): Promise<CreatedFileUpload> {
    const response = await fetch(FILE_UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': FILE_UPLOAD_NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filename, content_type: CONTENT_TYPE_PNG }),
    });
    await assertOk(response, '파일 업로드 객체 생성');

    const body = (await response.json()) as Partial<CreatedFileUpload>;
    if (!body.id) {
      throw new Error(
        '파일 업로드 응답에 id 가 없습니다. Notion-Version 이 파일 업로드를 지원하는지 확인이 필요합니다.',
      );
    }
    return { id: body.id };
  }

  private async sendFileContent({
    token,
    fileUploadId,
    filename,
    png,
  }: {
    token: string;
    fileUploadId: string;
    filename: string;
    png: Buffer;
  }): Promise<void> {
    const form = new FormData();
    form.append('file', new Blob([png], { type: CONTENT_TYPE_PNG }), filename);

    const response = await fetch(
      `${FILE_UPLOAD_ENDPOINT}/${fileUploadId}/send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': FILE_UPLOAD_NOTION_VERSION,
          // Content-Type 을 직접 넣지 않는다. multipart 경계 문자열은 런타임이 붙인다.
        },
        body: form,
      },
    );
    await assertOk(response, '파일 내용 전송');
  }
}

const assertOk = async (response: Response, stage: string): Promise<void> => {
  if (response.ok) {
    return;
  }
  const detail = await response.text().catch(() => '(본문 읽기 실패)');
  throw new Error(`Notion ${stage} 실패 (status=${response.status}): ${detail}`);
};
```

- [ ] **Step 5: 통과를 확인한다**

Run: `pnpm exec jest src/notion/infrastructure/notion-file-upload.client.spec.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: 블록 타입을 추가하고 컴파일이 깨지는지 확인한다**

`src/notion/domain/port/notion-client.port.ts` 의 `NotionPlanBlock` 유니온 끝, `{ type: 'divider' }` 옆에 추가한다:

```ts
  | { type: 'divider' }
  // 이미지는 텍스트 블록이 아니다 — NotionTextBlock 교차 타입에 넣지 않는다.
  // fileUploadId 는 NotionFileUploadPort.uploadImage 가 돌려준 값이다.
  | { type: 'image'; fileUploadId: string };
```

Run: `pnpm build`
Expected: FAIL — `toNotionBlock` 의 `.exhaustive()` 가 `image` 를 처리하지 않는다는 타입 에러. **이건 의도된 안전장치다.**

- [ ] **Step 7: 변환 분기를 추가한다**

`src/notion/infrastructure/notion-api.client.ts` 의 `toNotionBlock` 에서 `.with({ type: 'divider' }, ...)` 바로 아래에 넣는다:

```ts
    .with({ type: 'image' }, ({ fileUploadId }) => ({
      object: 'block',
      type: 'image',
      image: {
        type: 'file_upload',
        file_upload: { id: fileUploadId },
      },
    }))
```

- [ ] **Step 8: 변환 테스트를 추가한다**

`src/notion/infrastructure/notion-api.client.spec.ts` 는 이미 있다. **그 파일의 `NotionApiClient` 생성 방식과 mock 구성을 그대로 재사용해** 케이스만 추가한다. `toNotionBlock` 은 모듈 밖으로 노출되지 않으므로 `createDatabasePage` 를 통해 확인한다:

```ts
it('image 블록을 file_upload 참조로 변환한다', async () => {
  const create = jest.fn().mockResolvedValue({
    id: 'page-1',
    url: 'https://notion.so/page-1',
    properties: {},
  });
  const client = new NotionApiClient(
    { pages: { create } } as never,
    { get: () => undefined } as never,
  );

  await client.createDatabasePage({
    databaseId: 'db-1',
    properties: {},
    blocks: [{ type: 'image', fileUploadId: 'upload-1' }],
  });

  expect(create.mock.calls[0][0].children[0]).toEqual({
    object: 'block',
    type: 'image',
    image: { type: 'file_upload', file_upload: { id: 'upload-1' } },
  });
});
```

위 코드의 client 생성 부분은 형태 예시다. **실제로는 기존 파일 상단의 헬퍼를 그대로 쓴다** — 새 방식을 들이지 않는다.

- [ ] **Step 9: 전체 검증**

Run: `pnpm exec jest src/notion && pnpm build`
Expected: PASS · 빌드 성공

- [ ] **Step 10: 커밋**

```bash
git add src/notion/domain/port/notion-file-upload.port.ts src/notion/infrastructure/notion-file-upload.client.ts src/notion/infrastructure/notion-file-upload.client.spec.ts src/notion/domain/port/notion-client.port.ts src/notion/infrastructure/notion-api.client.ts src/notion/infrastructure/notion-api.client.spec.ts
git commit -m "feat(notion): 이미지 블록 타입 + 파일 업로드 클라이언트 — SDK 미지원분만 raw fetch"
```

---

### Task 5: 렌더러 — 띄우고, 재고, 찍는다

HTML을 puppeteer로 띄워 측정값을 뽑고 PNG를 찍는다. **브라우저를 직접 띄우는 코드이므로 spec을 붙이지 않는다**(이 레포 관행 — `crawler.requester.ts`에 spec 없음). 대신 판정은 Task 1의 순수 함수에 위임한다.

**Files:**
- Create: `src/study-brief-cron/domain/port/study-diagram-renderer.port.ts`
- Create: `src/study-brief-cron/infrastructure/study-diagram.renderer.ts`

**Interfaces:**
- Consumes: `DiagramLimits`, `DiagramMeasurements`, `DiagramViolation`, `findDiagramViolations` (Task 1)
- Produces:
  - `STUDY_DIAGRAM_RENDERER_PORT` 심볼
  - `RenderDiagramInput { html: string; limits: DiagramLimits }`
  - `RenderedDiagram { png: Buffer; violations: DiagramViolation[] }` — `violations` 가 비어 있어야 쓸 수 있는 그림이다
  - `StudyDiagramRendererPort { render(input: RenderDiagramInput): Promise<RenderedDiagram> }`

**설계 메모:** 위반이 있어도 PNG는 함께 돌려준다. 호출부가 버리면 그만이고, Task 8의 수동 확인에서 **"왜 걸렸는지"를 눈으로 보려면 실패한 그림도 파일로 남겨야** 하기 때문이다.

- [ ] **Step 1: 포트를 만든다**

`src/study-brief-cron/domain/port/study-diagram-renderer.port.ts`:

```ts
import { DiagramLimits, DiagramViolation } from '../study-diagram.checker';

export const STUDY_DIAGRAM_RENDERER_PORT = Symbol(
  'STUDY_DIAGRAM_RENDERER_PORT',
);

export interface RenderDiagramInput {
  html: string;
  limits: DiagramLimits;
}

export interface RenderedDiagram {
  png: Buffer;
  // 비어 있어야 쓸 수 있는 그림이다. 위반이 있어도 png 는 함께 온다 — 수동 확인 때 눈으로 보려면 필요하다.
  violations: DiagramViolation[];
}

export interface StudyDiagramRendererPort {
  render(input: RenderDiagramInput): Promise<RenderedDiagram>;
}
```

- [ ] **Step 2: 렌더러를 구현한다**

`src/study-brief-cron/infrastructure/study-diagram.renderer.ts`:

```ts
import { Injectable } from '@nestjs/common';
import puppeteer, { Browser, Page } from 'puppeteer';

import {
  RenderDiagramInput,
  RenderedDiagram,
  StudyDiagramRendererPort,
} from '../domain/port/study-diagram-renderer.port';
import {
  DiagramMeasurements,
  findDiagramViolations,
} from '../domain/study-diagram.checker';

// 외부 리소스를 쓰지 않는 문서만 들어오므로(파서가 거른다) 네트워크를 기다릴 이유가 없다.
const CONTENT_TIMEOUT_MS = 15_000;
// 논리 폭은 노션 본문 폭과 같게 두고, 물리 픽셀만 2배로 올린다.
// 이렇게 해야 노션에서 축소가 일어나지 않으면서 확대 시 선명하다.
const DEVICE_SCALE_FACTOR = 2;
const INITIAL_VIEWPORT_HEIGHT = 800;

@Injectable()
export class StudyDiagramRenderer implements StudyDiagramRendererPort {
  async render({ html, limits }: RenderDiagramInput): Promise<RenderedDiagram> {
    let browser: Browser | undefined;
    let page: Page | undefined;

    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      page = await browser.newPage();
      await page.setViewport({
        width: limits.widthPx,
        height: INITIAL_VIEWPORT_HEIGHT,
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
      });
      await page.setContent(html, {
        waitUntil: 'load',
        timeout: CONTENT_TIMEOUT_MS,
      });

      const measurements = await measureDocument(page);
      const screenshot = await page.screenshot({ fullPage: true, type: 'png' });

      return {
        png: Buffer.from(screenshot),
        violations: findDiagramViolations(measurements, limits),
      };
    } finally {
      await closeQuietly(page, browser);
    }
  }
}

const measureDocument = async (page: Page): Promise<DiagramMeasurements> =>
  page.evaluate(() => {
    // 글자를 실제로 들고 있는 리프 요소만 잰다. 부모 컨테이너까지 세면
    // 같은 글자를 여러 번 세게 되고, 컨테이너 높이가 글자 크기로 둔갑한다.
    const leaves = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(
      (element) => {
        if (element.children.length > 0) {
          return false;
        }
        return (element.textContent ?? '').trim().length > 0;
      },
    );

    const texts = leaves.map((element) => {
      const rect = element.getBoundingClientRect();
      const content = (element.textContent ?? '').trim().slice(0, 20);
      return {
        label: `${element.tagName.toLowerCase()} "${content}"`,
        // CSS font-size 가 아니라 실제 렌더 높이를 쓴다.
        // SVG viewBox 스케일이 걸리면 두 값이 어긋나고, 눈에 보이는 것은 이쪽이다.
        renderedFontPx: rect.height,
      };
    });

    // 오른쪽 끝이 가장 먼 요소로 실제 내용 폭을 잡는다.
    // scrollWidth 는 넘친 요소를 반영하지 못하는 경우가 있다.
    const rightMost = Array.from(document.querySelectorAll<HTMLElement>('*')).reduce(
      (maxRight, element) =>
        Math.max(maxRight, element.getBoundingClientRect().right),
      0,
    );

    return {
      texts,
      contentWidth: Math.max(rightMost, document.documentElement.scrollWidth),
      contentHeight: document.documentElement.scrollHeight,
    };
  });

// 정리 실패가 본 작업의 성공을 무효화하지 않게 한다 — crawler.requester.ts 와 같은 방침.
const closeQuietly = async (
  page: Page | undefined,
  browser: Browser | undefined,
): Promise<void> => {
  try {
    if (page) {
      await page.close();
    }
  } catch {
    // 페이지 정리 실패는 무시한다. 브라우저를 닫으면 함께 정리된다.
  }
  try {
    if (browser) {
      await browser.close();
    }
  } catch {
    // 브라우저 정리 실패도 무시한다. 프로세스 종료 시 회수된다.
  }
};
```

- [ ] **Step 3: 컴파일과 린트를 확인한다**

Run: `pnpm lint:check && pnpm build`
Expected: 둘 다 성공

- [ ] **Step 4: 커밋**

```bash
git add src/study-brief-cron/domain/port/study-diagram-renderer.port.ts src/study-brief-cron/infrastructure/study-diagram.renderer.ts
git commit -m "feat(study-diagram): puppeteer 렌더러 — 논리 폭 고정·2배 촬영, 측정은 렌더 사각형 기준"
```

---

### Task 6: 생성 오케스트레이션 (재작업 1회 포함)

codex 호출 → 파싱 → 렌더 → 위반이 있으면 사유를 넣어 한 번 더. 두 번째도 걸리면 `null`.

**Files:**
- Create: `src/study-brief-cron/application/generate-study-diagram.usecase.ts`
- Test: `src/study-brief-cron/application/generate-study-diagram.usecase.spec.ts`

**Interfaces:**
- Consumes: `HERMES_RUNNER_PORT`/`HermesRunnerPort`, `parseStudyDiagram`(Task 2), `buildStudyDiagramPrompt`·`buildStudyDiagramRetryPrompt`(Task 3), `STUDY_DIAGRAM_RENDERER_PORT`/`StudyDiagramRendererPort`(Task 5)
- Produces:
  - `GenerateStudyDiagramInput { topic: string; kind: StudyResearchKind; reportMd: string }`
  - `GenerateStudyDiagramOptions { keepRejected?: boolean }`
  - `GeneratedStudyDiagram { png: Buffer; html: string; violations: DiagramViolation[] }` — 통과한 그림은 `violations` 가 빈 배열
  - `GenerateStudyDiagramUsecase.execute(input, options?): Promise<GeneratedStudyDiagram | null>` — 실패는 예외가 아니라 `null`

**`keepRejected` 가 있는 이유:** cron 경로는 기준 미달 그림을 받을 이유가 없어 `null` 이면 충분하다. 하지만 Task 8의 수동 확인에서는 **걸린 그림을 눈으로 봐야** 프롬프트를 어떻게 고칠지 판단할 수 있다. 사유 텍스트만으로는 느리다. 기본값은 꺼짐이라 cron 동작은 달라지지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/study-brief-cron/application/generate-study-diagram.usecase.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';

import { GenerateStudyDiagramUsecase } from './generate-study-diagram.usecase';

const drawing = '<html><body><svg><text font-size="20">가</text></svg></body></html>';
const fencedDrawing = '```html\n' + drawing + '\n```';
const png = Buffer.from('png-bytes');

const buildConfigService = (
  values: Record<string, string | undefined> = { STUDY_DIAGRAM_ENABLED: 'true' },
): ConfigService => ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const buildUsecase = ({
  runner,
  renderer,
  configService = buildConfigService(),
}: {
  runner: { run: jest.Mock };
  renderer: { render: jest.Mock };
  configService?: ConfigService;
}): GenerateStudyDiagramUsecase =>
  new GenerateStudyDiagramUsecase(
    runner as never,
    renderer as never,
    configService,
  );

const input = {
  topic: 'durable execution',
  kind: 'CONCEPT' as const,
  reportMd: '본문',
};

describe('GenerateStudyDiagramUsecase', () => {
  it('한 번에 통과하면 png 를 돌려주고 재작업하지 않는다', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }) };
    const renderer = { render: jest.fn().mockResolvedValue({ png, violations: [] }) };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toEqual({ png, html: drawing, violations: [] });
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('위반이 있으면 사유를 넣어 한 번 더 그리게 한다', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }) };
    const renderer = {
      render: jest
        .fn()
        .mockResolvedValueOnce({
          png,
          violations: [{ rule: 'FONT_TOO_SMALL', detail: '글자 하한 14px 미만: text(9px)' }],
        })
        .mockResolvedValueOnce({ png, violations: [] }),
    };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toEqual({ png, html: drawing, violations: [] });
    expect(runner.run).toHaveBeenCalledTimes(2);
    expect(runner.run.mock.calls[1][0]).toContain('text(9px)');
  });

  it('두 번째도 위반이면 null 을 돌려주고 세 번째는 시도하지 않는다', async () => {
    const violations = [{ rule: 'OVERFLOW_X', detail: '내용 폭 812px' }];
    const runner = { run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }) };
    const renderer = { render: jest.fn().mockResolvedValue({ png, violations }) };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toBeNull();
    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('keepRejected 면 거부된 그림도 위반과 함께 돌려준다', async () => {
    const violations = [{ rule: 'OVERFLOW_X', detail: '내용 폭 812px' }];
    const runner = { run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }) };
    const renderer = { render: jest.fn().mockResolvedValue({ png, violations }) };

    const result = await buildUsecase({ runner, renderer }).execute(input, {
      keepRejected: true,
    });

    expect(result).toEqual({ png, html: drawing, violations });
  });

  it('keepRejected 라도 호출·파싱 실패는 null 이다 — 보여줄 그림 자체가 없다', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ stdout: '못 그렸습니다' }) };
    const renderer = { render: jest.fn() };

    const result = await buildUsecase({ runner, renderer }).execute(input, {
      keepRejected: true,
    });

    expect(result).toBeNull();
  });

  it('codex 호출이 실패하면 재시도 없이 null 이다', async () => {
    const runner = { run: jest.fn().mockRejectedValue(new Error('quota exhausted')) };
    const renderer = { render: jest.fn() };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toBeNull();
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('HTML 파싱에 실패하면 재작업 없이 null 이다', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ stdout: '그리지 못했습니다' }) };
    const renderer = { render: jest.fn() };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toBeNull();
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('렌더가 예외를 던지면 null 이다', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }) };
    const renderer = { render: jest.fn().mockRejectedValue(new Error('browser crashed')) };

    const result = await buildUsecase({ runner, renderer }).execute(input);

    expect(result).toBeNull();
  });

  it('STUDY_DIAGRAM_ENABLED 가 꺼져 있으면 codex 를 부르지 않는다', async () => {
    const runner = { run: jest.fn() };
    const renderer = { render: jest.fn() };

    const result = await buildUsecase({
      runner,
      renderer,
      configService: buildConfigService({ STUDY_DIAGRAM_ENABLED: 'false' }),
    }).execute(input);

    expect(result).toBeNull();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('STUDY_DIAGRAM_ENABLED 가 아예 없으면 꺼진 것으로 본다', async () => {
    const runner = { run: jest.fn() };
    const renderer = { render: jest.fn() };

    const result = await buildUsecase({
      runner,
      renderer,
      configService: buildConfigService({}),
    }).execute(input);

    expect(result).toBeNull();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it('설정한 한계값을 렌더러에 그대로 넘긴다', async () => {
    const runner = { run: jest.fn().mockResolvedValue({ stdout: fencedDrawing }) };
    const renderer = { render: jest.fn().mockResolvedValue({ png, violations: [] }) };

    await buildUsecase({
      runner,
      renderer,
      configService: buildConfigService({
        STUDY_DIAGRAM_ENABLED: 'true',
        STUDY_DIAGRAM_WIDTH_PX: '640',
        STUDY_DIAGRAM_MIN_FONT_PX: '16',
        STUDY_DIAGRAM_MAX_HEIGHT_PX: '1200',
      }),
    }).execute(input);

    expect(renderer.render).toHaveBeenCalledWith({
      html: drawing,
      limits: { widthPx: 640, minFontPx: 16, maxHeightPx: 1200 },
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm exec jest src/study-brief-cron/application/generate-study-diagram.usecase.spec.ts`
Expected: FAIL — `Cannot find module './generate-study-diagram.usecase'`

- [ ] **Step 3: 구현한다**

`src/study-brief-cron/application/generate-study-diagram.usecase.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  HERMES_RUNNER_PORT,
  HermesRunnerPort,
} from '../../agent/blog/domain/port/hermes-runner.port';
import {
  STUDY_DIAGRAM_RENDERER_PORT,
  StudyDiagramRendererPort,
} from '../domain/port/study-diagram-renderer.port';
import {
  DiagramLimits,
  DiagramViolation,
} from '../domain/study-diagram.checker';
import { parseStudyDiagram } from '../domain/study-diagram.parser';
import {
  buildStudyDiagramPrompt,
  buildStudyDiagramRetryPrompt,
} from '../domain/study-diagram.prompt';
import { StudyResearchKind } from '../domain/study-research.parser';

const DEFAULT_WIDTH_PX = 700;
const DEFAULT_MIN_FONT_PX = 14;
const DEFAULT_MAX_HEIGHT_PX = 1600;

export interface GenerateStudyDiagramInput {
  topic: string;
  kind: StudyResearchKind;
  reportMd: string;
}

export interface GenerateStudyDiagramOptions {
  // 기준 미달로 거부된 그림도 돌려준다. 수동 확인(scripts/study-diagram.ts) 전용이며
  // cron 경로는 쓰지 않는다 — 기본값이 꺼짐이라 자동 동작은 달라지지 않는다.
  keepRejected?: boolean;
}

export interface GeneratedStudyDiagram {
  png: Buffer;
  html: string;
  // 통과한 그림은 빈 배열이다. keepRejected 로 받은 그림에만 값이 있다.
  violations: DiagramViolation[];
}

// 그림은 페이지를 막을 이유가 아니다. 어느 단계에서 실패하든 예외를 밖으로 던지지 않고
// null 을 돌려주며, 왜 포기했는지는 로그에 남긴다. 조용한 0건은 에러보다 오래 산다.
@Injectable()
export class GenerateStudyDiagramUsecase {
  private readonly logger = new Logger(GenerateStudyDiagramUsecase.name);

  constructor(
    @Inject(HERMES_RUNNER_PORT)
    private readonly hermesRunner: HermesRunnerPort,
    @Inject(STUDY_DIAGRAM_RENDERER_PORT)
    private readonly renderer: StudyDiagramRendererPort,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    input: GenerateStudyDiagramInput,
    options: GenerateStudyDiagramOptions = {},
  ): Promise<GeneratedStudyDiagram | null> {
    if (!this.isEnabled()) {
      return null;
    }

    const limits = this.resolveLimits();
    const first = await this.attempt(
      buildStudyDiagramPrompt({ ...input, limits }),
      limits,
    );
    if (first === null) {
      return null;
    }
    if (first.violations.length === 0) {
      return toGenerated(first);
    }

    this.logger.log(
      `Study 그림 1차 거부 — 재작업 1회 시도: ${describeViolations(first.violations)}`,
    );
    const second = await this.attempt(
      buildStudyDiagramRetryPrompt({
        ...input,
        limits,
        violations: first.violations,
      }),
      limits,
    );
    if (second === null) {
      return options.keepRejected === true ? toGenerated(first) : null;
    }
    if (second.violations.length > 0) {
      this.logger.warn(
        `Study 그림 재작업도 거부 — 그림 없이 발행: ${describeViolations(second.violations)}`,
      );
      return options.keepRejected === true ? toGenerated(second) : null;
    }
    return toGenerated(second);
  }

  private isEnabled(): boolean {
    return (
      this.configService.get<string>('STUDY_DIAGRAM_ENABLED')?.trim() === 'true'
    );
  }

  private resolveLimits(): DiagramLimits {
    return {
      widthPx: this.readNumber('STUDY_DIAGRAM_WIDTH_PX', DEFAULT_WIDTH_PX),
      minFontPx: this.readNumber(
        'STUDY_DIAGRAM_MIN_FONT_PX',
        DEFAULT_MIN_FONT_PX,
      ),
      maxHeightPx: this.readNumber(
        'STUDY_DIAGRAM_MAX_HEIGHT_PX',
        DEFAULT_MAX_HEIGHT_PX,
      ),
    };
  }

  private readNumber(key: string, fallback: number): number {
    const raw = this.configService.get<string>(key)?.trim();
    if (!raw) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      this.logger.warn(`${key} 값이 올바르지 않아 기본값 ${fallback} 을 씁니다: ${raw}`);
      return fallback;
    }
    return parsed;
  }

  private async attempt(
    prompt: string,
    limits: DiagramLimits,
  ): Promise<AttemptResult | null> {
    let stdout: string;
    try {
      // codex 호출 실패는 재시도하지 않는다 — 쿼터 소진 한 건이 뒤 일정까지 무너뜨린 전례가 있다.
      const result = await this.hermesRunner.run(prompt);
      stdout = result.stdout;
    } catch (error: unknown) {
      this.logger.warn(`Study 그림 생성 호출 실패 — 그림 생략: ${formatError(error)}`);
      return null;
    }

    const parsed = parseStudyDiagram(stdout);
    if ('rejectedReason' in parsed) {
      this.logger.warn(`Study 그림 출력 거부 — 그림 생략: ${parsed.rejectedReason}`);
      return null;
    }

    try {
      const rendered = await this.renderer.render({ html: parsed.html, limits });
      return {
        png: rendered.png,
        html: parsed.html,
        violations: rendered.violations,
      };
    } catch (error: unknown) {
      this.logger.warn(`Study 그림 렌더 실패 — 그림 생략: ${formatError(error)}`);
      return null;
    }
  }
}

interface AttemptResult {
  png: Buffer;
  html: string;
  violations: DiagramViolation[];
}

const toGenerated = ({
  png,
  html,
  violations,
}: AttemptResult): GeneratedStudyDiagram => ({ png, html, violations });

const describeViolations = (violations: DiagramViolation[]): string =>
  violations.map((violation) => violation.detail).join(' / ');

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
```

- [ ] **Step 4: 통과를 확인한다**

Run: `pnpm exec jest src/study-brief-cron/application/generate-study-diagram.usecase.spec.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/study-brief-cron/application/generate-study-diagram.usecase.ts src/study-brief-cron/application/generate-study-diagram.usecase.spec.ts
git commit -m "feat(study-diagram): 생성 오케스트레이션 — 검사 실패 시 사유 되먹여 재작업 1회, 실패는 null"
```

---

### Task 7: 파이프라인 배선 (퍼블리셔 · consumer · 모듈 · 환경변수)

만든 조각들을 09:30 흐름에 끼운다. 여기까지 마치면 기능이 실제로 돈다.

**Files:**
- Modify: `src/study-brief-cron/domain/port/study-brief-publisher.port.ts` (`PublishStudyBriefInput` 에 선택 필드 추가)
- Modify: `src/study-brief-cron/infrastructure/study-brief-notion.publisher.ts:92-104` (`buildPageBlocks`)
- Modify: `src/study-brief-cron/infrastructure/study-brief-cron.consumer.ts:182-198` (④ 단계 삽입)
- Create: `src/study-brief-cron/study-diagram.module.ts` (그림 전용 경량 모듈)
- Modify: `src/study-brief-cron/study-brief-cron.module.ts` (`imports` 에 `StudyDiagramModule` 추가)
- Modify: `src/config/app.config.ts` (환경변수 4건)
- Modify: `.env.example` · `.env` · `README.md` · `docs/env-catalog.md`
- Test: `src/study-brief-cron/infrastructure/study-brief-notion.publisher.spec.ts` (기존 파일 확장)
- Test: `src/study-brief-cron/infrastructure/study-brief-cron.consumer.spec.ts` (기존 파일 확장)

**Interfaces:**
- Consumes: `GenerateStudyDiagramUsecase`(Task 6), `NOTION_FILE_UPLOAD_PORT`(Task 4), `STUDY_DIAGRAM_RENDERER_PORT`(Task 5)
- Produces: `PublishStudyBriefInput.diagramFileUploadId?: string`

- [ ] **Step 1: 퍼블리셔의 실패하는 테스트를 쓴다**

`src/study-brief-cron/infrastructure/study-brief-notion.publisher.spec.ts` 에 추가한다. 이 파일에는 이미 `buildNotionClient()` · `buildConfig()` · `buildLargeInput()` 헬퍼가 있다. **그 헬퍼들을 그대로 쓰고** 새 픽스처를 만들지 않는다. `createDatabasePage` mock 은 `buildNotionClient()` 가 돌려주는 객체의 필드다:

```ts
it('diagramFileUploadId 가 있으면 콜아웃 다음·본문 앞에 image 블록을 넣는다', async () => {
  // (기존 spec 의 publisher/notionClient 구성 방식을 그대로 사용)
  await publisher.publish({
    ...baseInput,
    diagramFileUploadId: 'upload-1',
  });

  const blocks = createDatabasePage.mock.calls[0][0].blocks;
  const imageIndex = blocks.findIndex((block) => block.type === 'image');
  const firstDividerIndex = blocks.findIndex((block) => block.type === 'divider');

  expect(blocks[imageIndex]).toEqual({ type: 'image', fileUploadId: 'upload-1' });
  expect(imageIndex).toBeLessThan(firstDividerIndex);
  expect(blocks[0].type).toBe('callout');
});

it('diagramFileUploadId 가 없으면 image 블록을 넣지 않는다', async () => {
  await publisher.publish(baseInput);

  const blocks = createDatabasePage.mock.calls[0][0].blocks;

  expect(blocks.some((block) => block.type === 'image')).toBe(false);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm exec jest src/study-brief-cron/infrastructure/study-brief-notion.publisher.spec.ts`
Expected: FAIL — image 블록이 없다

- [ ] **Step 3: 포트와 퍼블리셔를 고친다**

`study-brief-publisher.port.ts` 의 `PublishStudyBriefInput` 에 추가:

```ts
  // 그림 첨부는 선택이다. 값이 없으면 그림 없이 발행한다 — 그림 유무가 발행 성패를 가르지 않는다.
  diagramFileUploadId?: string;
```

`study-brief-notion.publisher.ts` 의 `buildPageBlocks` 를 바꾼다:

```ts
const buildPageBlocks = (input: PublishStudyBriefInput): NotionPlanBlock[] => {
  const blocks: NotionPlanBlock[] = [...buildCalloutBlocks(input.verdict)];
  if (input.diagramFileUploadId !== undefined) {
    blocks.push({ type: 'image', fileUploadId: input.diagramFileUploadId });
  }
  blocks.push(
    { type: 'divider' },
    ...markdownToBlocks(input.reportMd),
    { type: 'divider' },
    { type: 'heading', text: '출처' },
  );
  for (const sourceUrl of input.sourceUrls) {
    blocks.push({ type: 'bullet', text: sourceUrl, link: sourceUrl });
  }
  return blocks;
};
```

- [ ] **Step 4: 퍼블리셔 테스트 통과를 확인한다**

Run: `pnpm exec jest src/study-brief-cron/infrastructure/study-brief-notion.publisher.spec.ts`
Expected: PASS

- [ ] **Step 5: consumer 의 실패하는 테스트를 쓴다**

`src/study-brief-cron/infrastructure/study-brief-cron.consumer.spec.ts` 에 추가한다. 기존 파일의 mock 구성 방식을 따르되, 새로 주입되는 두 협력자(`generateStudyDiagram`, `notionFileUpload`)를 기존 mock 세트에 더한다:

```ts
it('그림이 만들어지면 업로드해서 퍼블리셔에 넘긴다', async () => {
  generateStudyDiagram.execute.mockResolvedValue({
    png: Buffer.from('png'),
    html: '<html></html>',
    violations: [],
  });
  notionFileUpload.uploadImage.mockResolvedValue('upload-1');

  await consumer.process(job);

  expect(studyBriefPublisher.publish).toHaveBeenCalledWith(
    expect.objectContaining({ diagramFileUploadId: 'upload-1' }),
  );
});

it('그림 생성이 null 이면 그림 없이 발행한다', async () => {
  generateStudyDiagram.execute.mockResolvedValue(null);

  await consumer.process(job);

  expect(notionFileUpload.uploadImage).not.toHaveBeenCalled();
  expect(studyBriefPublisher.publish).toHaveBeenCalledWith(
    expect.not.objectContaining({ diagramFileUploadId: expect.anything() }),
  );
});

it('업로드가 실패해도 페이지 발행과 Slack 발송은 그대로 진행한다', async () => {
  generateStudyDiagram.execute.mockResolvedValue({
    png: Buffer.from('png'),
    html: '<html></html>',
    violations: [],
  });
  notionFileUpload.uploadImage.mockRejectedValue(new Error('notion 500'));

  await consumer.process(job);

  expect(studyBriefPublisher.publish).toHaveBeenCalled();
  expect(slackNotifier.postMessage).toHaveBeenCalled();
});

it('그림 생성이 예외를 던져도 발행을 막지 않는다', async () => {
  generateStudyDiagram.execute.mockRejectedValue(new Error('unexpected'));

  await consumer.process(job);

  expect(studyBriefPublisher.publish).toHaveBeenCalled();
  expect(slackNotifier.postMessage).toHaveBeenCalled();
});
```

마지막 두 케이스가 이 태스크의 핵심이다. **그림 경로의 어떤 실패도 페이지와 Slack을 막지 못한다**는 것을 강제로 확인한다.

- [ ] **Step 6: consumer 를 고친다**

생성자에 두 협력자를 추가하고(`GenerateStudyDiagramUsecase`, `@Inject(NOTION_FILE_UPLOAD_PORT) NotionFileUploadPort`), `verdict` 를 얻은 뒤 `publishToNotionOrNull` 호출 앞에 그림 단계를 넣는다:

```ts
      const diagramFileUploadId = await this.buildDiagramOrNull({
        topic: research.topic,
        kind: research.kind,
        reportMd: research.reportMd,
      });
      const published = await this.publishToNotionOrNull({
        // (기존 인자 그대로)
        ...(diagramFileUploadId ? { diagramFileUploadId } : {}),
      });
```

그리고 메서드를 추가한다:

```ts
  // 그림은 있으면 좋은 것이지 발행을 막을 이유가 아니다.
  // 여기서 나오는 모든 실패는 삼키고, 왜 삼켰는지만 남긴다.
  private async buildDiagramOrNull(
    input: GenerateStudyDiagramInput,
  ): Promise<string | null> {
    try {
      const diagram = await this.generateStudyDiagram.execute(input);
      if (diagram === null) {
        return null;
      }
      return await this.notionFileUpload.uploadImage({
        filename: buildDiagramFilename(input.topic),
        png: diagram.png,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Study 그림 첨부 실패 — 그림 없이 발행합니다: ${formatError(error)}`,
      );
      return null;
    }
  }
```

파일 하단에 이름 만드는 함수를 둔다:

```ts
const buildDiagramFilename = (topic: string): string => {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'study'}-diagram.png`;
};
```

`formatError` 가 이 파일에 없으면 함께 추가한다(다른 파일에서 복사하지 말고 이 파일 안에 둔다):

```ts
const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
```

- [ ] **Step 7: 그림 전용 모듈을 만들고 cron 모듈에 물린다**

`StudyBriefCronModule` 에 직접 등록하지 않는다. 그 모듈은 스케줄러와 CTO 판정(승인 게이트)을 함께 들고 있어서, Task 8의 CLI 가 그걸 올리면 **실행 중인 서버의 repeatable job 을 재등록**하게 된다. `StudyDeepdiveModule` 이 이미 같은 이유로 분리돼 있다.

`src/study-brief-cron/study-diagram.module.ts` 를 새로 만든다:

```ts
import { Module } from '@nestjs/common';

import { HERMES_RUNNER_PORT } from '../agent/blog/domain/port/hermes-runner.port';
import { HermesCliRunner } from '../agent/blog/infrastructure/hermes-cli.runner';
import { NOTION_FILE_UPLOAD_PORT } from '../notion/domain/port/notion-file-upload.port';
import { NotionFileUploadClient } from '../notion/infrastructure/notion-file-upload.client';
import { GenerateStudyDiagramUsecase } from './application/generate-study-diagram.usecase';
import { STUDY_DIAGRAM_RENDERER_PORT } from './domain/port/study-diagram-renderer.port';
import { StudyDiagramRenderer } from './infrastructure/study-diagram.renderer';

// 그림 생성만 담은 모듈. StudyBriefCronModule 과 분리한 이유는 StudyDeepdiveModule 과 같다 —
// 그쪽은 스케줄러와 CTO 판정(PreviewGate 배선)을 함께 들고 있어서, 실증 CLI 가 그걸 올리면
// 실행 중인 서버의 BullMQ repeatable job 을 재등록해 남의 cron 을 지운다.
//
// ⚠️ 이 모듈은 **자기 의존성을 스스로 갖춰야 한다.** 하나라도 빠지면 cron 경로(이미 그 provider 를
//    가진 컨텍스트)에서는 돌고 CLI 만 부팅에 실패한다 — 매일 정상이라 아무도 모르는 상태가 된다.
@Module({
  providers: [
    GenerateStudyDiagramUsecase,
    { provide: HERMES_RUNNER_PORT, useClass: HermesCliRunner },
    { provide: STUDY_DIAGRAM_RENDERER_PORT, useClass: StudyDiagramRenderer },
    { provide: NOTION_FILE_UPLOAD_PORT, useClass: NotionFileUploadClient },
  ],
  exports: [GenerateStudyDiagramUsecase, NOTION_FILE_UPLOAD_PORT],
})
export class StudyDiagramModule {}
```

그리고 `src/study-brief-cron/study-brief-cron.module.ts` 의 `imports` 에 `StudyDiagramModule` 을 추가한다. consumer 가 `GenerateStudyDiagramUsecase` 와 `NOTION_FILE_UPLOAD_PORT` 를 이 모듈에서 받는다.

`ConfigService` 는 `ConfigModule.forRoot({ isGlobal: true })` 로 전역이라 별도 import 가 필요 없다.

- [ ] **Step 8: 환경변수 네 곳을 갱신한다**

`src/config/app.config.ts` 의 Study Brief 블록 아래에 추가한다:

```ts
  // ====== 오늘의 공부 그림 첨부 ======
  // - STUDY_DIAGRAM_ENABLED: 'true' 일 때만 그림을 그려 노션 페이지에 붙인다. 기본 꺼짐.
  // - STUDY_DIAGRAM_WIDTH_PX: 캔버스 가로 = 노션 본문 폭. 이 값을 넘겨 그리면
  //   노션이 이미지를 축소해 글자가 뭉개진다. 실측으로 확정한 값을 넣는다.
  // - STUDY_DIAGRAM_MIN_FONT_PX: 화면에서 보이는 글자 높이의 하한. 미달이면 재작업.
  // - STUDY_DIAGRAM_MAX_HEIGHT_PX: 세로 상한. 축소와 무관하며 "한눈에 들어오는가" 기준이다.
  @IsOptional()
  @IsString()
  STUDY_DIAGRAM_ENABLED?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, {
    message: 'STUDY_DIAGRAM_WIDTH_PX 는 양의 정수 (예: "700") 만 허용합니다.',
  })
  STUDY_DIAGRAM_WIDTH_PX?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, {
    message: 'STUDY_DIAGRAM_MIN_FONT_PX 는 양의 정수 (예: "14") 만 허용합니다.',
  })
  STUDY_DIAGRAM_MIN_FONT_PX?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, {
    message: 'STUDY_DIAGRAM_MAX_HEIGHT_PX 는 양의 정수 (예: "1600") 만 허용합니다.',
  })
  STUDY_DIAGRAM_MAX_HEIGHT_PX?: string;
```

`.env.example` 과 `.env` 에 같은 키를 주석과 함께 넣는다. **`.env` 에서는 `STUDY_DIAGRAM_ENABLED` 를 아직 켜지 않는다** — Task 8의 실측을 마친 뒤에 켠다.

`docs/env-catalog.md` 의 Study Brief 표 아래에 네 줄을 추가하고, README 의 환경변수 표에도 같은 내용을 넣는다.

- [ ] **Step 9: 전체 검증**

Run: `pnpm lint:check && pnpm test && pnpm build && pnpm docs:check`
Expected: 네 개 모두 exit 0

`pnpm test` 를 전체로 돌리는 이유가 있다. 포트에 필드를 추가하면 **다른 spec 의 mock 형태가 어긋나 깨질 수 있고, 그건 전체 실행에서만 드러난다.**

- [ ] **Step 10: 커밋**

```bash
git add src/study-brief-cron src/config/app.config.ts .env.example README.md docs/env-catalog.md
git commit -m "feat(study-diagram): 09:30 파이프라인에 그림 단계 배선 — 실패는 전부 삼키고 발행은 계속"
```

`.env` 는 커밋하지 않는다.

---

### Task 8: 수동 진입점과 실물 확정

여기서 **계획이 미확정으로 남긴 두 값을 실측으로 확정**하고, 검사 게이트가 실제로 작동하는지 확인한다. 이 태스크를 마치기 전에는 cron을 켜지 않는다.

**Files:**
- Modify: `src/study-brief-cron/domain/port/study-brief.repository.port.ts` (조회 2건 추가)
- Modify: `src/study-brief-cron/infrastructure/study-brief.prisma.repository.ts` (구현)
- Test: `src/study-brief-cron/infrastructure/study-brief.prisma.repository.spec.ts` (기존 파일 확장)
- Create: `scripts/study-diagram.ts`
- Modify: `package.json` (`study:diagram` 스크립트)
- Modify: `src/notion/infrastructure/notion-file-upload.client.ts` (실측한 `Notion-Version` 반영)
- Modify: `.env` · `.env.example` · `docs/env-catalog.md` (실측한 폭 반영)
- Modify: `docs/superpowers/specs/2026-08-31-study-eli5-diagram-design.md` (3장 말미에 실측 결과 기록)

**Interfaces:**
- Consumes: `GenerateStudyDiagramUsecase`(Task 6), `StudyDiagramModule`(Task 7), `NOTION_FILE_UPLOAD_PORT`(Task 4)
- Produces:
  - `StudyBriefRepositoryPort.findLatest(ownerUserId: string): Promise<ExpandableStudyBrief | undefined>`
  - `StudyBriefRepositoryPort.findById(id: number): Promise<ExpandableStudyBrief | undefined>`

- [ ] **Step 1: 저장소 조회를 추가한다**

지금 포트에는 `findOldestUnexpandedSince` 밖에 없어 "가장 최근 공부 1건"을 꺼낼 방법이 없다. CLI 가 쓸 조회 두 개를 더한다.

`study-brief.repository.port.ts` 의 `StudyBriefRepositoryPort` 에 추가:

```ts
  // 실증 CLI(scripts/study-diagram.ts)가 쓰는 조회. 확장 여부와 무관하게 최신 1건.
  findLatest(ownerUserId: string): Promise<ExpandableStudyBrief | undefined>;
  findById(id: number): Promise<ExpandableStudyBrief | undefined>;
```

`study-brief.prisma.repository.ts` 에 구현한다. **기존 메서드가 Prisma row 를 `ExpandableStudyBrief` 로 바꾸는 방식(특히 `verdict` 와 `sourceUrls` 의 JSON 역직렬화)을 그대로 재사용한다** — 같은 변환을 두 벌 만들지 않는다. 기존 파일에 그 변환이 헬퍼로 빠져 있지 않다면 이번에 헬퍼로 뽑고 기존 메서드도 그것을 쓰게 한다.

```ts
  async findLatest(ownerUserId: string): Promise<ExpandableStudyBrief | undefined> {
    const found = await this.prisma.studyBrief.findFirst({
      where: { ownerUserId },
      orderBy: { createdAt: 'desc' },
    });
    return found ? toExpandableStudyBrief(found) : undefined;
  }

  async findById(id: number): Promise<ExpandableStudyBrief | undefined> {
    const found = await this.prisma.studyBrief.findUnique({ where: { id } });
    return found ? toExpandableStudyBrief(found) : undefined;
  }
```

Prisma 모델명은 `studyBrief`, 소유자 필드는 `ownerUserId` 다 — 기존 메서드와 같은 이름이다. 다른 필드는 `prisma/schema.prisma` 를 확인한다.

기존 spec 파일에 케이스를 추가한다. 이 파일은 **테스트마다 그 테스트가 쓰는 Prisma 메서드만 mock 해 생성자에 넣는 방식**이다. 그 방식을 그대로 따른다:

```ts
it('findLatest 는 소유자의 가장 최근 브리프를 돌려준다', async () => {
  const findFirst = jest.fn().mockResolvedValue({
    id: 12,
    kind: 'CONCEPT',
    topic: 'durable execution',
    verdict: {
      kind: 'CONCEPT',
      whyNow: '지금 필요',
      whereItLands: 'src/agent-run/',
      minutes: 10,
    },
    reportMd: 'report',
    sourceUrls: ['https://example.com'],
    createdAt: new Date('2026-08-30T00:30:00Z'),
  });
  const repository = new StudyBriefPrismaRepository({
    studyBrief: { findFirst },
  } as unknown as PrismaService);

  const found = await repository.findLatest('U1');

  expect(findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { ownerUserId: 'U1' },
      orderBy: { createdAt: 'desc' },
    }),
  );
  expect(found).toMatchObject({ id: 12, topic: 'durable execution' });
});

it('findLatest 는 기록이 없으면 undefined 다', async () => {
  const findFirst = jest.fn().mockResolvedValue(null);
  const repository = new StudyBriefPrismaRepository({
    studyBrief: { findFirst },
  } as unknown as PrismaService);

  await expect(repository.findLatest('U1')).resolves.toBeUndefined();
});

it('findById 는 없는 id 에 undefined 다', async () => {
  const findUnique = jest.fn().mockResolvedValue(null);
  const repository = new StudyBriefPrismaRepository({
    studyBrief: { findUnique },
  } as unknown as PrismaService);

  await expect(repository.findById(999)).resolves.toBeUndefined();
});
```

`verdict` 와 `sourceUrls` 가 DB 에 JSON 으로 저장돼 있다면 위 mock 의 형태도 **실제 저장 형태와 같아야 한다.** 존재하지 않는 형태의 mock 이 6주간 통과한 사고가 이 레포에 있다 — 기존 메서드가 row 를 어떻게 읽는지 먼저 확인하고 맞춘다.

Run: `pnpm exec jest src/study-brief-cron/infrastructure/study-brief.prisma.repository.spec.ts`
Expected: PASS

- [ ] **Step 2: CLI 를 만든다**

`scripts/study-diagram.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import {
  NOTION_FILE_UPLOAD_PORT,
  NotionFileUploadPort,
} from '../src/notion/domain/port/notion-file-upload.port';
import { PrismaModule } from '../src/prisma/prisma.module';
import { GenerateStudyDiagramUsecase } from '../src/study-brief-cron/application/generate-study-diagram.usecase';
import {
  STUDY_BRIEF_REPOSITORY_PORT,
  StudyBriefRepositoryPort,
} from '../src/study-brief-cron/domain/port/study-brief.repository.port';
import { StudyBriefPrismaRepository } from '../src/study-brief-cron/infrastructure/study-brief.prisma.repository';
import { StudyDiagramModule } from '../src/study-brief-cron/study-diagram.module';

// 사용법:
//   pnpm study:diagram                # 가장 최근 공부 1건으로 그림 생성 + 노션 업로드
//   pnpm study:diagram --id 42        # 특정 공부 건
//   pnpm study:diagram --dry          # 업로드 없이 HTML·PNG 만 저장
//   pnpm study:diagram --owner U123   # 소유자 지정 (기본은 STUDY_BRIEF_OWNER_SLACK_USER_ID)
//
// 09:30 cron 이 부르는 것과 **같은 usecase** 를 부른다. 트리거가 자동뿐이면 검증이
// 다음 발화까지 묶이므로 실증 입구를 따로 둔다.
//
// ⚠️ AppModule 이나 StudyBriefCronModule 을 올리지 않는다. 그쪽은 스케줄러를 들고 있어
//    실행 중인 서버의 BullMQ repeatable job 을 재등록한다. 그림 전용 경량 모듈만 올린다.
const USAGE = [
  '사용법:',
  '  pnpm study:diagram [--id <번호>] [--owner <SLACK_USER_ID>] [--dry]',
].join('\n');

const OUTPUT_DIR = join(process.cwd(), 'tmp', 'study-diagram');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StudyDiagramModule,
  ],
  providers: [
    {
      provide: STUDY_BRIEF_REPOSITORY_PORT,
      useClass: StudyBriefPrismaRepository,
    },
  ],
})
class StudyDiagramCliModule {}

const readOption = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const toSlug = (topic: string): string =>
  topic
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'study';

const main = async (): Promise<void> => {
  const app = await NestFactory.createApplicationContext(StudyDiagramCliModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const repository = app.get<StudyBriefRepositoryPort>(
      STUDY_BRIEF_REPOSITORY_PORT,
    );
    const idOption = readOption('id');
    const owner =
      readOption('owner') ?? process.env.STUDY_BRIEF_OWNER_SLACK_USER_ID;

    if (idOption === undefined && !owner) {
      throw new Error(
        `owner 를 알 수 없습니다. --owner 로 넘기거나 STUDY_BRIEF_OWNER_SLACK_USER_ID 를 설정하세요.\n${USAGE}`,
      );
    }

    const brief =
      idOption !== undefined
        ? await repository.findById(Number(idOption))
        : await repository.findLatest(owner as string);
    if (!brief) {
      throw new Error(
        `대상 공부 기록을 찾지 못했습니다 (${idOption !== undefined ? `id=${idOption}` : `owner=${owner ?? ''}`}).`,
      );
    }
    console.log(`대상: #${brief.id} ${brief.topic} (${brief.kind})`);

    const usecase = app.get(GenerateStudyDiagramUsecase);
    // 거부된 그림도 받아 눈으로 본다. 사유 텍스트만으로는 무엇을 고칠지 판단하기 느리다.
    const diagram = await usecase.execute(
      { topic: brief.topic, kind: brief.kind, reportMd: brief.reportMd },
      { keepRejected: true },
    );
    if (diagram === null) {
      console.error(
        '그림을 만들지 못했습니다. 위 로그의 거부 사유를 확인하세요. ' +
          '(STUDY_DIAGRAM_ENABLED 가 true 인지도 함께 확인)',
      );
      process.exitCode = 1;
      return;
    }

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const base = join(OUTPUT_DIR, `${brief.id}-${toSlug(brief.topic)}`);
    writeFileSync(`${base}.html`, diagram.html, 'utf-8');
    writeFileSync(`${base}.png`, diagram.png);
    console.log(`HTML: ${base}.html`);
    console.log(`PNG : ${base}.png`);

    if (diagram.violations.length > 0) {
      console.error('기준 미달 — cron 이었다면 그림 없이 발행됐을 그림입니다:');
      for (const violation of diagram.violations) {
        console.error(`  [${violation.rule}] ${violation.detail}`);
      }
      process.exitCode = 1;
      return;
    }

    if (hasFlag('dry')) {
      console.log('--dry 라 업로드는 건너뜁니다.');
      return;
    }

    const uploader = app.get<NotionFileUploadPort>(NOTION_FILE_UPLOAD_PORT);
    const fileUploadId = await uploader.uploadImage({
      filename: `${brief.id}-diagram.png`,
      png: diagram.png,
    });
    console.log(`file_upload id: ${fileUploadId}`);
  } finally {
    await app.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

`package.json` 의 `scripts` 에 추가한다:

```json
    "study:diagram": "ts-node scripts/study-diagram.ts",
```

`./tmp/` 가 `.gitignore` 에 없으면 추가한다.

- [ ] **Step 3: 그림 한 장을 실제로 뽑는다**

`.env` 에 `STUDY_DIAGRAM_ENABLED=true` 를 임시로 두고 실행한다.

Run: `pnpm study:diagram --dry`
Expected: `HTML:` 과 `PNG :` 경로가 출력된다

PNG 를 열어 확인한다:

- **한글이 깨지지 않고 렌더되는가?** 헤드리스 크롬의 한글 폰트 문제는 실물로만 드러난다. 네모 상자(두부)로 보이면 프롬프트에 `font-family: -apple-system, "Apple SD Gothic Neo", sans-serif` 를 명시하도록 `buildDrawingRules` 에 한 줄 추가한다. 고정폭 서체는 쓰지 않는다 — 한글은 낱자 폭이 늘어나 자간이 성겨진다.
- 글자가 읽히는가?
- 그림이 잘리지 않았는가?

- [ ] **Step 4: 노션 액자 폭을 실측한다**

1. `STUDY_DIAGRAM_WIDTH_PX` 를 임의 값(예: 700)으로 두고 그림을 뽑는다.
2. `pnpm study:diagram` (`--dry` 없이) 으로 업로드하거나, PNG 를 노션 페이지에 손으로 올린다.
3. **노션에서 이미지가 축소되는지 본다.** 이미지 폭이 본문 폭에 딱 맞고 글자가 그린 크기 그대로면 축소가 없는 것이다.
4. 축소가 보이면 값을 줄이고, 좌우 여백이 남으면 늘려 다시 확인한다.
5. 축소가 일어나지 않는 최대 폭을 찾는다.
6. 그 값을 `.env` · `.env.example` · `docs/env-catalog.md` 의 기본값으로 넣고, `generate-study-diagram.usecase.ts` 의 `DEFAULT_WIDTH_PX` 도 같은 값으로 맞춘다.
7. **스펙 문서 3장 말미에 `실측 결과: 노션 본문 폭 N px (2026-XX-XX 확인)` 를 기록한다.** 다음 사람이 같은 실험을 반복하지 않게 한다.

- [ ] **Step 5: 파일 업로드 Notion-Version 을 확정한다**

Run: `pnpm study:diagram` (`--dry` 없이)
Expected: `file_upload id: ...` 가 출력된다

실패하면 에러 메시지의 응답 본문을 보고 `notion-file-upload.client.ts` 의 `FILE_UPLOAD_NOTION_VERSION` 을 올린다. 성공한 값을 상수 주석에 확인 날짜와 함께 남긴다.

업로드한 파일을 실제 노션 페이지에 붙여 **이미지가 보이는지**까지 확인한다. 업로드 성공이 곧 표시 성공은 아니다.

- [ ] **Step 6: 검사 게이트를 일부러 깨뜨려 확인한다**

게이트는 통과 케이스만 보면 죽어 있어도 초록으로 보인다. **위반하는 HTML 을 직접 만들어 실제로 걸리는지 확인한다.**

`src/study-brief-cron/infrastructure/study-diagram.renderer.gate-check.ts` 같은 임시 스크립트 대신, 짧은 확인용 스크립트를 `./tmp/` 에 두고 `ts-node` 로 렌더러를 직접 호출한다. 세 입력을 만든다:

| 입력 | 내용 | 기대 |
|---|---|---|
| 작은 글자 | `<div style="font-size:8px">작음</div>` | `FONT_TOO_SMALL` |
| 가로 넘침 | 캔버스 폭 + 200px 짜리 `<div>` | `OVERFLOW_X` |
| 세로 초과 | 상한 + 500px 높이 `<div>` | `TOO_TALL` |
| 빈 문서 | `<html><body></body></html>` | `FONT_TOO_SMALL` (글자 0개) |

넷 다 걸리는 것을 확인한다. **하나라도 통과하면 그 검사는 작동하지 않는 것이다.** 확인 후 임시 파일을 지운다.

- [ ] **Step 7: 재작업 경로를 실제로 확인한다**

`STUDY_DIAGRAM_MIN_FONT_PX` 를 비현실적으로 높게(예: `60`) 두고 실행한다.

Run: `pnpm study:diagram --dry`
Expected: 로그에 `Study 그림 1차 거부 — 재작업 1회 시도` 가 찍히고, codex 호출이 **두 번** 일어난 뒤 `Study 그림 재작업도 거부` 로 끝난다

확인 후 값을 원래대로 되돌린다.

- [ ] **Step 8: cron 을 켠다**

실측 값을 반영한 뒤 `.env` 의 `STUDY_DIAGRAM_ENABLED=true` 로 두고 백엔드를 재시작한다. **환경변수는 실행 중인 프로세스에 닿지 않는다 — 재시작해야 반영된다.**

- [ ] **Step 9: 전체 검증**

Run: `pnpm lint:check && pnpm test && pnpm build && pnpm docs:check`
Expected: 네 개 모두 exit 0

- [ ] **Step 10: 커밋**

```bash
git add scripts/study-diagram.ts package.json .gitignore src/study-brief-cron src/notion/infrastructure/notion-file-upload.client.ts .env.example docs/env-catalog.md docs/superpowers/specs/2026-08-31-study-eli5-diagram-design.md
git commit -m "feat(study-diagram): 수동 진입점 + 노션 액자 폭·업로드 버전 실측 확정"
```

`.env` 는 커밋하지 않는다.

- [ ] **Step 11: 검증 노트 초안을 만든다**

실제로 굴려서 확인한 작업이므로 PR 코멘트용 검증 노트 초안을 준비한다. 담을 것:

- 어디서 무엇을 실행했는지, 그리고 **무엇을 실행하지 않았는지**
- 액자 폭 실측 과정과 확정값 (Step 4)
- 게이트 네 개를 일부러 깨뜨린 결과 (Step 6)
- 재작업 경로 확인 결과 (Step 7)
- **미검증으로 남은 것** — 실제 09:30 cron 회차의 동작은 다음 날 확인해야 한다. 그 전까지는 "수동 실행으로만 확인" 이라고 명시한다.

게시는 사용자 승인 후에 한다.

---

## 실행 순서 요약

| 태스크 | 산출물 | 의존 |
|---|---|---|
| 1 | 렌더 판정 순수 함수 | — |
| 2 | HTML 파서 | — |
| 3 | 프롬프트 (최초·재작업) | 1 |
| 4 | 노션 이미지 블록 + 파일 업로드 | — |
| 5 | puppeteer 렌더러 | 1 |
| 6 | 생성 오케스트레이션 | 2, 3, 5 |
| 7 | 파이프라인 배선 | 4, 6 |
| 8 | 수동 진입점 + 실물 확정 | 7 |

1 · 2 · 4 는 서로 의존하지 않아 병렬로 진행할 수 있다.
