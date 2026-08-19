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
