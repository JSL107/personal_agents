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

/**
 * 윤문이 적용되지 않은 문단을 사유별로 센다.
 *
 * 왜 사유가 필요한가 — 카드에는 `N/M문단 적용` 만 찍힌다. 같은 입력으로 4회 윤문한 실측에서
 * 3회는 43/43 인데 1회가 42/43 이었고, 빠진 문단이 **빈 값이었는지 원본 그대로였는지 사후에
 * 갈라낼 신호가 어디에도 없었다**(2026-08-24). 두 사유는 처방이 다르다 — 빈 값은 어떤 경우에도
 * 정상 윤문이 아니고, 원본 그대로는 손댈 것이 없어서일 수도 있다.
 *
 * 전체 실패는 여기 세지 않는다. 모델 호출이나 파싱이 깨지면 `HumanizeService` 가 입력 전부를
 * 그대로 돌려주므로 모든 문단이 `identical` 이 되고 `changedParagraphs` 는 0 이다 — 카드는
 * 그 상태를 「적용 안 됨」으로 따로 찍는다.
 */
export type HumanizeSkipReasons = {
  // 모델이 빈 값을 돌려줬다(문자열이 아닌 값도 여기 센다).
  empty: number;
  // 모델이 원본을 한 글자도 바꾸지 않고 돌려줬다.
  identical: number;
};

export type HumanizeMarkdownResult = {
  markdown: string;
  // 실제로 문장이 바뀐 문단 수. 0 이면 윤문이 안 먹었다는 뜻이라 카드에 그대로 드러낸다.
  changedParagraphs: number;
  proseParagraphs: number;
  skippedParagraphs: HumanizeSkipReasons;
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

// 헤딩과 목록 머리말의 줄표를 콜론으로 바꾼다.
//
// 왜 코드로 하는가 — 말투 단계(`humanizeMarkdownProse`)는 **산문 문단만** 모델에 넘긴다.
// 헤딩·목록은 구조라서 손대면 문서가 깨지기 때문인데, 그래서 프롬프트에 넣은 "헤딩과 목록
// 머리말에 줄표를 쓰지 마라" 가 정작 그 두 자리에 닿지 않는다. 규칙을 지킬 기회 자체가 없다.
// 규칙을 넣고 발행한 글에서 줄표 9개가 **전부** 헤딩(3)과 목록(6)이었고 산문은 0개였다.
//
// 산문 속 줄표는 여기서 손대지 않는다. 부연을 쉼표로 붙일지 문장을 나눌지는 뜻을 읽어야 갈리고,
// 그건 말투 단계와 `emDashCount` 지표가 맡는다. 여기서 다루는 것은 **머리말 구분자** 하나뿐이다.
//
// 줄 하나에 여러 개가 있어도 첫 번째만 바꾼다. 뒤엣것은 머리말이 아니라 서술 안의 줄표라
// 콜론으로 바꾸면 문장이 어그러진다(`- A — B. C — D.`). 남은 것은 지표에 걸려 사람이 본다.
const STRUCTURAL_DASH_PATTERN =
  /^(\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s).*?)\s+—\s+/;

export const stripStructuralEmDashes = (markdown: string): string => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);
  // 코드 펜스 안은 건드리지 않는다 — 명령어나 출력 예시의 `—` 는 필자의 문체가 아니다.
  const fenced = new Set<number>();
  blocks
    .filter((block) => FENCE_PATTERN.test(lines[block.startLine]))
    .forEach((block) => {
      for (let line = block.startLine; line <= block.endLine; line += 1) {
        fenced.add(line);
      }
    });

  return lines
    .map((line, index) =>
      fenced.has(index) ? line : line.replace(STRUCTURAL_DASH_PATTERN, '$1: '),
    )
    .join('\n');
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

// 표식이 몇 번 남았는지 블록별로 센다. 코드 보존을 약속한 단계(익명화의 공개 프로젝트 계약)는
// **삭제도 허용하지 않는다** — 표식이 사라지면 복원할 것이 없어 코드가 조용히 빠지고, 남은 표식이
// 없으니 잔여 표식 검사도, 삭제를 허용하는 보존 검사도 통과한다(리뷰 P2). 편집 단계는 덜어내는
// 일이라 0 이 정상이므로, 이 검사를 쓸 곳은 호출부가 계약에 따라 정한다.
export const countCodeMaskOccurrences = (
  text: string,
  blocks: readonly string[],
): number[] => blocks.map((block) => text.split(codeMask(block)).length - 1);

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

