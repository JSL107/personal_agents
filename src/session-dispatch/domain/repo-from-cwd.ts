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

// github.com remote 의 owner/repo — scheme(`https://`, `ssh://`) 과 자격증명(`user@`,
// `x-access-token:TOKEN@`) 은 선택, scp 형식(`git@github.com:owner/repo`) 도 같이 받는다.
// host 를 github.com 으로 못박아 로컬 경로 remote(`/srv/mirrors/repo.git`) 의 상위 디렉터리가
// owner 로 오인되는 것을 막는다.
const GITHUB_OWNER_REPO_PATTERN =
  /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^/]+@)?github\.com[:/]([^/:]+)\/([^/:]+)$/i;

// git remote URL 에서 repo 를 뽑는다.
// - github.com remote: `owner/repo`. owner 를 버리면 조직 소유 repo
//   (schoolbell-e/sbe-api-v5) 에 owner 를 본인 계정으로 잘못 붙여 GitHub 검색이 422 로 깨진다.
// - 그 밖(로컬 미러 `/srv/mirrors/repo.git`, `file://`, 사설 호스트): GitHub owner 를 알 수
//   없으므로 repo 이름만. 호출측이 종전대로 본인 계정을 붙인다.
export function repoFromRemoteUrl(remoteUrl: string): string | null {
  const trimmedRemoteUrl = remoteUrl.trim();
  if (trimmedRemoteUrl.length === 0) {
    return null;
  }

  const withoutGitSuffix = trimmedRemoteUrl.replace(/\.git(?=\/*$)/i, '');
  const withoutTrailingSlash = withoutGitSuffix.replace(/\/+$/, '');
  const githubMatched = GITHUB_OWNER_REPO_PATTERN.exec(withoutTrailingSlash);
  if (githubMatched) {
    return `${githubMatched[1]}/${githubMatched[2]}`;
  }

  const schemeSeparatorIndex = withoutTrailingSlash.indexOf('://');
  if (
    schemeSeparatorIndex >= 0 &&
    !withoutTrailingSlash.includes('/', schemeSeparatorIndex + 3)
  ) {
    return null;
  }

  const lastSeparatorIndex = Math.max(
    withoutTrailingSlash.lastIndexOf('/'),
    withoutTrailingSlash.lastIndexOf(':'),
  );
  if (lastSeparatorIndex < 0) {
    return null;
  }

  const repository = withoutTrailingSlash.slice(lastSeparatorIndex + 1);
  return repository.length > 0 ? repository : null;
}
