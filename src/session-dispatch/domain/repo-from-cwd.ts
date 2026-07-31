// 세션 작업 디렉터리(cwd)에서 repo 이름을 추정한다(마지막 경로 세그먼트). 순수.
export function repoFromCwd(cwd: string): string | null {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    return null;
  }
  const segments = cwd.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }
  return segments[segments.length - 1];
}

// git remote URL 에서 `owner/repo` 를 뽑는다. owner 를 버리면 조직 소유 repo
// (schoolbell-e/sbe-api-v5) 에 owner 를 본인 계정으로 잘못 붙여 GitHub 검색이 422 로 깨진다.
export function repoFromRemoteUrl(remoteUrl: string): string | null {
  const trimmedRemoteUrl = remoteUrl.trim();
  if (trimmedRemoteUrl.length === 0) {
    return null;
  }

  const withoutGitSuffix = trimmedRemoteUrl.replace(/\.git(?=\/*$)/i, '');
  const withoutTrailingSlash = withoutGitSuffix.replace(/\/+$/, '');
  // scp 형식(`git@host:owner/repo`) 과 URL 형식 모두 마지막 두 세그먼트가 owner/repo.
  const matched = /[:/]([^/:]+)\/([^/:]+)$/.exec(withoutTrailingSlash);
  if (!matched) {
    return null;
  }

  return `${matched[1]}/${matched[2]}`;
}
