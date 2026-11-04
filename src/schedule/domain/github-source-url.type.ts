export interface GithubSourceUrlInput {
  repo: string;
  number: number;
}

export interface GithubItemUrlInput extends GithubSourceUrlInput {
  kind: 'issues' | 'pull';
}
