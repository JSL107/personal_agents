import { CodexDocsJudgeAdapter } from './codex-docs-judge.adapter';

describe('CodexDocsJudgeAdapter', () => {
  const makeRouter = (text: string) =>
    ({ route: jest.fn().mockResolvedValue({ text }) }) as any;

  it('optimize: codex JSON 응답을 OptimizerOutput 으로 파싱', async () => {
    const router = makeRouter(
      '{"needsRevision": true, "proposedDiff": "d", "rationale": "r"}',
    );
    const adapter = new CodexDocsJudgeAdapter(router);
    const out = await adapter.optimize({
      filePath: 'README.md',
      codeContext: 'c',
      docExcerpt: 'd',
    });
    expect(out.needsRevision).toBe(true);
    expect(out.filePath).toBe('README.md');
  });

  it('evaluate: pass/score 파싱', async () => {
    const router = makeRouter('{"pass": true, "score": 95, "feedback": "ok"}');
    const adapter = new CodexDocsJudgeAdapter(router);
    const verdict = await adapter.evaluate({
      filePath: 'README.md',
      codeContext: 'c',
      proposedDiff: 'd',
    });
    expect(verdict).toEqual({ pass: true, score: 95, feedback: 'ok' });
  });

  it('JSON 없는 응답은 안전 기본값(needsRevision=false / pass=false)', async () => {
    const adapter = new CodexDocsJudgeAdapter(makeRouter('주절주절'));
    expect(
      (
        await adapter.optimize({
          filePath: 'x',
          codeContext: '',
          docExcerpt: '',
        })
      ).needsRevision,
    ).toBe(false);
    expect(
      (
        await adapter.evaluate({
          filePath: 'x',
          codeContext: '',
          proposedDiff: '',
        })
      ).pass,
    ).toBe(false);
  });
});
