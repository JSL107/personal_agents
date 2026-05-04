import { StackFrame } from '../domain/be-sre.type';

// node_modules / dist / .spec.ts 는 우리 도메인 코드가 아니라 제외.
const EXCLUDED_PATH_PATTERNS = [
  /[\\/]node_modules[\\/]/,
  /[\\/]dist[\\/]/,
  /\.spec\.(ts|js)$/,
];

// V8 / Node.js 표준 stack frame 정규식.
// 'at FooService.doWork (/repo/src/foo/foo.service.ts:42:15)' 형태.
const FRAME_REGEX =
  /at\s+(?:(?<fn>[\w$.<>]+)\s+)?\(?(?<file>[^():]+):(?<line>\d+):(?<col>\d+)\)?/;

const TS_JS_EXTENSION = /\.(ts|tsx|js)$/;

const MAX_FRAMES = 30;

export const parseStackTrace = (raw: string): StackFrame[] => {
  if (!raw.trim()) {
    return [];
  }

  const frames: StackFrame[] = [];

  for (const rawLine of raw.split('\n')) {
    if (frames.length >= MAX_FRAMES) {
      break;
    }

    const match = FRAME_REGEX.exec(rawLine);
    if (!match?.groups) {
      continue;
    }

    const { fn, file, line, col } = match.groups;

    // ts/tsx/js 파일만 포함.
    if (!file || !TS_JS_EXTENSION.test(file)) {
      continue;
    }

    // node_modules / dist / spec 제외.
    if (EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(file))) {
      continue;
    }

    frames.push({
      function: fn ?? undefined,
      filePath: file,
      line: line ? parseInt(line, 10) : undefined,
      column: col ? parseInt(col, 10) : undefined,
      rawLine: rawLine.trim(),
    });
  }

  return frames;
};
