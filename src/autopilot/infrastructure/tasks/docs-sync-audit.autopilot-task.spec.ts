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
    result: { deterministic: { inSync: true, details: [] }, proposals: [] },
  });
  expect(await task.run(ctx)).toEqual({ skip: true });
});

it('이슈 있으면 summaryText 포함', async () => {
  const { task } = makeTask({
    result: {
      deterministic: { inSync: false, details: ['docs:check FAIL'] },
      proposals: [],
    },
  });
  const result = await task.run(ctx);
  expect(result.skip).toBe(false);
  expect(result.summaryText).toContain('docs:check');
});

it("DOCS_AUDIT_ENABLED='false' 면 runAudit 호출 안 하고 skip", async () => {
  const { task, audit } = makeTask({ enabled: 'false' });
  expect(await task.run(ctx)).toEqual({ skip: true });
  expect(audit.runAudit).not.toHaveBeenCalled();
});
