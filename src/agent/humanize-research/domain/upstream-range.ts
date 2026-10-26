import { EXTERNAL_LOOKBACK_DAYS } from './humanize-research.constant';
import {
  UpstreamCommit,
  UpstreamRange,
  UpstreamRangeKind,
  UpstreamSelection,
} from './humanize-research.type';

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
    args: [`--since=${EXTERNAL_LOOKBACK_DAYS} days ago`, 'upstream/main'],
  };
};

// 오래된 커밋부터 통째로 싣고, 예산이 차면 거기서 멈춘다. 처리 기록은 마지막으로 실은 커밋까지만
// 전진하므로 못 실은 커밋은 다음 회차가 이어서 본다 — diff 를 중간에서 자르면 잘린 내용이
// 처리된 것으로 넘어가 다시 검토되지 않는다.
// 첫 커밋 하나가 예산보다 크면 그 커밋만 잘라서 싣는다. 안 그러면 회차가 영영 전진하지 못한다.
export const selectUpstreamCommits = ({
  commits,
  budget,
}: {
  commits: UpstreamCommit[];
  budget: number;
}): UpstreamSelection | null => {
  if (commits.length === 0) {
    return null;
  }
  const blocks = commits.map(renderCommit);
  const cumulativeSizes = blocks.reduce<number[]>(
    (sizes, block) => [...sizes, (sizes.at(-1) ?? 0) + block.length + 2],
    [],
  );
  const fitCount = cumulativeSizes.filter((size) => size <= budget).length;
  const includedCount = Math.max(fitCount, 1);
  const truncated = fitCount === 0;
  const includedBlocks = truncated
    ? [
        `${blocks[0].slice(0, budget)}\n[예산 초과로 이 커밋의 나머지 diff 생략]`,
      ]
    : blocks.slice(0, includedCount);
  const deferredCount = commits.length - includedCount;
  const deferredNote =
    deferredCount > 0 ? ` (나머지 ${deferredCount}건은 다음 회차)` : '';
  const header = `upstream 커밋 ${commits.length}건 중 오래된 순 ${includedCount}건${deferredNote}`;
  return {
    text: [header, ...includedBlocks].join('\n\n'),
    lastHash: commits[includedCount - 1].hash,
    deferredCount,
  };
};

const renderCommit = ({ hash, subject, patch }: UpstreamCommit): string =>
  `커밋 ${hash.slice(0, 7)} ${subject}\n${patch.trim()}`;
