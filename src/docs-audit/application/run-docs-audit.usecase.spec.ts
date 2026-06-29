import { RunDocsAuditUseCase, SOT_TO_DOC } from './run-docs-audit.usecase';

const cleanDeterministic = { inSync: true, details: [] };

function makeDeps(over: any = {}) {
  return {
    checker: { check: jest.fn().mockResolvedValue(cleanDeterministic) },
    gitFiles: {
      recentlyChangedSotFiles: jest
        .fn()
        .mockResolvedValue(['src/config/app.config.ts']),
    },
    judge: { optimize: jest.fn(), evaluate: jest.fn() },
    reader: jest
      .fn()
      .mockImplementation((p: string) => Promise.resolve(`발췌:${p}`)),
    maxFiles: 5,
    maxIterations: 3,
    ...over,
  };
}
const build = (d: any) =>
  new RunDocsAuditUseCase(
    d.checker,
    d.gitFiles,
    d.judge,
    d.reader,
    d.maxFiles,
    d.maxIterations,
    d.revisionApplier ?? { buildRevision: jest.fn().mockResolvedValue(null) },
  );

it('(a) green → 확정 제안 1건 (edits 포함)', async () => {
  const d = makeDeps();
  d.judge.optimize.mockResolvedValue({
    needsRevision: true,
    filePath: 'README.md',
    edits: [{ oldString: 'a', newString: 'b' }],
    rationale: 'r',
  });
  d.judge.evaluate.mockResolvedValue({ pass: true, score: 95, feedback: 'ok' });
  const result = await build(d).runAudit();
  expect(result.proposals).toHaveLength(1);
  expect(result.proposals[0].confirmed).toBe(true);
  expect(result.proposals[0].edits).toEqual([
    { oldString: 'a', newString: 'b' },
  ]);
});

it('codeContext=SoT, docExcerpt=매핑된 targetDoc(README) 로 분리 로드', async () => {
  const d = makeDeps();
  d.judge.optimize.mockResolvedValue({
    needsRevision: false,
    filePath: 'README.md',
    edits: [],
    rationale: '',
  });
  await build(d).runAudit();
  const call = d.judge.optimize.mock.calls[0][0];
  expect(call.codeContext).toContain('src/config/app.config.ts');
  expect(call.docExcerpt).toContain(SOT_TO_DOC['src/config/app.config.ts']);
});

it('(b) 미달 → maxIterations 후 미확정', async () => {
  const d = makeDeps({ maxIterations: 3 });
  d.judge.optimize.mockResolvedValue({
    needsRevision: true,
    filePath: 'README.md',
    edits: [{ oldString: 'a', newString: 'b' }],
    rationale: 'r',
  });
  d.judge.evaluate
    .mockResolvedValueOnce({ pass: false, score: 50, feedback: 'f' })
    .mockResolvedValueOnce({ pass: false, score: 60, feedback: 'f' })
    .mockResolvedValueOnce({ pass: false, score: 70, feedback: 'f' });
  const result = await build(d).runAudit();
  expect(d.judge.optimize).toHaveBeenCalledTimes(3);
  expect(result.proposals[0].confirmed).toBe(false);
});

it('(c) score 개선 없음 → Circuit Breaker 조기 중단', async () => {
  const d = makeDeps({ maxIterations: 5 });
  d.judge.optimize.mockResolvedValue({
    needsRevision: true,
    filePath: 'README.md',
    edits: [{ oldString: 'a', newString: 'b' }],
    rationale: 'r',
  });
  d.judge.evaluate.mockResolvedValue({ pass: false, score: 50, feedback: 'stuck' });
  await build(d).runAudit();
  // 1회차(50) + 2회차(50, 개선없음 감지) → 3회차로 안 감.
  expect(d.judge.optimize).toHaveBeenCalledTimes(2);
});

it('(d) needsRevision=false → 제안 없음', async () => {
  const d = makeDeps();
  d.judge.optimize.mockResolvedValue({
    needsRevision: false,
    filePath: 'README.md',
    edits: [],
    rationale: '',
  });
  const result = await build(d).runAudit();
  expect(result.proposals).toHaveLength(0);
  expect(d.judge.evaluate).not.toHaveBeenCalled();
});
