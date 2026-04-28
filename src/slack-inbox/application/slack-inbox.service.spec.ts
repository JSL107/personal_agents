import { SlackInboxService } from './slack-inbox.service';

describe('SlackInboxService', () => {
  const mockRepo = {
    upsert: jest.fn(),
    findPendingForUser: jest.fn(),
    markConsumed: jest.fn(),
  };

  const service = new SlackInboxService(mockRepo as any);

  beforeEach(() => jest.clearAllMocks());

  it('addItem 은 repository.upsert 를 호출한다', async () => {
    await service.addItem({
      slackUserId: 'U1',
      channelId: 'C1',
      messageTs: '123.456',
      text: 'hello',
    });
    expect(mockRepo.upsert).toHaveBeenCalledWith({
      slackUserId: 'U1',
      channelId: 'C1',
      messageTs: '123.456',
      text: 'hello',
    });
  });

  it('peekPending 은 사용자별 pending 항목을 반환하되 markConsumed 호출은 안 함', async () => {
    const items = [
      {
        id: 1,
        slackUserId: 'U1',
        channelId: 'C1',
        messageTs: '1',
        text: 'a',
        addedAt: new Date(),
        consumed: false,
      },
    ];
    mockRepo.findPendingForUser.mockResolvedValue(items);
    const result = await service.peekPending('U1');
    expect(mockRepo.findPendingForUser).toHaveBeenCalledWith('U1');
    expect(result).toEqual(items);
    expect(mockRepo.markConsumed).not.toHaveBeenCalled();
  });

  it('markConsumed 는 ids 가 있을 때만 repository.markConsumed 호출', async () => {
    await service.markConsumed([1, 2]);
    expect(mockRepo.markConsumed).toHaveBeenCalledWith([1, 2]);
  });

  it('markConsumed 는 빈 배열이면 호출하지 않음', async () => {
    await service.markConsumed([]);
    expect(mockRepo.markConsumed).not.toHaveBeenCalled();
  });
});
