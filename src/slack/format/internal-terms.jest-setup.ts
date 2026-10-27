import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { AutopilotTaskResult } from '../../autopilot/domain/autopilot-task.port';
import { findInternalTerms } from './internal-terms';

// 모든 spec 의 렌더 결과에서 내부 식별자를 찾는다(`internal-terms.ts`).
//
// 왜 발송 직전(SlackService) 한 곳이 아니라 여기인가: 테스트에서는 발송부가 거의 다 mock 이라
// 그 자리에 검사를 두면 PR 단계에서 아무 문자열도 지나가지 않는다. 대신 Slack 문자열을 만드는
// 모듈을 파일명 규칙으로 찾아 감싸면, 기존 spec 이 이미 돌리는 실제 렌더 결과가 전부 검사된다.
// 새 포맷터·새 task 도 이름 규칙만 따르면 등록 없이 들어온다.
//
// 감싸는 대상:
//   - `*.formatter.ts` 의 export 함수 → 반환값
//   - `*.autopilot-task.ts` 의 class `run()` → 반환된 요약·상세·카드 문구
//     (task 가 도메인 함수로 미리 조립한 문자열이 포맷터를 안 거치고 나가는 경로 — #816 의 run-retro)
//   - `message-blocks.builder.ts` 의 `toReadableSlackArgs`·`toImageAttachedSlackArgs` → 첫 인자
//     (슬래시·멘션 핸들러가 즉석에서 만든 문장)
//
// 검사 밖(알고 둔 구멍):
//   - 슬래시 핸들러가 `ack`/`respond`/`say` 에 바로 넘기는 안내·실패 문구 (`src/slack/handler/**`)
//   - `buildPreviewBlocks` 를 직접 불러 `chat.update` 하는 카드 갱신 (phase-command·write-back 등)
//   - 도메인 함수가 미리 조립한 문장 중 spec 에서 단독으로만 도는 것 — 포맷터·task spec 이 fixture
//     문자열을 넣으면 실제 조립 결과가 여기를 지나지 않는다(지연 보고 `attribute-delay.ts` 가 그렇다).
//   - 밑줄 없는 enum 값(`PM` 등)과 모델이 쓴 문장 — `internal-terms.ts` 주석 참조.
//   - `jest.resetModules`·`isolateModules` 뒤에 다시 import 한 모듈 (2026-10-14 기준 쓰는 spec 없음).

const SRC_ROOT = join(__dirname, '..', '..');

// 이름은 formatter 지만 Slack 으로 가지 않는 파일. 모델 입력·CLI 출력이라 식별자가 정상이다.
const NOT_SLACK = new Set<string>([
  // 모델 프롬프트에 넣는 입력 조립 — 사람이 읽지 않는다.
  'agent/work-reviewer/domain/prompt/worklog-input.formatter.ts',
  // 터미널 백테스트 CLI(`scripts/backtest.ts`) 출력.
  'backtest/infrastructure/backtest.formatter.ts',
  'backtest/infrastructure/parameter-search.formatter.ts',
]);

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listSourceFiles(path) : [path];
  });

type Violation = { source: string; terms: string[]; text: string };
const violations: Violation[] = [];
// 감싼 대상 이름(`<파일> <export>`). 배선이 깨졌는지 spec 이 확인하는 자리다(`internal-terms.spec.ts`).
const wrappedSources = new Set<string>();

// spec 이 이 setup 이 실제로 등록·동작하는지 보려고 읽는다. import 로 받으면 등록이 빠져도 spec 이
// 직접 불러와 통과해 버리므로, setup 이 돌았을 때만 생기는 전역으로 넘긴다.
export type InternalTermsGuard = {
  wrappedSources: ReadonlySet<string>;
  takeViolations: () => Violation[];
};
(
  globalThis as { __internalTermsGuard?: InternalTermsGuard }
).__internalTermsGuard = {
  wrappedSources,
  takeViolations: () => violations.splice(0),
};

const collectStrings = (value: unknown, depth = 0): string[] => {
  if (typeof value === 'string') {
    return [value];
  }
  if (depth > 4 || value === null || typeof value !== 'object') {
    return [];
  }
  // Buffer(이미지 png 등)는 문장이 아니다.
  if (Buffer.isBuffer(value)) {
    return [];
  }
  return Object.values(value).flatMap((item) =>
    collectStrings(item, depth + 1),
  );
};

const inspect = (source: string, value: unknown): void => {
  for (const text of collectStrings(value)) {
    const terms = findInternalTerms(text);
    if (terms.length > 0) {
      violations.push({ source, terms, text });
    }
  }
};

