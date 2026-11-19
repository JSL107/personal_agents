import { RubricItemKey } from '../domain/docs-audit-rubric.type';
import { RunDocsAuditUseCase, SOT_TO_DOC } from './run-docs-audit.usecase';

const cleanDeterministic = { inSync: true, details: [] };
const REQUIRED = [
  RubricItemKey.FACTUAL,
  RubricItemKey.COMPLETE,
  RubricItemKey.SCOPED,
];

// evaluator 는 scoreRubric 결과를 돌려준다 — 루프는 pass·failedRequired 만 본다.
const verdict = (failedRequired: RubricItemKey[], feedback = 'f') => ({
  items: [],
  judgeable: true,
  pass: failedRequired.length === 0,
  score: 100 - failedRequired.length * 25,
  failedRequired,
  feedback,
});

const revise = (oldString = 'a', newString = 'b') => ({
  needsRevision: true,
  filePath: 'README.md',
  edits: [{ oldString, newString }],
  rationale: 'r',
});

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
    // 원문 유일성 사전검사가 보는 문서 전체 — 'a' 가 정확히 한 번 나온다.
    fullReader: jest.fn().mockResolvedValue('문서 a 끝'),
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
    d.fullReader,
  );

it('(a) 필수 항목 모두 통과 → 확정 제안 1건 (edits·점수 포함)', async () => {
  const d = makeDeps();
  d.judge.optimize.mockResolvedValue(revise());
  d.judge.evaluate.mockResolvedValue(verdict([]));
  const result = await build(d).runAudit();
  expect(result.proposals).toHaveLength(1);
  expect(result.proposals[0]).toMatchObject({
    confirmed: true,
    score: 100,
    failedRequired: [],
    edits: [{ oldString: 'a', newString: 'b' }],
  });
});

