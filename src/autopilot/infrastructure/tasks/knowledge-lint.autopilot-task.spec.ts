import { KnowledgeLintAutopilotTask } from './knowledge-lint.autopilot-task';

describe('KnowledgeLintAutopilotTask', () => {
  const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-28' };

  it('이슈 있으면 slackText 반환(skip=false)', async () => {
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
    const task = new KnowledgeLintAutopilotTask(knowledgeLint as never);

    const result = await task.run(context);

    expect(knowledgeLint.lintIssues).toHaveBeenCalledWith({
      duplicateMaxDistance: 0.05,
      limit: 50,
    });
    expect(result.skip).toBe(false);
    expect(result.slackText).toContain('Knowledge Lint');
  });

  it('이슈 0건이면 skip=true (빈 알림 방지)', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue([]),
    };
    const task = new KnowledgeLintAutopilotTask(knowledgeLint as never);

    const result = await task.run(context);

    expect(result.skip).toBe(true);
    expect(result.slackText).toBeUndefined();
  });
});
