import { CodexDocsJudgeAdapter } from './codex-docs-judge.adapter';

describe('CodexDocsJudgeAdapter', () => {
  const makeRouter = (text: string) =>
    ({ route: jest.fn().mockResolvedValue({ text }) }) as any;

  it('optimize: edits 배열 파싱', async () => {
    const router = makeRouter(
      '{"needsRevision": true, "edits": [{"oldString":"a","newString":"b"}], "rationale": "r"}',
    );
    const out = await new CodexDocsJudgeAdapter(router).optimize({
      filePath: 'README.md',
      codeContext: 'c',
      docExcerpt: 'd',
    });
    expect(out.needsRevision).toBe(true);
    expect(out.edits).toEqual([{ oldString: 'a', newString: 'b' }]);
    expect(out.filePath).toBe('README.md');
  });

  it('optimize: edits 없거나 형식 불량이면 needsRevision=false + 빈 edits', async () => {
    const out = await new CodexDocsJudgeAdapter(
      makeRouter('주절주절'),
    ).optimize({
      filePath: 'x',
      codeContext: '',
      docExcerpt: '',
    });
    expect(out.needsRevision).toBe(false);
    expect(out.edits).toEqual([]);
  });

  it('evaluate: pass/score 파싱(editsSummary 입력)', async () => {
    const router = makeRouter('{"pass": true, "score": 95, "feedback": "ok"}');
    const verdict = await new CodexDocsJudgeAdapter(router).evaluate({
      filePath: 'README.md',
      codeContext: 'c',
      editsSummary: 'a→b',
    });
    expect(verdict).toEqual({ pass: true, score: 95, feedback: 'ok' });
  });
});