type TextPicker = (value: unknown) => unknown;

// task 결과에서는 Slack 에 실리는 문구만 본다. 카드 payload·판정 facet 에는 enum 값이 정상으로 들어 있다.
const pickTaskText: TextPicker = (value) => {
  const result = (value ?? {}) as Partial<AutopilotTaskResult>;
  return [
    result.summaryText,
    result.detailText,
    result.headlineText,
    // 이미지·파일 제목도 Slack 에 그대로 보인다(orchestrator 가 제목·대체 텍스트로 싣는다).
    result.detailImage?.title,
    result.detailFile?.title,
    result.detailFile?.content,
    result.preview?.previewText,
    ...(result.previews ?? []).map((preview) => preview.previewText),
    ...(result.runVerdicts ?? []).map((verdict) => verdict.quote),
  ];
};

// 반환값이 Promise 면 풀린 값을 본다. 원래 반환값은 그대로 돌려줘 동작을 바꾸지 않는다.
const inspectResult = (
  source: string,
  result: unknown,
  pick: TextPicker = (value) => value,
): unknown => {
  if (result instanceof Promise) {
    void result.then(
      (resolved: unknown) => inspect(source, pick(resolved)),
      () => undefined,
    );
    return result;
  }
  inspect(source, pick(result));
  return result;
};

const isClass = (value: unknown): boolean =>
  typeof value === 'function' &&
  /^class\b/.test(Function.prototype.toString.call(value));

type AnyFunction = (...args: unknown[]) => unknown;

const wrapExports = (
  path: string,
  pick: (name: string, value: unknown) => 'result' | 'firstArg' | 'run' | null,
): void => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const moduleExports = require(path) as Record<string, unknown>;
  const label = relative(SRC_ROOT, path);
  for (const [name, value] of Object.entries(moduleExports)) {
    const mode = pick(name, value);
    const descriptor = Object.getOwnPropertyDescriptor(moduleExports, name);
    if (!mode) {
      continue;
    }
    const source = `${label} ${name}`;
    if (mode === 'run') {
      const prototype = (value as { prototype: Record<string, unknown> })
        .prototype;
      const original = prototype.run as AnyFunction | undefined;
      if (typeof original === 'function') {
        wrappedSources.add(source);
        prototype.run = function (this: unknown, ...args: unknown[]) {
          return inspectResult(
            source,
            original.apply(this, args),
            pickTaskText,
          );
        };
      }
      continue;
    }
    // re-export(getter)는 원본 모듈에서 감싸므로 건너뛴다.
    if (!descriptor?.writable) {
      continue;
    }
    const original = value as AnyFunction;
    wrappedSources.add(source);
    moduleExports[name] =
      mode === 'firstArg'
        ? (...args: unknown[]) => {
            inspect(source, args[0]);
            return original(...args);
          }
        : (...args: unknown[]) => inspectResult(source, original(...args));
  }
};

for (const path of listSourceFiles(SRC_ROOT)) {
  const label = relative(SRC_ROOT, path);
  if (label.endsWith('.formatter.ts') && !NOT_SLACK.has(label)) {
    wrapExports(path, (_name, value) =>
      typeof value === 'function' && !isClass(value) ? 'result' : null,
    );
  } else if (label.endsWith('.autopilot-task.ts')) {
    wrapExports(path, (_name, value) => (isClass(value) ? 'run' : null));
  } else if (label === 'slack/format/message-blocks.builder.ts') {
    wrapExports(path, (name) =>
      name === 'toReadableSlackArgs' || name === 'toImageAttachedSlackArgs'
        ? 'firstArg'
        : null,
    );
  }
}

// 타이머로 기다리지 않는다 — 가짜 타이머를 켠 spec 에서 멈춘다. task run() 의 검사는 그 Promise 에
// 먼저 붙인 then 이라, spec 이 결과를 await 해 이어 가기 전에 이미 돈다.
afterEach(() => {
  if (violations.length === 0) {
    return;
  }
  const report = violations
    .map(
      ({ source, terms, text }) =>
        `- ${source}: ${terms.join(', ')}\n    ${text.replace(/\s+/g, ' ').slice(0, 160)}`,
    )
    .join('\n');
  violations.length = 0;
  throw new Error(
    `Slack 보고서에 내부 식별자가 섞였다. 담당 이름은 toTaskLabel, 실패 사유는 describeFailureReason 으로 옮긴다 (src/slack/format/internal-terms.ts).\n${report}`,
  );
});
