import { execFileSync } from 'node:child_process';

import { repoFromCwd, repoFromRemoteUrl } from '../domain/repo-from-cwd';

export function resolveRepoFromGit(
  cwd: string,
  runGit: (cwd: string) => string | null,
): string | null {
  const remoteUrl = runGit(cwd);
  return repoFromRemoteUrl(remoteUrl ?? '') ?? repoFromCwd(cwd);
}

export function defaultRunGit(cwd: string): string | null {
  try {
    const output = execFileSync(
      'git',
      ['-C', cwd, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8' },
    );
    const remoteUrl = output.split(/\r?\n/, 1)[0].trim();
    return remoteUrl.length > 0 ? remoteUrl : null;
  } catch {
    return null;
  }
}

export function defaultResolveRepo(cwd: string): string | null {
  return resolveRepoFromGit(cwd, defaultRunGit);
}
