export enum UpstreamRangeKind {
  ANCESTOR = 'ANCESTOR',
  RECENT = 'RECENT',
}

export interface UpstreamRange {
  kind: UpstreamRangeKind;
  args: string[];
}

export const chooseUpstreamRange = ({
  priorHead,
  isAncestor,
}: {
  priorHead: string | null;
  isAncestor: boolean;
}): UpstreamRange => {
  if (priorHead && isAncestor) {
    return {
      kind: UpstreamRangeKind.ANCESTOR,
      args: [`${priorHead}..upstream/main`],
    };
  }
  return {
    kind: UpstreamRangeKind.RECENT,
    args: ['--since=30 days ago', 'upstream/main'],
  };
};

// 커밋 목록은 자르지 않고 diff 만 자른다. 처리 기록은 upstream/main 끝까지 전진하므로,
// 목록까지 잘리면 잘린 커밋은 다음 회차에도 다시 보이지 않는다.
export const composeUpstreamText = ({
  commits,
  patch,
  budget,
}: {
  commits: string;
  patch: string;
  budget: number;
}): string => {
  const header = `커밋 목록:\n${commits.trim()}\n\n변경 내용:\n`;
  const room = Math.max(budget - header.length, 0);
  const truncated = patch.length > room;
  const body = truncated
    ? `${patch.slice(0, room)}\n[예산 초과로 나머지 diff 생략]`
    : patch;
  return header + body;
};
