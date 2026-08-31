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
      rejectedReason: '외부 리소스를 참조합니다. 인라인 SVG·CSS 만 허용합니다.',
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
