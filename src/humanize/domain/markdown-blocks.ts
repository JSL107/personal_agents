import { createHash } from 'node:crypto';

// 마크다운을 '산문 문단' 과 '손대면 안 되는 블록(코드·표·헤딩·인용·목록)' 으로 가른다.
//
// 무손실 설계: 블록을 문자열로 복사하지 않고 **줄 번호 구간**으로만 가리킨다. 내용을 바꾸지
// 않으면 줄 배열이 그대로 남아 재조립 결과가 원문과 한 글자도 다르지 않다.
//
// 윤문 어댑터와 문체 지표 계산기가 **같은 함수를 쓴다** — 펜스 인식이 두 곳으로 갈리면
// 한쪽만 고쳐질 때 코드블록이 문장으로 세어지거나 윤문에 새어 들어간다.

type MarkdownBlockKind = 'prose' | 'keep';

export type MarkdownBlock = {
  kind: MarkdownBlockKind;
  // 원문 줄 배열에서의 구간 (양끝 포함)
  startLine: number;
  endLine: number;
};

export type MarkdownBlockScan = {
  lines: string[];
  blocks: MarkdownBlock[];
};

export type HumanizeMarkdownResult = {
  markdown: string;
  // 실제로 문장이 바뀐 문단 수. 0 이면 윤문이 안 먹었다는 뜻이라 카드에 그대로 드러낸다.
  changedParagraphs: number;
  proseParagraphs: number;
};

// 펜스는 **길이까지** 잡는다. ```` 로 열고 안쪽에 ``` 가 들어간 블록을 3글자 마커로만 보면
// 안쪽 펜스에서 닫힌 것으로 착각해 코드가 산문으로 새어 나온다(실측 확인).
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;
// 헤딩 / 인용 / 표 / 리스트 / 구분선 / frontmatter 구분자 — 산문이 아니므로 손대지 않는다.
const KEEP_LINE_PATTERN =
  /^\s*(#{1,6}\s|>|\||[-*+]\s|\d+[.)]\s|-{3,}|={3,}|:::)/;
// 들여쓴 줄은 손대지 않는다 — 4칸 들여쓴 코드블록과 리스트 하위 문단이 여기 걸린다.
// 문단을 통째로 갈아끼우는 구조라 모델이 들여쓰기를 잃으면 구조가 깨진다. 안 바꾸는 쪽이 안전하다.
const INDENTED_LINE_PATTERN = /^[ \t]+\S/;

// setext 헤딩의 `===` 와 앞 파이프 없는 표의 `--- | ---` 는 **둘째 줄**에 온다. 첫 줄만 보면
// 제목과 표가 윤문 대상이 되므로(실측 확인) 블록의 모든 줄을 검사한다.
const isKeepLine = (line: string): boolean =>
  KEEP_LINE_PATTERN.test(line) || INDENTED_LINE_PATTERN.test(line);

const isClosingFence = (line: string, openMarker: string): boolean => {
  const trimmed = line.trim();
  const fenceChar = openMarker[0];
  if (!trimmed.startsWith(fenceChar.repeat(openMarker.length))) {
    return false;
  }
  return trimmed.split('').every((character) => character === fenceChar);
};

export const scanMarkdownBlocks = (markdown: string): MarkdownBlockScan => {
  const lines = markdown.split('\n');
  const blocks: MarkdownBlock[] = [];
  let blockStart: number | null = null;
  let fenceMarker: string | null = null;

  const closeBlock = (endLine: number, forceKeep: boolean): void => {
    if (blockStart === null) {
      return;
    }
    const kind: MarkdownBlockKind =
      forceKeep || lines.slice(blockStart, endLine + 1).some(isKeepLine)
        ? 'keep'
        : 'prose';
    blocks.push({ kind, startLine: blockStart, endLine });
    blockStart = null;
  };

  lines.forEach((line, index) => {
    if (fenceMarker !== null) {
      // 닫는 펜스는 **같은 문자로 같은 길이 이상**이고 그 줄에 다른 내용이 없어야 한다(CommonMark).
      // ```` 로 연 블록은 안쪽 ``` 로 닫히지 않는다. 닫히지 않은 채 끝나면 전체가 keep 으로 남는다.
      if (isClosingFence(line, fenceMarker)) {
        fenceMarker = null;
        closeBlock(index, true);
      }
      return;
    }

    const fenceMatch = line.match(FENCE_PATTERN);
    if (fenceMatch) {
      closeBlock(index - 1, false);
      blockStart = index;
      fenceMarker = fenceMatch[1];
      return;
    }

    if (line.trim().length === 0) {
      closeBlock(index - 1, false);
      return;
    }

    if (blockStart === null) {
      blockStart = index;
    }
  });

  // 펜스가 닫히지 않았거나 문서가 문단으로 끝난 경우
  closeBlock(lines.length - 1, fenceMarker !== null);
  return { lines, blocks };
};

// 펜스 코드블록만 원문 그대로 뽑는다. 편집 단계가 코드를 바꾸지 않았는지 대조하는 데 쓴다 —
// "코드 한 글자도 바꾸지 마라" 를 프롬프트로만 두면 집행이 없다.
export const extractFencedCodeBlocks = (markdown: string): string[] => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);
  return blocks
    .filter((block) => FENCE_PATTERN.test(lines[block.startLine]))
    .map((block) => lines.slice(block.startLine, block.endLine + 1).join('\n'));
};

