import { createHash } from 'node:crypto';

import { StateItem, StateSnapshot } from '../domain/subconscious.type';

export const sha = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);

// contentHash 는 (key,fingerprint) 쌍의 정렬 집합에만 의존 → 순서 무관, 빠른 no-change 판정.
export const buildSnapshot = (
  sourceId: string,
  items: StateItem[],
): StateSnapshot => {
  const fingerprint = [...items]
    .map((item) => `${item.key}=${item.fingerprint}`)
    .sort()
    .join('|');
  return { sourceId, contentHash: sha(fingerprint), items };
};
