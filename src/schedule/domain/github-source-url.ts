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
