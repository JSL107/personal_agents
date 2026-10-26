import { RevisionLineChanges } from './revision-rate';

interface RevisableLines {
  changes?: RevisionLineChanges;
}

/**
 * `count.percent`는 반올림돼 한두 줄 수정에도 0%일 수 있다. 변경 없는 글을 재료에
 * 포함하면 모델이 `(없음)` 입력에서 편집 규칙을 지어낼 수 있어 실제 줄만 확인한다.
 */
export const hasRevisedLines = (row: RevisableLines): boolean => {
  const added = row.changes?.addedLines.length ?? 0;
  const removed = row.changes?.removedLines.length ?? 0;
  return added > 0 || removed > 0;
};
