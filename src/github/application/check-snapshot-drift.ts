import { PullRequestCommitState } from '../domain/github.type';
import { PullRequestRef } from '../domain/port/github-client.port';

// 상세를 받은 뒤 지금까지 무엇이 바뀌었는지. 상세와 diff 는 원자적으로 받을 수 없어서, diff 를
// 받은 뒤 다시 조회해 head·base 가 그대로면 diff 도 상세와 같은 커밋 기준이라고 본다.
// 전제: 호출자는 상세 → diff → 이 함수를 차례로 부른다. 상세와 diff 를 병렬로 받으면 diff 가
// 두 조회 사이에 놓인다는 보장이 없어 이 확인이 섞인 스냅샷을 통과시킨다.
export type SnapshotDrift =
  | { kind: 'NONE' }
  | { kind: 'MOVED'; currentHeadSha: string }
  | { kind: 'MERGED' };

// 이 확인이 쓰는 포트 메서드만 적는다(CODE_RULES §8). GithubClientPort 를 그대로 넘겨도 된다.
export interface CommitStateReader {
  getPullRequestCommitState(
    ref: PullRequestRef,
  ): Promise<PullRequestCommitState>;
}

export interface CheckSnapshotDriftInput {
  githubClient: CommitStateReader;
  ref: PullRequestRef;
  // 처음 받은 상세. PullRequestDetail 을 그대로 넘겨도 된다.
  fetched: PullRequestCommitState;
}

// 커밋 이동을 머지보다 먼저 본다. 머지를 무시하는 호출자(직접 요청한 리뷰)도 섞인 스냅샷은
// 걸러야 하기 때문이다.
export const checkSnapshotDrift = async ({
  githubClient,
  ref,
  fetched,
}: CheckSnapshotDriftInput): Promise<SnapshotDrift> => {
  const current = await githubClient.getPullRequestCommitState(ref);
  if (!isSameCommit({ current, fetched })) {
    return { kind: 'MOVED', currentHeadSha: current.headSha };
  }
  if (current.mergedAt !== null) {
    return { kind: 'MERGED' };
  }
  return { kind: 'NONE' };
};

// head 와 base 가 모두 같아야 diff 가 같다. base 만 바뀌어도(대상 브랜치 변경) diff 가 달라진다.
const isSameCommit = ({
  current,
  fetched,
}: {
  current: PullRequestCommitState;
  fetched: PullRequestCommitState;
}): boolean =>
  current.headSha === fetched.headSha && current.baseSha === fetched.baseSha;
