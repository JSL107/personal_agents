// docs-sync-audit Phase 2 — PreviewGate payload. DocsRevisionApplier 가 산출, DocsAuditPrApplier 가 narrow.
export interface DocsAuditPrPayload {
  files: { path: string; content: string }[]; // 전체 새 content
  changedFiles: string[];
  rationale: string; // PR body 에 동봉할 변경 의도
  repoLabel: string; // "owner/repo"
  baseBranch: string;
}

const REPO_LABEL_PATTERN = /^[^/\s]+\/[^/\s]+$/u;

export const isDocsAuditPrPayload = (
  value: unknown,
): value is DocsAuditPrPayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.files) &&
    record.files.length > 0 &&
    record.files.every(
      (file) =>
        file !== null &&
        typeof file === 'object' &&
        typeof (file as Record<string, unknown>).path === 'string' &&
        typeof (file as Record<string, unknown>).content === 'string',
    ) &&
    Array.isArray(record.changedFiles) &&
    record.changedFiles.every((path) => typeof path === 'string') &&
    record.changedFiles.length > 0 &&
    typeof record.rationale === 'string' &&
    typeof record.repoLabel === 'string' &&
    REPO_LABEL_PATTERN.test(record.repoLabel) &&
    typeof record.baseBranch === 'string' &&
    record.baseBranch.trim().length > 0
  );
};

export const parseRepoLabel = (
  repoLabel: string,
): { owner: string; repo: string } => {
  const slash = repoLabel.indexOf('/');
  return { owner: repoLabel.slice(0, slash), repo: repoLabel.slice(slash + 1) };
};
