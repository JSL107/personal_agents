import { PullRequestRef } from '../../github/domain/port/github-client.port';
import {
  GithubItemUrlInput,
  GithubSourceUrlInput,
} from './github-source-url.type';

const githubItemUrl = ({ repo, kind, number }: GithubItemUrlInput): string =>
  `https://github.com/${repo}/${kind}/${number}`;

export const normalizeGithubIssueUrl = ({
  repo,
  number,
}: GithubSourceUrlInput): string =>
  githubItemUrl({ repo, kind: 'issues', number });

export const normalizeGithubPullRequestUrl = ({
  repo,
  number,
}: GithubSourceUrlInput): string =>
  githubItemUrl({ repo, kind: 'pull', number });
export const parsePullRequestUrl = (url: string): PullRequestRef | null => {
  const found = url.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/i,
  );
  return found ? { repo: found[1], number: Number(found[2]) } : null;
};
