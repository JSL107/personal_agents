import { CtoBeChainPayload } from '../../agent/cto/domain/cto.type';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { RunBeChainUsecase } from '../application/run-be-chain.usecase';
import { CtoBeChainApplier } from './cto-be-chain.applier';

const validPayload: CtoBeChainPayload = {
  ctoAgentRunId: 42,
  slackUserId: 'U1',
  assignments: [
    {
      taskId: 't:1',
      taskTitle: 'Router 마무리',
      beAssignment: AgentType.BE,
      priority: 1,
      reasoning: 'BE 진입 worker',
      confidence: 0.9,
    },
  ],
};

const buildPreview = (payload: unknown): PreviewAction =>
  ({
    id: 'p-1',
    slackUserId: 'U1',
    kind: PREVIEW_KIND.CTO_BE_CHAIN,
    payload,
    status: 'PENDING',
    previewText: '',
    responseUrl: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    appliedAt: null,
    cancelledAt: null,
    slackChannelId: null,
    slackMessageTs: null,
  }) as PreviewAction;

describe('CtoBeChainApplier', () => {
  let runBeChainExecute: jest.Mock;
  let findLatestSucceededRun: jest.Mock;
  let applier: CtoBeChainApplier;

  beforeEach(() => {
    runBeChainExecute = jest.fn().mockResolvedValue([
      {
        assignment: validPayload.assignments[0],
        status: 'OK',
        agentRunId: 201,
        message: 'BE plan #201 생성 완료.',
      },
    ]);
    // 기본은 이 카드가 최신 분배인 상태.
    findLatestSucceededRun = jest.fn().mockResolvedValue({
      id: validPayload.ctoAgentRunId,
      output: {},
      endedAt: new Date(),
      inputSnapshot: {},
    });
    applier = new CtoBeChainApplier(
      { execute: runBeChainExecute } as unknown as RunBeChainUsecase,
      { findLatestSucceededRun } as unknown as AgentRunService,
    );
  });

  it('kind 는 CTO_BE_CHAIN', () => {
    expect(applier.kind).toBe(PREVIEW_KIND.CTO_BE_CHAIN);
  });

  it('payload 의 분배를 RunBeChainUsecase 로 위임하고 CTO run 을 parent 로 넘긴다', async () => {
    await applier.apply(buildPreview(validPayload));

    expect(runBeChainExecute).toHaveBeenCalledWith({
      assignments: validPayload.assignments,
      slackUserId: 'U1',
      parentRunId: 42,
    });
  });

  it('실행 결과를 사용자 메시지로 포맷 — 재조회 검증 artifact 는 없음', async () => {
    const result = await applier.apply(buildPreview(validPayload));

    expect(result.message).toContain('BE chain 실행 완료');
    expect(result.message).toContain('Router 마무리');
    expect(result.artifacts).toEqual([]);
  });

  // payload 는 Prisma JSON 에서 unknown 으로 들어온다. worker 실행 입력으로 직행하는
  // 필드라 형식이 깨졌으면 usecase 안 TypeError 대신 여기서 명시 에러로 끊는다.
  it.each([
    ['객체가 아님', 'not-an-object'],
    ['ctoAgentRunId 누락', { slackUserId: 'U1', assignments: [] }],
    ['slackUserId 누락', { ctoAgentRunId: 1, assignments: [] }],
    [
      'assignments 비어 있음',
      { ctoAgentRunId: 1, slackUserId: 'U1', assignments: [] },
    ],
    [
      'beAssignment 가 BE 계열이 아님',
      {
        ctoAgentRunId: 1,
        slackUserId: 'U1',
        assignments: [{ taskId: 't', taskTitle: 't', beAssignment: 'PM' }],
      },
    ],
  ])('payload 검증 실패 — %s 이면 throw', async (_label, payload) => {
    await expect(applier.apply(buildPreview(payload))).rejects.toThrow();
    expect(runBeChainExecute).not.toHaveBeenCalled();
  });

  // 보류만 있는 카드에는 실행 버튼이 없지만, 자연어 "응" 은 최근 PENDING preview 를 그대로
  // 넘긴다. 빈 실행이 통과하면 아무 일도 없이 카드가 닫혀 담당을 정할 기회를 잃는다.
  it('배정이 없는 카드는 사용자가 읽을 말로 거절한다', async () => {
    await expect(
      applier.apply(
        buildPreview({ ctoAgentRunId: 42, slackUserId: 'U1', assignments: [] }),
      ),
    ).rejects.toThrow('보류 항목에서 담당을 먼저 정해주세요');
    expect(runBeChainExecute).not.toHaveBeenCalled();
  });

  // 카드 정리는 best-effort 라 옛 카드가 PENDING 으로 남을 수 있다. 사용자가 최신 카드를
  // 취소하면 그 옛 카드가 다시 승인 대상이 되는데, 폐기한 분배가 실행되면 안 된다.
  it('최신 분배가 아닌 카드는 실행하지 않고 명시 에러', async () => {
    findLatestSucceededRun.mockResolvedValue({
      id: 999,
      output: {},
      endedAt: new Date(),
      inputSnapshot: {},
    });

    await expect(applier.apply(buildPreview(validPayload))).rejects.toThrow(
      '최신 분배',
    );
    expect(runBeChainExecute).not.toHaveBeenCalled();
  });

  // 조회가 비면(원장에 CTO run 이 없음) 대조할 근거가 없다 — 실행을 막지 않는다.
  it('직전 CTO run 을 못 찾으면 그대로 실행', async () => {
    findLatestSucceededRun.mockResolvedValue(null);

    await applier.apply(buildPreview(validPayload));

    expect(runBeChainExecute).toHaveBeenCalledTimes(1);
  });

  // 건별 실패는 chain 전체를 실패로 만들지 않는다 — 카드는 APPLIED 로 닫히고 결과만 보고된다.
  it('일부 worker 가 FAILED 여도 throw 하지 않고 결과를 메시지로 보고', async () => {
    runBeChainExecute.mockResolvedValue([
      {
        assignment: validPayload.assignments[0],
        status: 'FAILED',
        message: 'BE 실패: codex capacity',
      },
    ]);

    const result = await applier.apply(buildPreview(validPayload));

    expect(result.message).toContain('0/1건 성공');
    expect(result.message).toContain('codex capacity');
  });
});
