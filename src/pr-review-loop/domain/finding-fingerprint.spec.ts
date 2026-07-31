import { buildFindingFingerprint } from './finding-fingerprint';

describe('buildFindingFingerprint', () => {
  const base = {
    repo: 'JSL107/personal_agents',
    pullNumber: 180,
    filePath: 'src/foo.service.ts',
    body: '트랜잭션 밖에서 저장한다',
  };

  it('같은 입력은 같은 지문을 낸다', () => {
    expect(buildFindingFingerprint(base)).toBe(buildFindingFingerprint(base));
  });

  it('공백·대소문자 차이는 같은 지문으로 뭉친다', () => {
    const noisy = { ...base, body: '  트랜잭션  밖에서   저장한다 ' };

    expect(buildFindingFingerprint(noisy)).toBe(buildFindingFingerprint(base));
  });

  it('본문이 다르면 지문이 다르다', () => {
    const other = { ...base, body: '인덱스가 없다' };

    expect(buildFindingFingerprint(other)).not.toBe(
      buildFindingFingerprint(base),
    );
  });

  it('PR 번호가 다르면 지문이 다르다 — 다른 PR 의 같은 지적은 별개 카드', () => {
    const other = { ...base, pullNumber: 181 };

    expect(buildFindingFingerprint(other)).not.toBe(
      buildFindingFingerprint(base),
    );
  });

  it('파일이 없어도(null) 지문을 만든다', () => {
    const noFile = { ...base, filePath: null };

    expect(buildFindingFingerprint(noFile)).toHaveLength(64);
  });

  it('파일이 다르면 지문이 다르다', () => {
    const other = { ...base, filePath: 'src/bar.util.ts' };

    expect(buildFindingFingerprint(other)).not.toBe(
      buildFindingFingerprint(base),
    );
  });
});
