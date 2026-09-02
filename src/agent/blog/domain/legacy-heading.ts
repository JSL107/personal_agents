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

/** 코드블록 안의 `#` 는 셸·Python 주석이라 건드리면 안 된다. */
const isFence = (line: string): boolean => /^```/.test(line.trim());

const hasTopLevelSection = (lines: readonly string[]): boolean => {
  let insideFence = false;
  return lines.some((line) => {
    if (isFence(line)) {
      insideFence = !insideFence;
      return false;
    }
    return !insideFence && /^## /.test(line);
  });
};

const hasSubSection = (lines: readonly string[]): boolean => {
  let insideFence = false;
  return lines.some((line) => {
    if (isFence(line)) {
      insideFence = !insideFence;
      return false;
    }
    return !insideFence && /^### /.test(line);
  });
};

/**
 * `### ` 만 있고 `## ` 가 하나도 없는 본문의 헤딩을 한 단계 올린다.
 *
 * 두 조건을 모두 만족할 때만 손댄다 — 층을 제대로 쓴 글은 `## ` 가 있어 그대로 지나간다.
 */
export const liftLegacyHeadings = (markdown: string): string => {
  const lines = markdown.split('\n');
  if (hasTopLevelSection(lines) || !hasSubSection(lines)) {
    return markdown;
  }

  let insideFence = false;
  return lines
    .map((line) => {
      if (isFence(line)) {
        insideFence = !insideFence;
        return line;
      }
      if (insideFence) {
        return line;
      }
      return line.replace(/^### /, '## ');
    })
    .join('\n');
};
