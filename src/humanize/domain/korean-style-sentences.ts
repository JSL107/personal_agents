import { scanMarkdownBlocks } from './markdown-blocks';

// 문장 분해. **문체 지표와 구성 축이 같은 분해기를 써야 한다** — 따로 두면 같은 글을 두 파서가
// 다르게 세어, 인용체 비율이 문장 축과 어긋난다(코드 리뷰 지적). 그래서 이 파일로 뺐다.
//
// 문장 끝에 붙는 닫는 문자. 마침표 뒤에 인용·강조가 오는 문장이 실제 본문에 흔하다
// (`"이 정도면 되겠지" 하고`, `**이렇게 해요.**`). 이걸 빼놓으면 두 곳이 함께 어긋난다 —
// 문장 분리가 안 돼 두 문장이 하나로 합쳐지고, 종결 어미 판정도 닫는 문자에 막혀 누락된다.
// 스마트 인용부호(“ ” ‘ ’)와 마크다운 강조(* _), 한글 인용부호(」 』)까지 함께 본다.
const CLOSING_CHARS = '"\'`)\\]*_”’」』';
const TRAILING_CLOSERS = new RegExp(`[.!?。${CLOSING_CHARS}]+$`);
const SENTENCE_BOUNDARY = new RegExp(
  `(?<=[.!?。][${CLOSING_CHARS}]*)\\s+|\\n+`,
);

// 문장 끝의 마침표·인용·강조를 걷어낸다. 종결 어미를 보는 모든 자리가 이 함수를 지나야
// 한 쪽만 고쳐져 지표가 갈리는 일이 없다.
export const stripSentenceTail = (sentence: string): string =>
  sentence.replace(TRAILING_CLOSERS, '');

export const extractProseSentences = (markdown: string): string[] => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);
  const prose = blocks
    .filter((block) => block.kind === 'prose')
    .map((block) => lines.slice(block.startLine, block.endLine + 1).join(' '))
    .join(' ');

  return prose
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
};

/** 이미 잘라 둔 텍스트 조각(문단 등)을 같은 경계로 문장으로 나눈다. */
export const splitSentences = (text: string): string[] =>
  text
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
