import { SaveReviewOutcomeUsecase } from './save-review-outcome.usecase';

describe('SaveReviewOutcomeUsecase', () => {
  const mockRepo = { save: jest.fn(), findRecentRejected: jest.fn() };
  const usecase = new SaveReviewOutcomeUsecase(mockRepo as any);

  beforeEach(() => jest.clearAllMocks());

  it('save 를 repository 에 위임한다', async () => {
    await usecase.execute({
      agentRunId: 1,
      slackUserId: 'U1',
      accepted: true,
    });
    expect(mockRepo.save).toHaveBeenCalledWith({
      agentRunId: 1,
      slackUserId: 'U1',
      accepted: true,
    });
  });
});

describe('SaveReviewOutcomeUsecase × episodic', () => {
  function createRepoMock() {
    return {
      save: jest.fn().mockResolvedValue(undefined),
      findRecentRejected: jest.fn(),
    };
  }

  it('reject(accepted=false, comment 존재) 시 episodic.record 호출', async () => {
    const repository = createRepoMock();
    const episodic = {
      record: jest.fn().mockResolvedValue(undefined),
      searchRelevant: jest.fn(),
    };
    const usecase = new SaveReviewOutcomeUsecase(
      repository as never,
      episodic as never,
    );

    await usecase.execute({
      agentRunId: 7,
      slackUserId: 'U1',
      accepted: false,
      comment: 'console.log 남기지 마세요',
    });

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(episodic.record).toHaveBeenCalledTimes(1);
    expect(episodic.record.mock.calls[0][0]).toMatchObject({
      kind: 'pr_review',
      agentType: 'CODE_REVIEWER',
      agentRunId: 7,
      content: 'console.log 남기지 마세요',
    });
  });

  it('accept 또는 comment 없으면 episodic.record 미호출', async () => {
    const repository = createRepoMock();
    const episodic = { record: jest.fn(), searchRelevant: jest.fn() };
    const usecase = new SaveReviewOutcomeUsecase(
      repository as never,
      episodic as never,
    );

    await usecase.execute({
      agentRunId: 7,
      slackUserId: 'U1',
      accepted: true,
      comment: 'good',
    });
    await usecase.execute({
      agentRunId: 8,
      slackUserId: 'U1',
      accepted: false,
    });

    expect(episodic.record).not.toHaveBeenCalled();
  });

  it('episodic 미주입이어도 save 정상 동작', async () => {
    const repository = createRepoMock();
    const usecase = new SaveReviewOutcomeUsecase(
      repository as never,
      undefined,
    );

    await expect(
      usecase.execute({
        agentRunId: 7,
        slackUserId: 'U1',
        accepted: false,
        comment: 'x',
      }),
    ).resolves.toBeUndefined();
    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});
