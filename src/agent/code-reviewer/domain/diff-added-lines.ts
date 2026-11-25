export interface AddedLine {
  file: string;
  // 변경 후 파일 기준 줄 번호.
  line: number;
  // `+` 접두사를 뗀 본문.
  text: string;
}

// 비ASCII 경로는 git(core.quotePath 기본값)이 `+++ "b/\355\225\234.ts"` 처럼 따옴표로 감싸고 8진수로 이스케이프한다.
// 공백이 든 경로는 끝에 탭이 붙는다. 이 헤더를 못 읽으면 파일 이름이 changedFiles 와 어긋나거나
// (위험 지도·숨은 문자 경고) 증감이 앞 파일에 더해진다(재생 diff 요약, review-replay-diff.ts).
const GIT_PATH_ESCAPES: Record<string, string> = {
  t: '\t',
  n: '\n',
  '"': '"',
  '\\': '\\',
};

export const parseHeaderPath = (
  line: string,
  marker: '--- a/' | '+++ b/',
): string | undefined => {
  if (line.startsWith(marker)) {
    return line.slice(marker.length).trim();
  }
  const quoted = `${marker.slice(0, 4)}"${marker.slice(4)}`;
  const trimmed = line.trimEnd();
  if (!trimmed.startsWith(quoted) || !trimmed.endsWith('"')) {
    return undefined;
  }
  // 8진수 이스케이프는 UTF-8 바이트 하나씩이다 — latin1 로 바이트를 모은 뒤 UTF-8 로 다시 읽는다.
  const bytes = trimmed
    .slice(quoted.length, -1)
    .replace(/\\([0-7]{3}|.)/g, (_, code: string) =>
      code.length === 3
        ? String.fromCharCode(parseInt(code, 8))
        : (GIT_PATH_ESCAPES[code] ?? code),
    );
  return Buffer.from(bytes, 'latin1').toString('utf-8');
};

// 줄 수를 생략하면 1 이다(`@@ -3 +3 @@`).
const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const UNKNOWN_FILE = '(알 수 없는 파일)';

export enum DiffLineKind {
  // `+++ ` 파일 헤더. 이 줄부터 file 이 바뀐다.
  FILE = 'file',
  // 그 밖의 헤더·hunk 머리·"\ No newline at end of file" 처럼 바뀐 줄이 아닌 것 전부.
  HEADER = 'header',
  ADDED = 'added',
  REMOVED = 'removed',
  CONTEXT = 'context',
}

export interface DiffLine {
  kind: DiffLineKind;
  raw: string;
  // 이 줄이 속한 파일. 변경 후 경로, 지운 파일이면 변경 전 경로다. 첫 `+++ ` 헤더 전에는 없다.
  file?: string;
  // 변경 후 파일 기준 줄 번호. hunk 본문의 추가·문맥 줄에만 있다.
  newLine?: number;
}

type PrefixRule = readonly [prefix: string, kind: DiffLineKind];

// 앞에서부터 처음 맞는 접두사로 줄 종류를 정한다. hunk 헤더 없이 잘라 붙인 diff 도 있어,
// hunk 밖에서는 `+++ `·`--- ` 만 헤더로 보고 나머지 `+`·`-` 줄은 바뀐 줄로 친다.
const OUTSIDE_HUNK_RULES: readonly PrefixRule[] = [
  ['+++ ', DiffLineKind.FILE],
  ['--- ', DiffLineKind.HEADER],
  ['+', DiffLineKind.ADDED],
  ['-', DiffLineKind.REMOVED],
];

// hunk 본문 안의 `+++ `·`--- ` 는 헤더가 아니라 `++ x` 를 추가하거나 `-- x` 를 지운 줄이다.
// 문맥 줄은 공백 접두지만 도구에 따라 빈 줄로 오기도 해서 나머지 전부를 문맥으로 본다.
const HUNK_BODY_RULES: readonly PrefixRule[] = [
  ['\\', DiffLineKind.HEADER],
  ['+', DiffLineKind.ADDED],
  ['-', DiffLineKind.REMOVED],
];

const kindOf = ({
  raw,
  rules,
  fallback,
}: {
  raw: string;
  rules: readonly PrefixRule[];
  fallback: DiffLineKind;
}): DiffLineKind =>
  rules.find(([prefix]) => raw.startsWith(prefix))?.[1] ?? fallback;

interface HunkConsumption {
  old: number;
  new: number;
}

