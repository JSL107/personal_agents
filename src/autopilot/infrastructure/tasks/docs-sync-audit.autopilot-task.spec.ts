import { DocsSyncAuditTask } from './docs-sync-audit.autopilot-task';

function makeTrace() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

type TaskOverrides = {
  result?: unknown;
  enabled?: string;
  trace?: { record: jest.Mock };
};

function makeTask(over: TaskOverrides = {}) {
  const audit = { runAudit: jest.fn().mockResolvedValue(over.result) };
  const config = { get: jest.fn().mockReturnValue(over.enabled) };
  const trace = over.trace ?? makeTrace();
  return {
    task: new DocsSyncAuditTask(
      audit as never,
      config as never,
      trace as never,
    ),
    audit,
    config,
    trace,
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
      candidateFileCount: 0,
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
      candidateFileCount: 1,
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
      candidateFileCount: 1,
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
  const task = new DocsSyncAuditTask(
    audit as any,
    config as any,
    makeTrace() as any,
  );
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
      candidateFileCount: 1,
    }),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const result = await new DocsSyncAuditTask(
    audit as any,
    config as any,
    makeTrace() as any,
  ).run(ctx);
  expect(result.preview).toBeUndefined();
  expect(result.summaryText).toContain('docs:check');
});

// 이 작업의 존재 이유 — 게이트가 꺼져 있으면 runAudit 자체를 안 부르지만(위 테스트),
// "이 주에 docs-sync-audit 이 발화했고 게이트는 꺼져 있었다" 는 사실은 그래도 남아야 한다.
it('게이트가 꺼져 있어도 흔적을 남긴다', async () => {
  const { task, trace } = makeTask({ enabled: 'false' });

  await task.run(ctx);

  expect(trace.record).toHaveBeenCalledWith(
    expect.objectContaining({
      taskId: 'docs-sync-audit',
      firedAtKst: '2026-06-29',
      gateEnabled: false,
      candidateCount: null,
      llmCalled: false,
    }),
  );
});

// 게이트는 켜졌지만 최근 7일간 SoT 파일이 하나도 안 바뀐 회차 — "LLM 호출 자체가 없었다" 가
// "점검했고 드리프트 0건" 과 같은 결과(드리프트 없음)로 합쳐지지만, 흔적에는
// candidateCount=0/llmCalled=false 로 남아 구분된다.
it('판정 대상이 0건이어도 흔적을 남긴다', async () => {
  const { task, trace } = makeTask({
    result: {
      deterministic: { inSync: true, details: [] },
      proposals: [],
      revision: null,
      candidateFileCount: 0,
    },
  });

  await task.run(ctx);

  expect(trace.record).toHaveBeenCalledWith(
    expect.objectContaining({
      taskId: 'docs-sync-audit',
      firedAtKst: '2026-06-29',
      gateEnabled: true,
      candidateCount: 0,
      llmCalled: false,
    }),
  );
});

// runAudit 이 예외로 끊기는 회차(codex 쿼터 소진 등) — 후보 수를 확정하지 못한 채로도 흔적은
// 남아야 하고, 기존 실패 처리(FAILED 기록 등)가 그대로 동작하도록 예외는 그대로 다시 던진다.
it('runAudit 예외 시 흔적을 남기고 그대로 rethrow 한다', async () => {
  const trace = makeTrace();
  const audit = {
    runAudit: jest.fn().mockRejectedValue(new Error('codex 쿼터 소진')),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const task = new DocsSyncAuditTask(
    audit as never,
    config as never,
    trace as never,
  );

  await expect(task.run(ctx)).rejects.toThrow('codex 쿼터 소진');

  expect(trace.record).toHaveBeenCalledWith(
    expect.objectContaining({
      taskId: 'docs-sync-audit',
      firedAtKst: '2026-06-29',
      gateEnabled: true,
      candidateCount: null,
      llmCalled: null,
    }),
  );
});
