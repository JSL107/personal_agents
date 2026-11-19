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

  const rubricJson = (failed: string[] = []) =>
    JSON.stringify({
      items: ['factual', 'complete', 'scoped', 'cited', 'styled'].map(
        (key) => ({
          key,
          passed: !failed.includes(key),
          evidence: failed.includes(key) ? `${key} 근거` : '',
        }),
      ),
    });
  const evaluateInput = {
    filePath: 'README.md',
    codeContext: 'c',
    docExcerpt: 'd',
    editsSummary: 'a→b',
  };

  it('evaluate: 항목 판정으로 점수·통과를 코드가 계산한다', async () => {
    const verdict = await adapter(makeRouter(rubricJson(['styled']))).evaluate(
      evaluateInput,
    );
    expect(verdict).toMatchObject({
      judgeable: true,
      pass: true,
      score: 95,
      failedRequired: [],
      feedback: 'styled(형식 유지): styled 근거',
    });
    expect(verdict.items).toHaveLength(5);
  });

  it('evaluate: 필수 항목이 하나라도 아니오면 불통과', async () => {
    const verdict = await adapter(
      makeRouter(rubricJson(['complete'])),
    ).evaluate(evaluateInput);
    expect(verdict.pass).toBe(false);
    expect(verdict.failedRequired).toEqual(['complete']);
  });

  it('evaluate: 형식이 깨진 응답은 0점이 아니라 판정 불가', async () => {
    const verdict = await adapter(
      makeRouter('{"pass": true, "score": 95}'),
    ).evaluate(evaluateInput);
    expect(verdict.judgeable).toBe(false);
    expect(verdict.pass).toBe(false);
    expect(verdict.feedback).toContain('평가 응답 형식 오류');
  });

  it('evaluate: 출력 스키마를 걸고, 문서 발췌를 프롬프트에 싣는다', async () => {
    const router = makeRouter(rubricJson());
    await adapter(router).evaluate(evaluateInput);
    const { request } = router.route.mock.calls[0][0];
    expect(request.outputSchema).toBeDefined();
    expect(request.prompt).toContain('[현재 문서 발췌]\nd');
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
      docExcerpt: '',
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
