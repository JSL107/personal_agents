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

// 아래 두 건이 이 task 의 관측 가능성이다 — 주 1회 발화이고 LLM 을 안 쓰는 구간은 agent_run 에도
// 남지 않아, skip 으로 끊으면 "점검했고 깨끗하다"/"꺼둬서 안 했다"/"점검이 죽었다" 셋이 사후에
// 전부 같은 모습(흔적 0)이 된다. skip=true 로 되돌리면 이 두 건만 실패한다.
it('드리프트 0건이어도 하트비트를 남긴다 (skip=false)', async () => {
  const { task } = makeTask({
    result: {
      deterministic: { inSync: true, details: [] },
      proposals: [],
      revision: null,
    },
  });
  const result = await task.run(ctx);
  expect(result.skip).toBe(false);
  expect(result.summaryText).toContain('드리프트 없음');
  expect(result.summaryText).toContain('2026-06-29');
});

it('이슈 있으면 summaryText 포함', async () => {
  const { task } = makeTask({
    result: {
      deterministic: { inSync: false, details: ['docs:check FAIL'] },
      proposals: [],
      revision: null,
    },
  });
  const result = await task.run(ctx);
  expect(result.skip).toBe(false);
  expect(result.summaryText).toContain('docs:check');
});

it("DOCS_AUDIT_ENABLED='false' 면 runAudit 없이 '건너뜀' 하트비트", async () => {
  const { task, audit } = makeTask({ enabled: 'false' });
  const result = await task.run(ctx);
  expect(result.skip).toBe(false);
  // 문구가 달라야 한다 — "꺼둬서 안 했다" 와 "점검했고 0건" 은 서로 다른 사실이다.
  expect(result.summaryText).toContain('건너뜀');
  expect(result.summaryText).toContain('DOCS_AUDIT_ENABLED=false');
  expect(result.summaryText).not.toContain('드리프트 없음');
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
  expect(result.summaryText).toContain('docs:check');
});
