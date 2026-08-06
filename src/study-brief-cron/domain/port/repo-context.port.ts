export const REPO_CONTEXT_PORT = Symbol('REPO_CONTEXT_PORT');

export interface RepoModuleSummary {
  name: string;
  description: string;
}

export interface RepoContextPort {
  collect(): Promise<RepoModuleSummary[]>;
}
