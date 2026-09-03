import {
  FENCE_PATTERN,
  isClosingFence,
} from '../../../humanize/domain/markdown-blocks';

// 옛 초안의 헤딩 층을 되돌린다.
//
// 2026-09-02 이전에 적재된 초안은 파서(`study-deepdive.parser.ts`)가 `#{1,3}` 을 전부 `### ` 로
// 눌러 Notion 에 heading_3 으로 저장했다. 그때는 `blocks-to-markdown` 이 heading_3 을 `## ` 로
// 되돌려 발행본이 정상으로 보였는데, 왕복이 층을 지키도록 고친 뒤(#457)로는 그 초안들이
// **`### ` 만 있고 `## ` 가 하나도 없는 글**로 발행된다.
//
// 실제로 2026-09-02 발행본이 그렇게 나갔다 — 소제목 7개가 전부 `### ` 였다. Notion 큐에 남은
// 옛 초안이 발행될 때마다 반복되므로, 큐가 빌 때까지 발행 직전에 되돌린다.
//
// 새 초안은 `## ` 와 `### ` 를 함께 쓰므로 이 보정에 걸리지 않는다. 큐에서 옛 초안이 모두
// 빠지면 이 함수는 아무 일도 하지 않게 되고, 그때 지워도 된다.
//
// **펜스 판정은 `markdown-blocks.ts` 것을 그대로 쓴다.** 자체 구현하면 `~~~` 펜스나 백틱 네 개로
// 연 블록을 놓치고, 그 안의 `### ` 를 헤딩으로 착각해 코드를 고친다. 더 나쁜 것은 그 뒤의 코드
// 보존 검사가 **이미 바뀐 본문**을 기준으로 삼아 손상을 못 잡는다는 점이다(PR #460 리뷰 지적).

interface ProseLine {
  line: string;
  isProse: boolean;
}

/** 코드블록 밖(산문)인지 표시하며 줄을 훑는다. 판정과 변환이 같은 경계를 쓰게 하려는 것이다. */
const markProseLines = (lines: readonly string[]): ProseLine[] => {
  let openMarker: string | null = null;
  return lines.map((line) => {
    if (openMarker !== null) {
      if (isClosingFence(line, openMarker)) {
        openMarker = null;
      }
      return { line, isProse: false };
    }
    const opened = line.match(FENCE_PATTERN);
    if (opened) {
      openMarker = opened[1];
      return { line, isProse: false };
    }
    return { line, isProse: true };
  });
};

/**
 * `### ` 만 있고 `## ` 가 하나도 없는 본문의 헤딩을 한 단계 올린다.
 *
 * 두 조건을 모두 만족할 때만 손댄다 — 층을 제대로 쓴 글은 `## ` 가 있어 그대로 지나간다.
 */
export const liftLegacyHeadings = (markdown: string): string => {
  const marked = markProseLines(markdown.split('\n'));
  const hasTopLevel = marked.some(
    ({ line, isProse }) => isProse && /^## /.test(line),
  );
  const hasSubLevel = marked.some(
    ({ line, isProse }) => isProse && /^### /.test(line),
  );
  if (hasTopLevel || !hasSubLevel) {
    return markdown;
  }
  return marked
    .map(({ line, isProse }) => (isProse ? line.replace(/^### /, '## ') : line))
    .join('\n');
};