// 줄 종류마다 hunk 의 남은 줄 수(변경 전·후)를 얼마나 쓰는가. 삭제 줄은 변경 후 파일에 없다.
const HUNK_CONSUMPTION: Record<DiffLineKind, HunkConsumption> = {
  [DiffLineKind.FILE]: { old: 0, new: 0 },
  [DiffLineKind.HEADER]: { old: 0, new: 0 },
  [DiffLineKind.ADDED]: { old: 0, new: 1 },
  [DiffLineKind.REMOVED]: { old: 1, new: 0 },
  [DiffLineKind.CONTEXT]: { old: 1, new: 1 },
};

export const isChangedLine = ({ kind }: DiffLine): boolean =>
  kind === DiffLineKind.ADDED || kind === DiffLineKind.REMOVED;

// diff 를 줄 단위로 읽는 곳은 모두 이것을 거친다. 각 줄의 종류·소속 파일·줄 번호를 붙인다.
// 본문은 hunk 헤더가 알려 준 줄 수만큼으로 센다 — 접두사만 보면 바뀐 줄을 헤더로 오인한다.
export const scanDiffLines = (diff: string): DiffLine[] => {
  const position: ScanPosition = {
    nextLine: 0,
    oldRemaining: 0,
    newRemaining: 0,
  };
  const lines = diff.split('\n').map((raw) => scanLine({ raw, position }));
  return lines;
};

// diff 의 추가된 줄을 파일·줄 번호와 함께 꺼낸다. hunk 밖의 `+` 줄은 줄 번호를 모르므로 뺀다.
export const listAddedLines = (diff: string): AddedLine[] =>
  scanDiffLines(diff).flatMap(({ kind, raw, file, newLine }) =>
    kind === DiffLineKind.ADDED && newLine !== undefined
      ? [{ file: file ?? UNKNOWN_FILE, line: newLine, text: raw.slice(1) }]
      : [],
  );

// scanDiffLines 가 줄을 넘기며 들고 가는 위치. 한 번 훑는 동안만 쓰는 상태다.
interface ScanPosition {
  file?: string;
  // `--- a/경로` 의 경로. 바로 뒤가 `+++ /dev/null`(지운 파일)이면 이것이 그 파일의 이름이다.
  removedPath?: string;
  nextLine: number;
  oldRemaining: number;
  newRemaining: number;
}

interface ScanInput {
  raw: string;
  position: ScanPosition;
}

const scanLine = ({ raw, position }: ScanInput): DiffLine => {
  // 본문 줄은 공백·`+`·`-`·`\` 로 시작한다 — 줄 수가 틀린 hunk 가 다음 파일까지 먹지 않게 끊는다.
  if (raw.startsWith('diff --git ')) {
    position.oldRemaining = 0;
    position.newRemaining = 0;
  }
  if (position.oldRemaining <= 0 && position.newRemaining <= 0) {
    return scanOutsideHunk({ raw, position });
  }
  const kind = kindOf({
    raw,
    rules: HUNK_BODY_RULES,
    fallback: DiffLineKind.CONTEXT,
  });
  const consumed = HUNK_CONSUMPTION[kind];
  const newLine = consumed.new > 0 ? position.nextLine : undefined;
  position.oldRemaining -= consumed.old;
  position.newRemaining -= consumed.new;
  position.nextLine += consumed.new;
  return { kind, raw, file: position.file, newLine };
};

const scanOutsideHunk = ({ raw, position }: ScanInput): DiffLine => {
  const hunk = HUNK_HEADER.exec(raw);
  if (hunk) {
    position.oldRemaining = Number(hunk[1] ?? 1);
    position.nextLine = Number(hunk[2]);
    position.newRemaining = Number(hunk[3] ?? 1);
  }
  if (raw.startsWith('--- ')) {
    position.removedPath = parseHeaderPath(raw, '--- a/');
  }
  const kind = kindOf({
    raw,
    rules: OUTSIDE_HUNK_RULES,
    fallback: DiffLineKind.HEADER,
  });
  if (kind === DiffLineKind.FILE) {
    position.file = newFilePath({ raw, removedPath: position.removedPath });
  }
  return { kind, raw, file: position.file };
};

// 따옴표로 감싼 비ASCII 경로·공백 경로 끝의 탭을 풀어야 changedFiles 와 같은 경로가 된다 —
// 안 풀면 신호가 점수에는 들어가도 어느 파일인지 표에 안 나온다. 접두사가 없는 헤더는 그대로 쓴다.
const newFilePath = ({
  raw,
  removedPath,
}: {
  raw: string;
  removedPath: string | undefined;
}): string | undefined => {
  if (raw.startsWith('+++ /dev/null')) {
    return removedPath;
  }
  return parseHeaderPath(raw, '+++ b/') ?? raw.slice(4).trim();
};
