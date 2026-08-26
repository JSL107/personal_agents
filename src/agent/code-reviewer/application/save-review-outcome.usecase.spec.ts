import { SaveReviewOutcomeUsecase } from './save-review-outcome.usecase';

describe('SaveReviewOutcomeUsecase', () => {
  const mockRepo = { save: jest.fn() };
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

  it('기각(accepted=false)도 comment 를 그대로 위임한다', async () => {
    await usecase.execute({
      agentRunId: 7,
      slackUserId: 'U1',
      accepted: false,
      comment: 'console.log 남기지 마세요',
    });
    expect(mockRepo.save).toHaveBeenCalledWith({
      agentRunId: 7,
      slackUserId: 'U1',
      accepted: false,
      comment: 'console.log 남기지 마세요',
    });
  });
});
