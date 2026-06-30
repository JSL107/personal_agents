import { PREVIEW_KIND } from '../../preview-gate/domain/preview-action.type';
import { DocsAuditPrApplier } from './docs-audit-pr.applier';

function makeGithub(result: any) {
  return { pushBranchAndOpenPr: jest.fn().mockResolvedValue(result) } as any;
}
const basePreview = {
  id: 'p1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.DOCS_AUDIT_PR,
  status: 'PENDING',
  previewText: 't',
  responseUrl: null,
  expiresAt: new Date(0),
  createdAt: new Date(0),
  appliedAt: null,
  cancelledAt: null,
};
const payload = {
  files: [{ path: 'README.md', content: 'new' }],
  changedFiles: ['README.md'],
  rationale: '문서 동기화',
  repoLabel: 'JSL107/personal_agents',
  baseBranch: 'main',
};

it('payload 검증 후 pushBranchAndOpenPr 호출 + github_pr artifact', async () => {
  const github = makeGithub({
    prUrl: 'http://x/1',
    prNumber: 1,
    branchRef: 'refs/heads/b',
    commitSha: 'abc123',
  });
  const applier = new DocsAuditPrApplier(github);
  const result = await applier.apply({ ...basePreview, payload } as any);
  expect(github.pushBranchAndOpenPr).toHaveBeenCalledTimes(1);
  const arg = github.pushBranchAndOpenPr.mock.calls[0][0];
  expect(arg.repo).toBe('JSL107/personal_agents');
  expect(arg.baseBranch).toBe('main');
  expect(arg.files).toEqual([{ path: 'README.md', content: 'new' }]);
  expect(arg.branchName).toMatch(/^docs\/idaeri-docs-sync-/u);
  expect(result.artifacts).toEqual([
    { type: 'github_pr', repo: 'JSL107/personal_agents', prNumber: 1 },
  ]);
  expect(result.message).toContain('http://x/1');
});

it('payload 형식 불량이면 throw (push 안 함)', async () => {
  const github = makeGithub({});
  const applier = new DocsAuditPrApplier(github);
  await expect(
    applier.apply({ ...basePreview, payload: { bad: true } } as any),
  ).rejects.toBeDefined();
  expect(github.pushBranchAndOpenPr).not.toHaveBeenCalled();
});