it('평가자는 고치기 전 문서 발췌도 받는다 (빠짐없음 판정 재료)', async () => {
  const d = makeDeps();
  d.judge.optimize.mockResolvedValue(revise());
  d.judge.evaluate.mockResolvedValue(verdict([]));
  await build(d).runAudit();
  const call = d.judge.evaluate.mock.calls[0][0];
  expect(call.docExcerpt).toContain('README.md');
  expect(call.editsSummary).toContain('a');
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

it('(b) 실패 항목이 줄기만 하고 통과 못 하면 maxIterations 후 미확정 — 가장 나았던 회차를 남긴다', async () => {
  const d = makeDeps({ maxIterations: 3 });
  d.judge.optimize
    .mockResolvedValueOnce(revise('a', 'b1'))
    .mockResolvedValueOnce(revise('a', 'b2'))
    .mockResolvedValueOnce(revise('a', 'b3'));
  d.judge.evaluate
    .mockResolvedValueOnce(verdict(REQUIRED))
    .mockResolvedValueOnce(verdict(REQUIRED.slice(0, 2)))
    .mockResolvedValueOnce(verdict([RubricItemKey.COMPLETE]));
  const result = await build(d).runAudit();
  expect(d.judge.optimize).toHaveBeenCalledTimes(3);
  expect(result.proposals[0]).toMatchObject({
    confirmed: false,
    failedRequired: [RubricItemKey.COMPLETE],
    edits: [{ oldString: 'a', newString: 'b3' }],
  });
});

it('(c) 실패 필수 항목 수가 줄지 않으면 정체로 조기 중단', async () => {
  const d = makeDeps({ maxIterations: 5 });
  d.judge.optimize.mockResolvedValue(revise());
  d.judge.evaluate.mockResolvedValue(verdict([RubricItemKey.SCOPED]));
  await build(d).runAudit();
  // 1회차(실패 1) + 2회차(실패 1, 개선 없음 감지) → 3회차로 안 감.
  expect(d.judge.optimize).toHaveBeenCalledTimes(2);
});

it('정체로 끝나면 더 나빠진 마지막 회차가 아니라 앞선 회차를 남긴다', async () => {
  const d = makeDeps();
  d.judge.optimize
    .mockResolvedValueOnce(revise('a', 'good'))
    .mockResolvedValueOnce(revise('a', 'worse'));
  d.judge.evaluate
    .mockResolvedValueOnce(verdict([RubricItemKey.COMPLETE]))
    .mockResolvedValueOnce(verdict(REQUIRED));
  const result = await build(d).runAudit();
  expect(d.judge.optimize).toHaveBeenCalledTimes(2);
  expect(result.proposals[0].edits[0].newString).toBe('good');
  expect(result.proposals[0].confirmed).toBe(false);
});

it('실패 항목과 근거가 다음 회차 수정 지시로 넘어간다', async () => {
  const d = makeDeps();
  d.judge.optimize.mockResolvedValue(revise());
  d.judge.evaluate
    .mockResolvedValueOnce(
      verdict(REQUIRED, 'complete(빠짐없음): 기본값 5 → 3 을 안 고침'),
    )
    .mockResolvedValueOnce(verdict([]));
  await build(d).runAudit();
  expect(d.judge.optimize.mock.calls[0][0].evaluatorFeedback).toBeUndefined();
  expect(d.judge.optimize.mock.calls[1][0].evaluatorFeedback).toBe(
    'complete(빠짐없음): 기본값 5 → 3 을 안 고침',
  );
});

it('원문이 문서 전체에 정확히 한 번 나오지 않으면 평가자를 부르지 않고 사유를 다음 회차로 넘긴다', async () => {
  const d = makeDeps({ fullReader: jest.fn().mockResolvedValue('a 와 a') });
  d.judge.optimize
    .mockResolvedValueOnce(revise('a', 'b'))
    .mockResolvedValueOnce(revise('와', 'b'));
  d.judge.evaluate.mockResolvedValue(verdict([]));
  const result = await build(d).runAudit();
  expect(d.judge.evaluate).toHaveBeenCalledTimes(1);
  expect(d.judge.optimize.mock.calls[1][0].evaluatorFeedback).toContain(
    'unique: 편집 #1',
  );
  expect(result.proposals[0].confirmed).toBe(true);
});

it('바꾸는 내용이 없는 편집은 사전검사에서 실패한다', async () => {
  const d = makeDeps({ maxIterations: 1 });
  d.judge.optimize.mockResolvedValue(revise('a', 'a'));
  const result = await build(d).runAudit();
  expect(d.judge.evaluate).not.toHaveBeenCalled();
  expect(result.proposals[0]).toMatchObject({
    confirmed: false,
    failedRequired: REQUIRED,
  });
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

// autopilot task 의 발화 흔적(AutopilotTaskTrace)이 "판정 대상 건수"로 소비한다 — 판정
// 루프에 실제로 들어가는 파일 수를 노출해야 한다.
it('candidateFileCount 는 판정 대상이 된 SoT 파일 수를 반영한다', async () => {
  const d = makeDeps({
    gitFiles: {
      recentlyChangedSotFiles: jest
        .fn()
        .mockResolvedValue([
          'src/config/app.config.ts',
          'src/agent-registry/agent-registry.ts',
        ]),
    },
  });
  d.judge.optimize.mockResolvedValue({
    needsRevision: false,
    filePath: 'README.md',
    edits: [],
    rationale: '',
  });
  const result = await build(d).runAudit();
  expect(result.candidateFileCount).toBe(2);
});

// 매핑이 없는 SoT 는 auditOneFile 의 첫 분기에서 빠져 LLM 을 한 번도 부르지 않는다. 그것을
// 후보로 세면 흔적이 "LLM 을 불렀다" 고 잘못 적어, 가리려던 원인("판정 대상이 없었다")을 덮는다.
it('SOT_TO_DOC 매핑이 없는 후보는 candidateFileCount 에서 빠진다', async () => {
  const d = makeDeps({
    gitFiles: {
      recentlyChangedSotFiles: jest
        .fn()
        .mockResolvedValue([
          'src/config/app.config.ts',
          'src/unmapped/whatever.ts',
        ]),
    },
  });
  d.judge.optimize.mockResolvedValue({
    needsRevision: false,
    filePath: 'README.md',
    edits: [],
    rationale: '',
  });

  const result = await build(d).runAudit();

  expect(result.candidateFileCount).toBe(1);
  expect(d.judge.optimize).toHaveBeenCalledTimes(1);
});

it('매핑된 후보가 하나도 없으면 candidateFileCount=0 이고 LLM 을 부르지 않는다', async () => {
  const d = makeDeps({
    gitFiles: {
      recentlyChangedSotFiles: jest
        .fn()
        .mockResolvedValue(['src/unmapped/whatever.ts']),
    },
  });

  const result = await build(d).runAudit();

  expect(result.candidateFileCount).toBe(0);
  expect(d.judge.optimize).not.toHaveBeenCalled();
});

it('후보 파일이 0건이면 candidateFileCount=0 (LLM 미호출)', async () => {
  const d = makeDeps({
    gitFiles: { recentlyChangedSotFiles: jest.fn().mockResolvedValue([]) },
  });
  const result = await build(d).runAudit();
  expect(result.candidateFileCount).toBe(0);
  expect(d.judge.optimize).not.toHaveBeenCalled();
});
