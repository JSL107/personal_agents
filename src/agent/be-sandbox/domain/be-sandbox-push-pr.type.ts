// BE 자율 개발 Phase 2b — sandbox 가 jest 통과 후 GitHub PR push 단계의 payload.
// PreviewGate payload 로 직렬화돼 PENDING preview row 에 보관 → 사용자 "응" 시 BeSandboxPushPrApplier 가 narrowing.
//
// Phase 2b-1 (scaffold): payload validation + octokit getBranch 로 base SHA 확인까지. 실제 commit 미수행.
// Phase 2b-2: octokit Git Data API 로 새 branch + multi-file commit + PR open.
export interface BeSandboxPushPrPayload {
  // Phase 2a-2 에서 합성된 unified diff. Phase 2b 의 commit 합성에 그대로 사용.
  diff: string;
  // LLM reasoning — PR body 에 동봉할 변경 의도 설명.
  reasoning: string;
  // diff 의 +++ b/<path> 와 일치하는 파일 경로 목록.
  changedFiles: string[];
  // 대상 repo 식별자 "owner/repo".
  repoLabel: string;
  // base branch (예: "main").
  baseBranch: string;
}

// "owner/repo" 형식 검증 — `/` 1개, 양쪽 모두 비어 있지 않음.
const REPO_LABEL_PATTERN = /^[^/\s]+\/[^/\s]+$/;

export const isBeSandboxPushPrPayload = (
  value: unknown,
): value is BeSandboxPushPrPayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.diff === 'string' &&
    record.diff.trim().length > 0 &&
    typeof record.reasoning === 'string' &&
    Array.isArray(record.changedFiles) &&
    record.changedFiles.every((p) => typeof p === 'string') &&
    record.changedFiles.length > 0 &&
    typeof record.repoLabel === 'string' &&
    REPO_LABEL_PATTERN.test(record.repoLabel) &&
    typeof record.baseBranch === 'string' &&
    record.baseBranch.trim().length > 0
  );
};

// "owner/repo" → [owner, repo] 분리 — caller 가 octokit 호출 args 로 사용.
export const parseRepoLabel = (
  repoLabel: string,
): { owner: string; repo: string } => {
  const slash = repoLabel.indexOf('/');
  return {
    owner: repoLabel.slice(0, slash),
    repo: repoLabel.slice(slash + 1),
  };
};