// 단계 경계 계측 — 편집이 무엇을 덜어냈는지 **글자 수 말고 구조로** 본다.
//
// 왜 필요한가: 편집 산출물이 원문의 60% 밑으로 줄면 끊는 가드는 있지만(글자 수 비율),
// 인용 7줄과 헤딩 9개가 통째로 사라져도 200자 남짓이라 그 문자 게이트에는 보이지 않는다.
// 실제로 그렇게 통과한 발행본이 나왔고, 어느 단계에서 사라졌는지 사후에 알 방법이 없었다.
// 그래서 판정이 아니라 관측이다 — 차단하지 않고 단계마다 세어 카드와 원장에 남긴다.
export type MarkdownStructureCounts = {
  // `assertNotOverTrimmed` 와 같은 기준(`trim().length`)으로 잰다 — 두 자리가 갈리면
  // 카드에 적힌 수와 가드가 판정한 수가 달라 승인자가 어느 쪽을 믿을지 모른다.
  chars: number;
  headings: number;
  // **줄 수**로 센다(블록 수가 아니라). 인용 한 덩어리가 통째로 빠졌는지, 안에서 몇 줄만
  // 빠졌는지를 블록 수로는 가를 수 없다.
  quotes: number;
  // 마크다운 링크·맨 URL 을 가리지 않고 `http(s)` 출현 수로 센다. `[MDN](https://…)` 도
  // 맨 URL 도 하나씩 잡힌다. 상대 경로 링크는 세지 않는다 — 블로그 초안에는 거의 없다.
  //
  // **인라인 링크만 세지 않는 이유**(실측): 라이브 발행본 하나를 재면 인라인 `[…](…)` 는
  // 9 개인데 `http` 출현은 21 개다. 차이 12 개는 글 끝 참고문헌 목록의 맨 URL 이다. 인라인만
  // 세면 그 목록이 통째로 사라져도 `9→9` 로 아무 변화가 보이지 않는다 — 문자 게이트가 인용
  // 7 줄을 못 본 것과 같은 종류의 눈먼 자리를 계측에 다시 만드는 셈이다.
  //
  // 그래서 앞선 조사 메모의 `링크 9 개` 와 이 수는 **다른 것을 센 값**이다. 뒤에 두 수를
  // 나란히 놓고 비교하지 말 것.
  links: number;
  codeBlocks: number;
};

const HEADING_LINE_PATTERN = /^\s{0,3}#{1,6}\s/;
const QUOTE_LINE_PATTERN = /^\s{0,3}>/;
const LINK_PATTERN = /https?:\/\//g;

export const countMarkdownStructure = (
  markdown: string,
): MarkdownStructureCounts => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);
  // 코드블록 안의 `# 주석` 과 `> ` 프롬프트는 헤딩·인용이 아니다. 펜스 인식은 이 파일의
  // 스캐너 하나만 쓴다 — 갈리면 한쪽만 고쳐질 때 계측이 조용히 틀린다.
  const codeLines = new Set<number>();
  let codeBlocks = 0;
  for (const block of blocks) {
    if (!FENCE_PATTERN.test(lines[block.startLine])) {
      continue;
    }
    codeBlocks += 1;
    for (let line = block.startLine; line <= block.endLine; line += 1) {
      codeLines.add(line);
    }
  }

  let headings = 0;
  let quotes = 0;
  let links = 0;
  lines.forEach((line, index) => {
    if (codeLines.has(index)) {
      return;
    }
    if (HEADING_LINE_PATTERN.test(line)) {
      headings += 1;
    }
    if (QUOTE_LINE_PATTERN.test(line)) {
      quotes += 1;
    }
    links += line.match(LINK_PATTERN)?.length ?? 0;
  });

  return { chars: markdown.trim().length, headings, quotes, links, codeBlocks };
};
