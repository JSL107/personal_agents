import { UpstreamRangeKind } from './humanize-research.type';
import { chooseUpstreamRange, selectUpstreamCommits } from './upstream-range';

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

describe('selectUpstreamCommits', () => {
  const commit = (hash: string, size: number) => ({
    hash,
    subject: `커밋 ${hash}`,
    patch: 'x'.repeat(size),
  });

  it('예산이 차면 그 앞 커밋까지만 싣고 처리 기록은 마지막으로 실은 커밋을 가리킨다', () => {
    const selection = selectUpstreamCommits({
      commits: [commit('a1', 100), commit('b2', 100), commit('c3', 100)],
      budget: 260,
    });

    expect(selection?.lastHash).toBe('b2');
    expect(selection?.deferredCount).toBe(1);
    expect(selection?.text).toContain('커밋 b2');
    // 못 실은 커밋은 내용도 제목도 싣지 않는다 — 다음 회차가 처음부터 본다.
    expect(selection?.text).not.toContain('커밋 c3');
    expect(selection?.text).toContain('나머지 1건은 다음 회차');
  });

  it('예산 안이면 전부 싣고 끝 커밋까지 전진한다', () => {
    const selection = selectUpstreamCommits({
      commits: [commit('a1', 10), commit('b2', 10)],
      budget: 1_000,
    });

    expect(selection?.lastHash).toBe('b2');
    expect(selection?.deferredCount).toBe(0);
  });

  it('첫 커밋 하나가 예산보다 크면 그 커밋만 잘라 싣고 한 칸 전진한다', () => {
    const selection = selectUpstreamCommits({
      commits: [commit('a1', 500), commit('b2', 10)],
      budget: 100,
    });

    expect(selection?.lastHash).toBe('a1');
    expect(selection?.deferredCount).toBe(1);
    expect(selection?.text).toContain(
      '[예산 초과로 이 커밋의 나머지 diff 생략]',
    );
  });

  it('커밋이 없으면 null', () => {
    expect(selectUpstreamCommits({ commits: [], budget: 100 })).toBeNull();
  });
});
