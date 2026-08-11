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

  // 여기가 이 task 의 관측 가능성이다 — 주 1회 발화이고 LLM 을 안 쓰는 구간은 agent_run 에도
  // 남지 않아, 0건에 skip 하면 "점검했고 깨끗하다" 와 "점검이 죽어서 안 돌았다" 를 사후에
  // 가를 근거가 하나도 없어진다. skip=true 로 되돌리면 이 테스트만 실패한다.
  it('이슈 0건이어도 하트비트를 남긴다 (skip=false)', async () => {
    const knowledgeLint = { lintIssues: jest.fn().mockResolvedValue([]) };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('이상 없음');
    expect(result.summaryText).toContain('2026-06-28');
  });

  it('L4 가 꺼진 채 0건이면 하트비트가 점검 범위를 좁혀 표시한다', async () => {
    const knowledgeLint = { lintIssues: jest.fn().mockResolvedValue([]) };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig({
        AUTOPILOT_KNOWLEDGE_LINT_L4_ENABLED: 'false',
      }) as never,
    );

    const result = await task.run(context);

    expect(result.summaryText).toContain('모순 판정 꺼짐');
  });
});
