import { StateChange, StateSnapshot } from './subconscious.type';

// 두 스냅샷을 비교해 added/modified/removed 변화를 도출하는 순수 함수.
// contentHash 가 동일하면 즉시 빈 배열(무료 idle 틱의 핵심).
export const diffSnapshots = (
  previous: StateSnapshot | null,
  current: StateSnapshot,
): StateChange[] => {
  if (previous && previous.contentHash === current.contentHash) {
    return [];
  }

  const changes: StateChange[] = [];
  const previousByKey = new Map(
    (previous?.items ?? []).map((item) => [item.key, item]),
  );

  for (const item of current.items) {
    const found = previousByKey.get(item.key);
    if (!found) {
      changes.push({ sourceId: current.sourceId, kind: 'added', item });
    } else if (found.fingerprint !== item.fingerprint) {
      changes.push({ sourceId: current.sourceId, kind: 'modified', item });
    }
    previousByKey.delete(item.key);
  }

  for (const removed of previousByKey.values()) {
    changes.push({ sourceId: current.sourceId, kind: 'removed', item: removed });
  }

  return changes;
};
