import { buildSnapshot, sha } from './snapshot.util';

describe('snapshot.util', () => {
  it('sha 는 동일 입력에 동일 출력', () => {
    expect(sha('abc')).toBe(sha('abc'));
    expect(sha('abc')).not.toBe(sha('abd'));
  });

  it('buildSnapshot 의 contentHash 는 item fingerprint 집합에만 의존(순서 무관)', () => {
    const a = buildSnapshot('github', [
      { key: 'a', fingerprint: '1', summary: 'a' },
      { key: 'b', fingerprint: '2', summary: 'b' },
    ]);
    const b = buildSnapshot('github', [
      { key: 'b', fingerprint: '2', summary: 'b' },
      { key: 'a', fingerprint: '1', summary: 'a' },
    ]);
    expect(a.contentHash).toBe(b.contentHash);
  });
});
