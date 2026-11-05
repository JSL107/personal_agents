import { PullRequestCommitState } from '../domain/github.type';
import { GithubClientPort } from '../domain/port/github-client.port';
import { checkSnapshotDrift } from './check-snapshot-drift';

const FETCHED: PullRequestCommitState = {
  headSha: 'head-1',
  baseSha: 'base-1',
  mergedAt: null,
};
const REF = { repo: 'foo/bar', number: 34 };

const clientReturning = (
  current: PullRequestCommitState,
): jest.Mocked<Pick<GithubClientPort, 'getPullRequestCommitState'>> => ({
  getPullRequestCommitState: jest.fn().mockResolvedValue(current),
});

describe('checkSnapshotDrift', () => {
  it('head·base 가 그대로고 머지 전이면 NONE', async () => {
    const client = clientReturning(FETCHED);

    await expect(
      checkSnapshotDrift(client as never, REF, FETCHED),
    ).resolves.toEqual({ kind: 'NONE' });
    expect(client.getPullRequestCommitState).toHaveBeenCalledWith(REF);
  });

  it.each([
    ['head', { headSha: 'head-2' }],
    ['base', { baseSha: 'base-2' }],
  ])('%s 가 바뀌면 MOVED 와 지금 head 를 돌려준다', async (_label, moved) => {
    const current = { ...FETCHED, ...moved };

    await expect(
      checkSnapshotDrift(clientReturning(current) as never, REF, FETCHED),
    ).resolves.toEqual({ kind: 'MOVED', currentHeadSha: current.headSha });
  });

  it('커밋이 그대로인데 머지됐으면 MERGED', async () => {
    const current = { ...FETCHED, mergedAt: '2026-09-01T00:00:00Z' };

    await expect(
      checkSnapshotDrift(clientReturning(current) as never, REF, FETCHED),
    ).resolves.toEqual({ kind: 'MERGED' });
  });

  // 머지를 무시하는 호출자도 섞인 스냅샷은 걸러야 하므로 커밋 이동이 먼저다.
  it('커밋도 바뀌고 머지도 됐으면 MOVED 가 이긴다', async () => {
    const current = {
      headSha: 'head-2',
      baseSha: 'base-1',
      mergedAt: '2026-09-01T00:00:00Z',
    };

    await expect(
      checkSnapshotDrift(clientReturning(current) as never, REF, FETCHED),
    ).resolves.toEqual({ kind: 'MOVED', currentHeadSha: 'head-2' });
  });
});
