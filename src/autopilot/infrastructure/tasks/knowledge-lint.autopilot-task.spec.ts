import { KnowledgeLintAutopilotTask } from './knowledge-lint.autopilot-task';

function makeConfig(values: Record<string, string | undefined> = {}) {
  return { get: jest.fn((key: string) => values[key]) };
}

function makeTrace() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

// execute 는 run 결과를 그대로 돌려주고 예외도 그대로 던진다(실제 서비스와 같은 바깥 동작).
function makeAgentRunService() {
  return {
    execute: jest.fn(async ({ run }) => ({
      ...(await run({})),
      agentRunId: 1,
    })),
  };
}

// L4 후보 2쌍을 전부 판정한 정상 실태. service 가 돌려주는 형태를 그대로 흉내낸다 —
// 배열만 돌려주는 mock 은 실제 계약과 어긋나 하트비트 문구를 검증할 수 없다.
const L4_DONE = { candidates: 2, judged: 2, abortedByQuota: false };

describe('KnowledgeLintAutopilotTask', () => {
  const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-28' };

  // 정리는 발송이 성공한 뒤에만 — 점검 단계에서 찍으면 발송·후속 단계 실패 시 정리 내역이 보고되지 않는다.
  it('정리 대상이 있으면 onDelivered 에서만 같은 임계로 정리한다', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [
          {
            type: 'near_duplicate',
            episodeId: 1,
            relatedId: 2,
            detail: '중복 후보 — distance 0.000',
            occurredAt: new Date(),
          },
        ],
        duplicateTotal: 1,
        duplicateTotalTruncated: false,
        duplicateSupersedable: 1,
        l4: L4_DONE,
      }),
      supersedeOlderDuplicates: jest.fn().mockResolvedValue(1),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      makeTrace() as never,
      makeAgentRunService() as never,
    );

    const result = await task.run(context);

    expect(knowledgeLint.supersedeOlderDuplicates).not.toHaveBeenCalled();
    await result.onDelivered?.();
    expect(knowledgeLint.supersedeOlderDuplicates).toHaveBeenCalledWith({
      maxDistance: 0.001,
    });
  });

  it('정리 대상이 0건이면 onDelivered 를 두지 않는다', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        duplicateSupersedable: 0,
        l4: L4_DONE,
      }),
      supersedeOlderDuplicates: jest.fn(),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      makeTrace() as never,
      makeAgentRunService() as never,
    );

    const result = await task.run(context);

    expect(result.onDelivered).toBeUndefined();
  });

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
        duplicateSupersedable: 0,
        l4: L4_DONE,
      }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      makeTrace() as never,
      makeAgentRunService() as never,
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
        duplicateSupersedable: 0,
        l4: L4_DONE,
      }),
    };
    const config = makeConfig({ AUTOPILOT_KNOWLEDGE_LINT_L4_ENABLED: 'false' });
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      config as never,
      makeTrace() as never,
      makeAgentRunService() as never,
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
        duplicateSupersedable: 0,
        l4: L4_DONE,
      }),
    };
    const config = makeConfig({ AUTOPILOT_KNOWLEDGE_LINT_L4_MAX_PAIRS: '3' });
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      config as never,
      makeTrace() as never,
      makeAgentRunService() as never,
    );

    await task.run(context);

    expect(knowledgeLint.lintIssues).toHaveBeenCalledWith(
      expect.objectContaining({ l4: expect.objectContaining({ maxPairs: 3 }) }),
    );
  });

  // 이슈 0건의 하트비트는 Slack 대신 SUPPRESSED/EMPTY 원장에 남긴다.
  it('이슈 0건이면 원장용 하트비트를 반환한다 (skip=true)', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        duplicateSupersedable: 0,
        l4: L4_DONE,
      }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      makeTrace() as never,
      makeAgentRunService() as never,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(true);
    expect(result.emptyReason).toContain('이상 없음');
    expect(result.emptyReason).toContain('2026-06-28');
    expect(result.summaryText).toBeUndefined();
  });

  // L4 를 수행하지 않은 회차는 service 가 l4=null 을 돌려준다(비활성 또는 judge 미주입).
  it('L4 를 수행하지 않았으면 하트비트가 점검 범위를 좁혀 표시한다', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        duplicateSupersedable: 0,
        l4: null,
      }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig({
        AUTOPILOT_KNOWLEDGE_LINT_L4_ENABLED: 'false',
      }) as never,
      makeTrace() as never,
      makeAgentRunService() as never,
    );

    const result = await task.run(context);

    expect(result.emptyReason).toContain('모순 판정 꺼짐');
  });

  // codex 리뷰(PR #269 P2) 지적 — L4 가 쿼터로 중단된 회차에 "이상 없음" 을 알리면 점검 장애가
  // 정상으로 위장된다. task 가 실행 실태를 formatter 로 그대로 넘기는지 여기서 잡는다.
  it('L4 가 쿼터로 중단된 회차는 이상 없음으로 보고하지 않는다', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        duplicateSupersedable: 0,
        l4: { candidates: 5, judged: 1, abortedByQuota: true },
      }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      makeTrace() as never,
      makeAgentRunService() as never,
    );

    const result = await task.run(context);

    // 이슈 0건이어도 판정이 중단됐으면 원장에 묻지 않고 경고와 함께 Slack 으로 보낸다.
    expect(result.skip).toBe(false);
    expect(result.emptyReason).toBeUndefined();
    expect(result.summaryText).toContain('⚠️');
    expect(result.summaryText).not.toContain('✅');
    expect(result.summaryText).toContain('1/5쌍만 판정');
  });

  it('L4 일부 judge 가 실패한 회차도 이상 없음으로 묻지 않는다', async () => {
    // 쿼터 중단이 아니어도 판정 수가 후보 수보다 적으면 안 본 쌍이 남는다(PR #748 리뷰).
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        duplicateSupersedable: 0,
        l4: { candidates: 5, judged: 3, abortedByQuota: false },
      }),
    };
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      makeTrace() as never,
      makeAgentRunService() as never,
    );

    const result = await task.run(context);

    expect(result.skip).toBe(false);
    expect(result.emptyReason).toBeUndefined();
    expect(result.summaryText).toContain('3/5쌍만 판정 (일부 judge 실패)');
  });

  // 이 작업의 존재 이유 — 게이트가 꺼져 있으면 L4 는 아예 조회도 안 하지만(service 가 l4=null),
  // "이 주에 knowledge-lint 가 발화했고 게이트는 꺼져 있었다" 는 사실은 그래도 남아야 한다.
  it('L4 게이트가 꺼져 있어도 흔적을 남긴다', async () => {
    const knowledgeLint = {
      lintIssues: jest.fn().mockResolvedValue({
        issues: [],
        duplicateTotal: 0,
        duplicateTotalTruncated: false,
        duplicateSupersedable: 0,
        l4: null,
      }),
    };
    const trace = makeTrace();
    const agentRunService = makeAgentRunService();
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig({ AUTOPILOT_KNOWLEDGE_LINT_L4_ENABLED: 'false' }) as never,
      trace as never,
      agentRunService as never,
    );

    await task.run(context);

    // 판정 워커가 돌지 않은 회차라 원장에 CONTRADICTION_JUDGE 를 남기지 않는다.
    expect(agentRunService.execute).not.toHaveBeenCalled();

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
        duplicateSupersedable: 0,
        l4: { candidates: 0, judged: 0, abortedByQuota: false },
      }),
    };
    const trace = makeTrace();
    const agentRunService = makeAgentRunService();
    const task = new KnowledgeLintAutopilotTask(
      knowledgeLint as never,
      makeConfig() as never,
      trace as never,
      agentRunService as never,
    );

    await task.run(context);

    // 후보가 없어도 L4 를 돌린 회차다 — 원장에 남겨야 NEVER_RUN 으로 읽히지 않는다.
    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'CONTRADICTION_JUDGE',
        triggerType: 'AUTOPILOT_KNOWLEDGE_LINT_CRON',
      }),
    );
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
      makeAgentRunService() as never,
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
