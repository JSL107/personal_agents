import { CodexDocsJudgeAdapter } from './codex-docs-judge.adapter';

describe('CodexDocsJudgeAdapter', () => {
  const makeRouter = (text: string) =>
    ({
      route: jest.fn().mockResolvedValue({ text, modelUsed: 'codex' }),
    }) as any;
  // execute 는 run 결과를 그대로 돌려준다 — 원장 기록 여부는 호출 인자로 확인한다.
  let agentRunService: { execute: jest.Mock };
  beforeEach(() => {
    agentRunService = {
      execute: jest.fn(async ({ run }) => ({
        ...(await run({})),
        agentRunId: 1,
      })),
    };
  });
  const adapter = (router: any) =>
    new CodexDocsJudgeAdapter(router, agentRunService as any);

  it('optimize: edits 배열 파싱', async () => {
    const router = makeRouter(
      '{"needsRevision": true, "edits": [{"oldString":"a","newString":"b"}], "rationale": "r"}',
    );
    const out = await adapter(router).optimize({
      filePath: 'README.md',
      codeContext: 'c',
      docExcerpt: 'd',
    });
    expect(out.needsRevision).toBe(true);
    expect(out.edits).toEqual([{ oldString: 'a', newString: 'b' }]);
    expect(out.filePath).toBe('README.md');
  });

  it('optimize: edits 없거나 형식 불량이면 needsRevision=false + 빈 edits', async () => {
    const out = await adapter(makeRouter('주절주절')).optimize({
      filePath: 'x',
      codeContext: '',
      docExcerpt: '',
    });
    expect(out.needsRevision).toBe(false);
    expect(out.edits).toEqual([]);
  });

  it('evaluate: pass/score 파싱(editsSummary 입력)', async () => {
    const router = makeRouter('{"pass": true, "score": 95, "feedback": "ok"}');
    const verdict = await adapter(router).evaluate({
      filePath: 'README.md',
      codeContext: 'c',
      editsSummary: 'a→b',
    });
    expect(verdict).toEqual({ pass: true, score: 95, feedback: 'ok' });
  });

  it('optimize·evaluate 는 각자 자기 agentType 으로 AgentRun 을 남긴다', async () => {
    const router = makeRouter('{"pass": true, "score": 90}');
    await adapter(router).optimize({
      filePath: 'a.md',
      codeContext: '',
      docExcerpt: '',
    });
    await adapter(router).evaluate({
      filePath: 'a.md',
      codeContext: '',
      editsSummary: '',
    });
    expect(
      agentRunService.execute.mock.calls.map(([call]) => [
        call.agentType,
        call.triggerType,
      ]),
    ).toEqual([
      ['DOCS_AUDIT_OPTIMIZER', 'DOCS_AUDIT_LAYER2'],
      ['DOCS_AUDIT_EVALUATOR', 'DOCS_AUDIT_LAYER2'],
    ]);
  });
});
