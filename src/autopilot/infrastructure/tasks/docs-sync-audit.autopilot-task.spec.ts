import { DocsSyncAuditTask } from './docs-sync-audit.autopilot-task';

function makeTask(over: any = {}) {
  const audit = { runAudit: jest.fn().mockResolvedValue(over.result) };
  const config = { get: jest.fn().mockReturnValue(over.enabled) };
  return {
    task: new DocsSyncAuditTask(audit as any, config as any),
    audit,
    config,
  };
}

const ctx = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-29' };

it('이슈 0건이면 skip=true', async () => {
  const { task } = makeTask({
    result: {
      deterministic: { inSync: true, details: [] },
      proposals: [],
      revision: null,
    },
  });
  expect(await task.run(ctx)).toEqual({ skip: true });
});

it('이슈 있으면 slackText 포함', async () => {
  const { task } = makeTask({
    result: {
      deterministic: { inSync: false, details: ['docs:check FAIL'] },
      proposals: [],
      revision: null,
    },
  });
  const result = await task.run(ctx);
  expect(result.skip).toBe(false);
  expect(result.slackText).toContain('docs:check');
});

it("DOCS_AUDIT_ENABLED='false' 면 runAudit 호출 안 하고 skip", async () => {
  const { task, audit } = makeTask({ enabled: 'false' });
  expect(await task.run(ctx)).toEqual({ skip: true });
  expect(audit.runAudit).not.toHaveBeenCalled();
});

it('DOCS_AUDIT_PR_ENABLED=true + revision 있으면 preview 페이로드 반환', async () => {
  const audit = {
    runAudit: jest.fn().mockResolvedValue({
      deterministic: { inSync: true, details: [] },
      proposals: [],
      revision: {
        files: [{ path: 'README.md', content: 'new' }],
        changedFiles: ['README.md'],
        previewText: '편집 요약',
      },
    }),
  };
  const config = {
    get: jest.fn((k: string) =>
      k === 'DOCS_AUDIT_PR_ENABLED'
        ? 'true'
        : k === 'DOCS_AUDIT_PR_BASE_BRANCH'
          ? 'main'
          : k === 'DOCS_AUDIT_PR_REPO'
            ? 'JSL107/personal_agents'
            : undefined,
    ),
  };
  const task = new DocsSyncAuditTask(audit as any, config as any);
  const result = await task.run(ctx);
  expect(result.skip).toBe(false);
  expect(result.preview?.kind).toBe('DOCS_AUDIT_PR');
  expect((result.preview?.payload as any).files).toEqual([
    { path: 'README.md', content: 'new' },
  ]);
  expect((result.preview?.payload as any).repoLabel).toBe(
    'JSL107/personal_agents',
  );
});

it('DOCS_AUDIT_PR_ENABLED 미설정이면 preview 없이 기존 텍스트 경로', async () => {
  const audit = {
    runAudit: jest.fn().mockResolvedValue({
      deterministic: { inSync: false, details: ['docs:check FAIL'] },
      proposals: [],
      revision: null,
    }),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const result = await new DocsSyncAuditTask(audit as any, config as any).run(
    ctx,
  );
  expect(result.preview).toBeUndefined();
  expect(result.slackText).toContain('docs:check');
});
