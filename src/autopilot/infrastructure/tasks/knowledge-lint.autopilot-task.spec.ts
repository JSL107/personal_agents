import { KnowledgeLintAutopilotTask } from './knowledge-lint.autopilot-task';

function makeConfig(values: Record<string, string | undefined> = {}) {
  return { get: jest.fn((key: string) => values[key]) };
}

// L4 후보 2쌍을 전부 판정한 정상 실태. service 가 돌려주는 형태를 그대로 흉내낸다 —
// 배열만 돌려주는 mock 은 실제 계약과 어긋나 하트비트 문구를 검증할 수 없다.
const L4_DONE = { candidates: 2, judged: 2, abortedByQuota: false };

describe('KnowledgeLintAutopilotTask', () => {
  const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-28' };

  it('이슈 있으면 summaryText 반환 + L4 옵션(기본 활성/상한5) 전달', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [
          {
            type: 'embedding_null',
            episodeId: 9,
            detail: 'embedding 누락',
            occurredAt: new Date(),
          },
        ],
        l4: L4_DONE,
      }),
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
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({ issues: [], l4: L4_DONE }),
    };
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
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({ issues: [], l4: L4_DONE }),
    };
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
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({ issues: [], l4: L4_DONE }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('이상 없음');
    expect(result.summaryText).toContain('2026-06-28');
  });

  // L4 를 수행하지 않은 회차는 service 가 l4=null 을 돌려준다(비활성 또는 judge 미주입).
  it('L4 를 수행하지 않았으면 하트비트가 점검 범위를 좁혀 표시한다', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({ issues: [], l4: null }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig({
        AUTOPILOT_KNOWLEDGE_LINT_L4_ENABLED: 'false',
      }) as never,
    );

    const result = await task.run(context);

    expect(result.summaryText).toContain('모순 판정 꺼짐');
  });

  // codex 리뷰(PR #269 P2) 지적 — L4 가 쿼터로 중단된 회차에 "이상 없음" 을 알리면 점검 장애가
  // 정상으로 위장된다. task 가 실행 실태를 formatter 로 그대로 넘기는지 여기서 잡는다.
  it('L4 가 쿼터로 중단된 회차는 이상 없음으로 보고하지 않는다', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        l4: { candidates: 5, judged: 1, abortedByQuota: true },
      }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    // ✅(정상 하트비트)가 아니라 ⚠️ 로 나가야 한다. 문구에 "이상 없음" 이라는 낱말이 들어가긴
    // 하지만("…을 확정하지 못했습니다"), 정상 보고와는 기호부터 다르다.
    expect(result.summaryText).toContain('⚠️');
    expect(result.summaryText).not.toContain('✅');
    expect(result.summaryText).toContain('1/5쌍만 판정');
  });
});
