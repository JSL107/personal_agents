import { KnowledgeLintAutopilotTask } from './knowledge-lint.autopilot-task';

function makeConfig(values: Record<string, string | undefined> = {}) {
  return { get: jest.fn((key: string) => values[key]) };
}

function makeTrace() {
  return { record: jest.fn().mockResolvedValue(undefined) };
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
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        l4: L4_DONE,
      }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      makeTrace() as never,
    );

    const result = await task.run(context);

    expect(knowledgeLint.lintIssues).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicateMaxDistance: 0.001,
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
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        l4: L4_DONE,
      }),
    };
    const config = makeConfig({ AUTOPILOT_KNOWLEDGE_LINT_L4_ENABLED: 'false' });
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      config as never,
      makeTrace() as never,
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
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        l4: L4_DONE,
      }),
    };
    const config = makeConfig({ AUTOPILOT_KNOWLEDGE_LINT_L4_MAX_PAIRS: '3' });
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      config as never,
      makeTrace() as never,
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
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        l4: L4_DONE,
      }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      makeTrace() as never,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('이상 없음');
    expect(result.summaryText).toContain('2026-06-28');
  });

  // L4 를 수행하지 않은 회차는 service 가 l4=null 을 돌려준다(비활성 또는 judge 미주입).
  it('L4 를 수행하지 않았으면 하트비트가 점검 범위를 좁혀 표시한다', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        l4: null,
      }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig({
        AUTOPILOT_KNOWLEDGE_LINT_L4_ENABLED: 'false',
      }) as never,
      makeTrace() as never,
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
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        l4: { candidates: 5, judged: 1, abortedByQuota: true },
      }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      makeTrace() as never,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    // ✅(정상 하트비트)가 아니라 ⚠️ 로 나가야 한다. 문구에 "이상 없음" 이라는 낱말이 들어가긴
    // 하지만("…을 확정하지 못했습니다"), 정상 보고와는 기호부터 다르다.
    expect(result.summaryText).toContain('⚠️');
    expect(result.summaryText).not.toContain('✅');
    expect(result.summaryText).toContain('1/5쌍만 판정');
  });

  // 이 작업의 존재 이유 — 게이트가 꺼져 있으면 L4 는 아예 조회도 안 하지만(service 가 l4=null),
  // "이 주에 knowledge-lint 가 발화했고 게이트는 꺼져 있었다" 는 사실은 그래도 남아야 한다.
  it('L4 게이트가 꺼져 있어도 흔적을 남긴다', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        l4: null,
      }),
    };
    const trace = makeTrace();
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig({ AUTOPILOT_KNOWLEDGE_LINT_L4_ENABLED: 'false' }) as never,
      trace as never,
    );

    await task.run(context);

    expect(trace.record).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'knowledge-lint',
        firedAtKst: '2026-06-28',
        gateEnabled: false,
        candidateCount: null,
        llmCalled: false,
      }),
    );
  });

  // 게이트는 켜졌지만 거리 밴드에 후보 쌍이 하나도 없던 회차 — "LLM 호출 자체가 없었다" 가
  // "판정했고 모순 0건" 과 같은 결과(이슈 0건)로 합쳐지지만, 흔적에는 candidateCount=0/
  // llmCalled=false 로 남아 구분된다.
  it('판정 대상이 0건이어도 흔적을 남긴다', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        l4: { candidates: 0, judged: 0, abortedByQuota: false },
      }),
    };
    const trace = makeTrace();
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      trace as never,
    );

    await task.run(context);

    expect(trace.record).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'knowledge-lint',
        firedAtKst: '2026-06-28',
        gateEnabled: true,
        candidateCount: 0,
        llmCalled: false,
      }),
    );
  });
  // 저장소 오류로 lintIssues 가 reject 하면, 흔적이 없으면 "발화했지만 실패" 가 "발화하지 않음"
  // 과 같은 모양이 된다 — 이 관측이 가리려던 세 후보 중 둘이 합쳐진다.
  it('lintIssues 가 예외를 던져도 흔적을 남기고 예외를 다시 던진다', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockRejectedValue(new Error('임베딩 조회 실패')),
    };
    const trace = makeTrace();
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      trace as never,
    );

    await expect(task.run(context)).rejects.toThrow('임베딩 조회 실패');

    expect(trace.record).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'knowledge-lint',
        gateEnabled: true,
        candidateCount: null,
        llmCalled: null,
        detail: '예외로 중단: 임베딩 조회 실패',
      }),
    );
  });
});
