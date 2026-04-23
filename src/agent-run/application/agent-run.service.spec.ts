import { AgentType } from '../../model-router/domain/model-router.type';
import { AgentRunStatus, TriggerType } from '../domain/agent-run.type';
import { AgentRunRepositoryPort } from '../domain/port/agent-run.repository.port';
import { AgentRunService } from './agent-run.service';

describe('AgentRunService', () => {
  const createRepoMock = (): jest.Mocked<AgentRunRepositoryPort> => ({
    begin: jest.fn(),
    finish: jest.fn(),
    recordEvidence: jest.fn(),
    findLatestSucceededRun: jest.fn(),
  });

  let repository: jest.Mocked<AgentRunRepositoryPort>;
  let service: AgentRunService;

  beforeEach(() => {
    repository = createRepoMock();
    service = new AgentRunService(repository);
    repository.begin.mockResolvedValue({ id: 42 });
  });

  it('성공 시 begin → run → finish(SUCCEEDED) 순서로 호출되고 결과를 반환한다', async () => {
    // Given
    const plan = { topPriority: 'fix crawler bug' };

    // When
    const result = await service.execute({
      agentType: AgentType.PM,
      triggerType: TriggerType.SLACK_COMMAND_TODAY,
      inputSnapshot: { text: 'hi' },
      run: async () => ({
        result: plan,
        modelUsed: 'mock-chatgpt',
        output: plan,
      }),
    });

    // Then
    expect(result).toEqual(plan);
    expect(repository.begin).toHaveBeenCalledWith({
      agentType: AgentType.PM,
      triggerType: TriggerType.SLACK_COMMAND_TODAY,
      inputSnapshot: { text: 'hi' },
    });
    expect(repository.finish).toHaveBeenCalledWith({
      id: 42,
      status: AgentRunStatus.SUCCEEDED,
      modelUsed: 'mock-chatgpt',
      output: plan,
    });
  });

  it('evidence 입력은 각각 recordEvidence 로 저장된다', async () => {
    // Given
    const evidence = [
      {
        sourceType: 'slack_command',
        sourceId: 'U123',
        payload: { text: 'hi' },
      },
    ];

    // When
    await service.execute({
      agentType: AgentType.PM,
      triggerType: TriggerType.SLACK_COMMAND_TODAY,
      inputSnapshot: {},
      evidence,
      run: async () => ({ result: null, modelUsed: 'm', output: {} }),
    });

    // Then
    expect(repository.recordEvidence).toHaveBeenCalledWith({
      agentRunId: 42,
      sourceType: 'slack_command',
      sourceId: 'U123',
      payload: { text: 'hi' },
    });
  });

  it('recordEvidence 가 throw 하면 finish(FAILED) 로 마감한다 — IN_PROGRESS 고착 방지', async () => {
    // Given
    const boom = new Error('evidence persist 실패');
    repository.recordEvidence.mockRejectedValueOnce(boom);

    const runFn = jest.fn();

    // When / Then
    await expect(
      service.execute({
        agentType: AgentType.PM,
        triggerType: TriggerType.SLACK_COMMAND_TODAY,
        inputSnapshot: {},
        evidence: [{ sourceType: 'x', sourceId: 'y', payload: {} }],
        run: runFn,
      }),
    ).rejects.toBe(boom);

    expect(runFn).not.toHaveBeenCalled();
    expect(repository.finish).toHaveBeenCalledWith({
      id: 42,
      status: AgentRunStatus.FAILED,
      output: { error: 'evidence persist 실패' },
    });
  });

  it('run 이 throw 하면 finish(FAILED) 로 마감하고 에러를 재전파한다', async () => {
    // Given
    const bomb = new Error('boom');

    // When / Then
    await expect(
      service.execute({
        agentType: AgentType.PM,
        triggerType: TriggerType.SLACK_COMMAND_TODAY,
        inputSnapshot: {},
        run: async () => {
          throw bomb;
        },
      }),
    ).rejects.toBe(bomb);

    expect(repository.finish).toHaveBeenCalledWith({
      id: 42,
      status: AgentRunStatus.FAILED,
      output: { error: 'boom' },
    });
  });
});