// 코드블록을 표식으로 가린다. 편집 단계가 코드를 만지지 못하게 하는 장치다.
//
// 왜 프롬프트로 안 되는가 — 편집 프롬프트에는 이미 "코드블록 안의 코드, 명령어, 로그: 한 글자도
// 바꾸지 마라" 가 있다. 그런데 실측하면 세 번 중 두 번 어긴다. 실제 주소(`developer.mozilla.org`)를
// 예시 주소로 바꾸고, `Cache-Control: private` 에 없던 `max-age=60` 과 가짜 ETag 를 덧붙였다.
// 규칙을 못 읽는 게 아니라 보이면 만진다. 안 보여주는 편이 확실하다.
//
// 말투 단계(`humanizeMarkdownProse`)는 애초에 산문 문단만 골라 보내서 이 문제가 없다.
// 편집 단계는 글 전체를 봐야 요지를 정할 수 있어 같은 방식을 쓸 수 없다 — 그래서 자리는 남기고
// 내용만 가린다.
//
// 표식을 HTML 주석으로 두는 이유: 마크다운에서 렌더되지 않아 혹시 남아도 화면을 덜 망치고,
// `[[...]]` 같은 링크 문법으로 오인될 일이 없다.
// 표식 ID 는 **코드 내용의 해시**다. 순번을 쓰면 모델이 앞 예시를 지우고 뒤 표식을 1번부터
// 다시 매길 때(`CODE_BLOCK_2` → `CODE_BLOCK_1`) 복원이 엉뚱한 코드를 넣는다. 그 상태는 남은
// 표식도 없고 삽입된 코드도 원본 중 하나라 두 게이트를 모두 통과해, **설명과 다른 코드가
// 조용히 발행된다**(리뷰 P1). 해시는 모델이 다시 매길 수 없고, 모르는 ID 는 복원되지 않아
// 표식으로 남아 검사에 걸린다.
const codeMaskId = (block: string): string =>
  createHash('sha1').update(block).digest('hex').slice(0, 8);

const codeMask = (block: string): string =>
  `<!-- CODE_BLOCK_${codeMaskId(block)} -->`;

// 복원 후 남은 표식을 찾는 패턴. 모델이 표식을 변형하거나 없는 ID 를 쓰면 그대로 남는다.
export const CODE_MASK_PATTERN = /<!--\s*CODE_BLOCK_[0-9a-f]+\s*-->/;
const CODE_MASK_GLOBAL = /<!--\s*CODE_BLOCK_([0-9a-f]+)\s*-->/g;

export type MaskedCodeBlocks = {
  masked: string;
  blocks: string[];
};

export const maskFencedCodeBlocks = (markdown: string): MaskedCodeBlocks => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);
  const codeBlocks = blocks.filter((block) =>
    FENCE_PATTERN.test(lines[block.startLine]),
  );
  if (codeBlocks.length === 0) {
    return { masked: markdown, blocks: [] };
  }

  const kept: string[] = codeBlocks.map((block) =>
    lines.slice(block.startLine, block.endLine + 1).join('\n'),
  );
  const nextLines = [...lines];
  // 뒤에서부터 치환한다 — 앞에서 바꾸면 줄 수가 달라져 뒤 블록의 줄 번호가 밀린다.
  for (let index = codeBlocks.length - 1; index >= 0; index -= 1) {
    const block = codeBlocks[index];
    nextLines.splice(
      block.startLine,
      block.endLine - block.startLine + 1,
      codeMask(kept[index]),
    );
  }

  return { masked: nextLines.join('\n'), blocks: kept };
};

// 표식을 원본 코드로 되돌린다.
//
// **단일 패스**로 훑는다. 블록마다 문자열 치환을 누적하면 앞서 복원한 코드 안에 다른 표식
// 문자열이 있을 때 그것까지 치환돼 본문이 변조된다(리뷰 P2 · MUST_FIX). 한 번만 훑으면
// 복원된 내용은 다시 검사 대상이 되지 않는다.
//
// 표식이 사라진 자리는 그 예시가 삭제된 것으로 본다(편집은 덜어내는 일이라 삭제는 허용).
// 모르는 ID 는 표식을 그대로 남겨 호출부의 CODE_MASK_PATTERN 검사에 걸리게 한다.
export const restoreFencedCodeBlocks = (
  masked: string,
  blocks: readonly string[],
): string => {
  const byId = new Map<string, string>();
  for (const block of blocks) {
    byId.set(codeMaskId(block), block);
  }

  return masked.replace(
    CODE_MASK_GLOBAL,
    (whole, id: string) => byId.get(id) ?? whole,
  );
};
