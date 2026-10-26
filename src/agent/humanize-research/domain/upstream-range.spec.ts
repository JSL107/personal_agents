import {
  chooseUpstreamRange,
  composeUpstreamText,
  UpstreamRangeKind,
} from './upstream-range';

describe('chooseUpstreamRange', () => {
  it('이전 head가 조상이면 이어지는 범위를 사용한다', () => {
    expect(chooseUpstreamRange({ priorHead: 'abc', isAncestor: true })).toEqual(
      {
        kind: UpstreamRangeKind.ANCESTOR,
        args: ['abc..upstream/main'],
      },
    );
  });

  it('강제 갱신이면 최근 30일 범위를 사용한다', () => {
    expect(
      chooseUpstreamRange({ priorHead: 'abc', isAncestor: false }),
    ).toEqual({
      kind: UpstreamRangeKind.RECENT,
      args: ['--since=30 days ago', 'upstream/main'],
    });
  });

  it('첫 회차도 최근 30일 범위를 사용한다', () => {
    expect(
      chooseUpstreamRange({ priorHead: null, isAncestor: false }).kind,
    ).toBe(UpstreamRangeKind.RECENT);
  });
});

describe('composeUpstreamText', () => {
  it('diff 가 예산을 넘어도 커밋 목록은 전부 남긴다', () => {
    const commits = 'aaa 첫 커밋\nbbb 둘째 커밋\nccc 오래된 커밋';
    const text = composeUpstreamText({
      commits,
      patch: 'x'.repeat(500),
      budget: 200,
    });

    expect(text).toContain('ccc 오래된 커밋');
    expect(text).toContain('[예산 초과로 나머지 diff 생략]');
  });

  it('예산 안이면 diff 를 그대로 싣는다', () => {
    const text = composeUpstreamText({
      commits: 'aaa 커밋',
      patch: 'diff 본문',
      budget: 1_000,
    });

    expect(text.endsWith('diff 본문')).toBe(true);
  });
});
