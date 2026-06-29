import { KnowledgeLintAutopilotTask } from './knowledge-lint.autopilot-task';

function makeConfig(values: Record<string, string | undefined> = {}) {
  return { get: jest.fn((key: string) => values[key]) };
}

describe('KnowledgeLintAutopilotTask', () => {
  const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-28' };

  it('이슈 있으면 summaryText 반환 + L4 옵션(기본 활성/상한5) 전달', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue([
        {
          type: 'embedding_null',
          episodeId: 9,
          detail: 'embedding 누락',
          occurredAt: new Date(),
        },
      ]),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
    );

    const result = await task.run(context);

    expect(knowledgeLint.lintIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicateMaxDistance: 0.05,
        limit: 50,
        l4: {
          enabled: true,
          maxPairs: 5,
          minDistance: 0.05,
          maxDistance: 0.15,
        },
      }),
    );
    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('Knowledge Lint');
  });

  it('L4_ENABLED=false 면 l4.enabled=false 로 전달', async () => {
    const knowledgeLint = { lintIssues: jest.fn().mockResolvedValue([]) };
    const config = makeConfig({ AUTOPILOT_KNOWLEDGE_LINT_L4_ENABLED: 'false' });
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      config as never,
    );

    await task.run(context);

    expect(knowledgeLint.lintIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        l4: expect.objectContaining({ enabled: false }),
      }),
    );
  });

  it('L4_MAX_PAIRS env 를 maxPairs 로 반영', async () => {
    const knowledgeLint = { lintIssues: jest.fn().mockResolvedValue([]) };
    const config = makeConfig({ AUTOPILOT_KNOWLEDGE_LINT_L4_MAX_PAIRS: '3' });
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      config as never,
    );

    await task.run(context);

    expect(knowledgeLint.lintIssues).toHaveBeenCalledWith(
      expect.objectContaining({ l4: expect.objectContaining({ maxPairs: 3 }) }),
    );
  });

  it('이슈 0건이면 skip=true (빈 알림 방지)', async () => {
    const knowledgeLint = { lintIssues: jest.fn().mockResolvedValue([]) };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(true);
    expect(result.summaryText).toBeUndefined();
  });
});
