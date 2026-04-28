import { AgentRunStatus } from '../domain/agent-run.type';
import { AgentRunRepositoryPort } from '../domain/port/agent-run.repository.port';
import { RetryRunUsecase } from './retry-run.usecase';

describe('RetryRunUsecase', () => {
  const createRepoMock = (): jest.Mocked<AgentRunRepositoryPort> => ({
    findById: jest.fn(),
    begin: jest.fn(),
    finish: jest.fn(),
    recordEvidence: jest.fn(),
    findLatestSucceededRun: jest.fn(),
    findRecentSucceededRuns: jest.fn(),
    aggregateQuotaStats: jest.fn(),
    findSimilarPlans: jest.fn().mockResolvedValue([]),
  });

  let mockRepo: jest.Mocked<AgentRunRepositoryPort>;
  let usecase: RetryRunUsecase;

  beforeEach(() => {
    mockRepo = createRepoMock();
    usecase = new RetryRunUsecase(mockRepo);
  });

  it('존재하지 않는 run ID 면 null 반환', async () => {
    mockRepo.findById.mockResolvedValue(null);
    const result = await usecase.execute({ id: 999 });
    expect(result).toBeNull();
  });

  it('FAILED 가 아닌 run 이면 null 반환', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 1,
      agentType: 'PM',
      inputSnapshot: {},
      status: AgentRunStatus.SUCCEEDED,
    });
    const result = await usecase.execute({ id: 1 });
    expect(result).toBeNull();
  });

  it('FAILED run 이면 snapshot 반환', async () => {
    mockRepo.findById.mockResolvedValue({
      id: 2,
      agentType: 'PM',
      inputSnapshot: { tasksText: 'foo', slackUserId: 'U123' },
      status: AgentRunStatus.FAILED,
    });
    const result = await usecase.execute({ id: 2 });
    expect(result).toEqual({
      id: 2,
      agentType: 'PM',
      inputSnapshot: { tasksText: 'foo', slackUserId: 'U123' },
    });
  });
});
