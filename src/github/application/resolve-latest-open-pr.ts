import { GithubClientPort } from '../domain/port/github-client.port';

export interface ResolveLatestOpenPrInput {
  author: string;
  repo: string | null;
  sinceIsoDate: string;
}

export interface ResolvedLatestOpenPr {
  prRef: string;
  notice: string;
}

// PR 미지정 콘솔 지시를 위해 author 의 최근 open PR 1건을 owner/repo#N 으로 확정한다.
// listAuthorOpenPullRequests 는 updatedAt DESC 정렬이라 [0] 이 가장 최근이다.
export const resolveLatestOpenPrRef = async (
  githubClient: GithubClientPort,
  { author, repo, sinceIsoDate }: ResolveLatestOpenPrInput,
): Promise<ResolvedLatestOpenPr | null> => {
  const openPullRequests = await githubClient.listAuthorOpenPullRequests({
    repo,
    author,
    sinceIsoDate,
    limit: 1,
  });
  const latestPullRequest = openPullRequests[0];
  if (!latestPullRequest) {
    return null;
  }

  const prRef = `${latestPullRequest.repo}#${latestPullRequest.number}`;
  return {
    prRef,
    notice: `PR 미지정 → 최근 open PR ${prRef} 자동 선택: ${latestPullRequest.title}`,
  };
};
