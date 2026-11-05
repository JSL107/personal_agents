import { PullRequestCommitState } from '../domain/github.type';
import {
  GithubClientPort,
  PullRequestRef,
} from '../domain/port/github-client.port';

// 상세를 받은 뒤 지금까지 무엇이 바뀌었는지. 상세와 diff 는 원자적으로 받을 수 없어서, diff 를
// 받은 뒤 다시 조회해 head·base 가 그대로면 diff 도 상세와 같은 커밋 기준이라고 본다.
export type SnapshotDrift =
  | { kind: 'NONE' }
  | { kind: 'MOVED'; currentHeadSha: string }
  | { kind: 'MERGED' };

// 커밋 이동을 머지보다 먼저 본다. 머지를 무시하는 호출자(직접 요청한 리뷰)도 섞인 스냅샷은
// 걸러야 하기 때문이다.
export const checkSnapshotDrift = async (
  githubClient: GithubClientPort,
  ref: PullRequestRef,
  fetched: PullRequestCommitState,
): Promise<SnapshotDrift> => {
  const current = await githubClient.getPullRequestCommitState(ref);
  if (
    current.headSha !== fetched.headSha ||
    current.baseSha !== fetched.baseSha
  ) {
    return { kind: 'MOVED', currentHeadSha: current.headSha };
  }
  if (current.mergedAt !== null) {
    return { kind: 'MERGED' };
  }
  return { kind: 'NONE' };
};
