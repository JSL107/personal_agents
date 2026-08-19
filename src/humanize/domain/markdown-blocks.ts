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

const FENCE_PATTERN = /^\s*(```|~~~)/;
// 헤딩 / 인용 / 표 / 리스트 / 구분선 / frontmatter 구분자 — 산문이 아니므로 손대지 않는다.
const KEEP_LINE_PATTERN =
  /^\s*(#{1,6}\s|>|\||[-*+]\s|\d+[.)]\s|-{3,}|={3,}|:::)/;

export const scanMarkdownBlocks = (markdown: string): MarkdownBlockScan => {
  const lines = markdown.split('\n');
  const blocks: MarkdownBlock[] = [];
  let blockStart: number | null = null;
  let fenceMarker: string | null = null;

  const closeBlock = (endLine: number, forceKeep: boolean): void => {
    if (blockStart === null) {
      return;
    }
    const firstLine = lines[blockStart];
    const kind: MarkdownBlockKind =
      forceKeep || KEEP_LINE_PATTERN.test(firstLine) ? 'keep' : 'prose';
    blocks.push({ kind, startLine: blockStart, endLine });
    blockStart = null;
  };

  lines.forEach((line, index) => {
    if (fenceMarker !== null) {
      // 닫는 펜스는 같은 마커로만 닫힌다. 닫히지 않은 채 문서가 끝나면 전체가 keep 으로 남는다.
      if (line.trimStart().startsWith(fenceMarker)) {
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
