import { diffSnapshots } from './diff-snapshots';
import { StateSnapshot } from './subconscious.type';

const snap = (items: { key: string; fingerprint: string }[]): StateSnapshot => ({
  sourceId: 'github',
  contentHash: items.map((i) => i.fingerprint).join(','),
  items: items.map((i) => ({ ...i, summary: i.key })),
});

describe('diffSnapshots', () => {
  it('prev=null 이면 모든 항목이 added', () => {
    const changes = diffSnapshots(null, snap([{ key: 'a', fingerprint: '1' }]));
    expect(changes).toEqual([
      expect.objectContaining({ kind: 'added', item: expect.objectContaining({ key: 'a' }) }),
    ]);
  });

  it('contentHash 동일하면 변화 없음(빈 배열) — fast path', () => {
    const a = snap([{ key: 'a', fingerprint: '1' }]);
    expect(diffSnapshots(a, snap([{ key: 'a', fingerprint: '1' }]))).toEqual([]);
  });

  it('fingerprint 바뀌면 modified', () => {
    const prev = snap([{ key: 'a', fingerprint: '1' }]);
    const curr = snap([{ key: 'a', fingerprint: '2' }]);
    expect(diffSnapshots(prev, curr)).toEqual([
      expect.objectContaining({ kind: 'modified' }),
    ]);
  });

  it('사라진 key 는 removed', () => {
    const prev = snap([{ key: 'a', fingerprint: '1' }, { key: 'b', fingerprint: '1' }]);
    const curr = snap([{ key: 'a', fingerprint: '1' }]);
    expect(diffSnapshots(prev, curr)).toEqual([
      expect.objectContaining({ kind: 'removed', item: expect.objectContaining({ key: 'b' }) }),
    ]);
  });
});
