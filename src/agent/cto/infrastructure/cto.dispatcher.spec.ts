import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import { GenerateAssignmentUsecase } from '../application/generate-assignment.usecase';
import { AssignmentOutput } from '../domain/cto.type';
import { CtoDispatcher } from './cto.dispatcher';

const sampleOutput: AssignmentOutput = {
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
  unassignedTasks: [],
  ctoSummary: '1건 분배',
};

const baseInput: DispatchInput = {
  source: 'SLACK_COMMAND',
  slackUserId: 'U1',
};

describe('CtoDispatcher', () => {
  let usecaseExecute: jest.Mock;
  let dispatcher: CtoDispatcher;

  beforeEach(() => {
    usecaseExecute = jest.fn().mockResolvedValue({
      result: sampleOutput,
      modelUsed: 'claude-cli',
      agentRunId: 42,
    });
    dispatcher = new CtoDispatcher({
      execute: usecaseExecute,
    } as unknown as GenerateAssignmentUsecase);
  });

  it('agentType 은 CTO', () => {
    expect(dispatcher.agentType).toBe(AgentType.CTO);
  });

  it('dispatch 는 GenerateAssignmentUsecase.execute 에 slackUserId + dailyPlanAgentRunId 위임', async () => {
    await dispatcher.dispatch({
      ...baseInput,
      contextRefs: { agentRunId: 123 },
    });
    expect(usecaseExecute).toHaveBeenCalledTimes(1);
    expect(usecaseExecute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      dailyPlanAgentRunId: 123,
    });
  });

  it('contextRefs 미지정 시 dailyPlanAgentRunId 는 undefined', async () => {
    await dispatcher.dispatch(baseInput);
    expect(usecaseExecute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      dailyPlanAgentRunId: undefined,
    });
  });

  it('outcome 을 DispatchOutcome 형태로 매핑 (agentRunId/output/modelUsed/formattedText)', async () => {
    const outcome = await dispatcher.dispatch(baseInput);
    expect(outcome.agentRunId).toBe(42);
    expect(outcome.output).toBe(sampleOutput);
    expect(outcome.modelUsed).toBe('claude-cli');
    expect(typeof outcome.formattedText).toBe('string');
    // formatAssignmentOutput 결과인지 — header + ctoSummary + assignment 라인 포함 확인.
    expect(outcome.formattedText).toContain('CTO 분배 결과');
    expect(outcome.formattedText).toContain('1건 분배');
    expect(outcome.formattedText).toContain('Router 마무리');
  });

  it('usecase 가 throw 하면 dispatcher 도 그대로 propagate', async () => {
    const error = new Error('boom');
    usecaseExecute.mockRejectedValue(error);
    await expect(dispatcher.dispatch(baseInput)).rejects.toBe(error);
  });
});
