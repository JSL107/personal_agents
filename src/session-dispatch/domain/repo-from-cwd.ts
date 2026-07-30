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
