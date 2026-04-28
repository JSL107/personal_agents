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
