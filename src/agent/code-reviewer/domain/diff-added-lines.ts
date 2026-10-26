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

// diff 의 추가된 줄을 파일·줄 번호와 함께 꺼낸다.
//
// hunk 헤더가 알려 준 줄 수만큼을 본문으로 센다. 본문 안의 `+++ `·`--- ` 는 헤더가 아니라
// `++ x` 를 추가하거나 `-- x` 를 지운 줄이다 — 접두사만 보면 추가 줄을 헤더로 오인해 검사를 건너뛴다.
export const listAddedLines = (diff: string): AddedLine[] => {
  const added: AddedLine[] = [];
  let file = '(알 수 없는 파일)';
  let nextLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;

  for (const raw of diff.split('\n')) {
    if (oldRemaining <= 0 && newRemaining <= 0) {
      if (raw.startsWith('+++ ')) {
        // 따옴표로 감싼 비ASCII 경로·공백 경로 끝의 탭을 풀어야 changedFiles 와 같은 경로가 된다 —
        // 안 풀면 신호가 점수에는 들어가도 어느 파일인지 표에 안 나온다. 접두사가 없는 헤더는 그대로 쓴다.
        file = parseHeaderPath(raw, '+++ b/') ?? raw.slice(4).trim();
        continue;
      }
      const hunk = HUNK_HEADER.exec(raw);
      if (hunk) {
        oldRemaining = hunk[1] === undefined ? 1 : Number(hunk[1]);
        nextLine = Number(hunk[2]);
        newRemaining = hunk[3] === undefined ? 1 : Number(hunk[3]);
      }
      continue;
    }
    // "\ No newline at end of file" 는 줄로 세지 않는다.
    if (raw.startsWith('\\')) {
      continue;
    }
    if (raw.startsWith('+')) {
      added.push({ file, line: nextLine, text: raw.slice(1) });
      nextLine += 1;
      newRemaining -= 1;
      continue;
    }
    // 삭제 줄은 변경 후 파일에 없으므로 줄 번호를 넘기지 않는다.
    if (raw.startsWith('-')) {
      oldRemaining -= 1;
      continue;
    }
    // 문맥 줄(공백 접두. 도구에 따라 빈 줄로 오기도 한다).
    nextLine += 1;
    oldRemaining -= 1;
    newRemaining -= 1;
  }
  return added;
};
