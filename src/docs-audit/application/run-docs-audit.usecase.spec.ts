import { RunDocsAuditUseCase } from './run-docs-audit.usecase';

const cleanDeterministic = { inSync: true, details: [] };

function makeDeps(over: Partial<any> = {}) {
  return {
    checker: { check: jest.fn().mockResolvedValue(cleanDeterministic) },
    gitFiles: {
      recentlyChangedSotFiles: jest.fn().mockResolvedValue(['README.md']),
    },
    judge: {
      optimize: jest.fn(),
      evaluate: jest.fn(),
    },
    fileReader: jest.fn().mockResolvedValue('문서/코드 발췌'),
    maxFiles: 5,
    maxIterations: 3,
    ...over,
  };
}

function build(deps: any) {
  return new RunDocsAuditUseCase(
    deps.checker,
    deps.gitFiles,
    deps.judge,
    deps.fileReader,
    deps.maxFiles,
    deps.maxIterations,
  );
}

it('(a) optimizer 1회 + evaluator green → 확정 제안 1건', async () => {
  const deps = makeDeps();
  deps.judge.optimize.mockResolvedValue({
    needsRevision: true,
    filePath: 'README.md',
    proposedDiff: 'd',
    rationale: 'r',
  });
  deps.judge.evaluate.mockResolvedValue({
    pass: true,
    score: 95,
    feedback: 'ok',
  });
  const result = await build(deps).runAudit();
  expect(result.proposals).toHaveLength(1);
  expect(result.proposals[0].confirmed).toBe(true);
  expect(deps.judge.optimize).toHaveBeenCalledTimes(1);
});

it('(b) 계속 미달 → maxIterations 회 후 미확정 종료', async () => {
  const deps = makeDeps({ maxIterations: 3 });
  deps.judge.optimize.mockResolvedValue({
    needsRevision: true,
    filePath: 'README.md',
    proposedDiff: 'd',
    rationale: 'r',
  });
  deps.judge.evaluate
    .mockResolvedValueOnce({ pass: false, score: 50, feedback: 'f1' })
    .mockResolvedValueOnce({ pass: false, score: 60, feedback: 'f2' })
    .mockResolvedValueOnce({ pass: false, score: 70, feedback: 'f3' });
  const result = await build(deps).runAudit();
  expect(deps.judge.optimize).toHaveBeenCalledTimes(3);
  expect(result.proposals[0].confirmed).toBe(false);
});

it('(c) score 개선 없음 → Circuit Breaker 조기 중단', async () => {
  const deps = makeDeps({ maxIterations: 5 });
  deps.judge.optimize.mockResolvedValue({
    needsRevision: true,
    filePath: 'README.md',
    proposedDiff: 'd',
    rationale: 'r',
  });
  deps.judge.evaluate.mockResolvedValue({
    pass: false,
    score: 50,
    feedback: 'stuck',
  });
  await build(deps).runAudit();
  // 1회차(50) + 2회차(50, 개선없음 감지) → 3회차로 안 감
  expect(deps.judge.optimize).toHaveBeenCalledTimes(2);
});

it('(d) needsRevision=false → 제안 없음 (루프 진입 안 함)', async () => {
  const deps = makeDeps();
  deps.judge.optimize.mockResolvedValue({
    needsRevision: false,
    filePath: 'README.md',
    proposedDiff: '',
    rationale: '',
  });
  const result = await build(deps).runAudit();
  expect(result.proposals).toHaveLength(0);
  expect(deps.judge.evaluate).not.toHaveBeenCalled();
});
