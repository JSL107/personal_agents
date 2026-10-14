import { PrismaService } from '../../prisma/prisma.service';
import { MentionReceiptPrismaRepository } from './mention-receipt.prisma.repository';

describe('MentionReceiptPrismaRepository', () => {
  const createMany = jest.fn().mockResolvedValue({ count: 1 });
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const repository = new MentionReceiptPrismaRepository({
    mentionReceipt: { createMany, updateMany },
  } as unknown as PrismaService);
  const ref = { channelId: 'C1', messageTs: '111.222' };

  it('같은 메시지가 다시 와도 첫 수신 행만 남긴다', async () => {
    await repository.recordReceived({ ...ref, source: 'dm' });

    expect(createMany).toHaveBeenCalledWith({
      data: [{ ...ref, source: 'dm', status: 'RECEIVED' }],
      skipDuplicates: true,
    });
  });

  it('게시 실패는 게시 시각 없이 오류를 200자로 잘라 남긴다', async () => {
    await repository.recordOutcome({
      ...ref,
      status: 'REPLY_FAILED',
      errorMessage: 'x'.repeat(300),
    });

    expect(updateMany).toHaveBeenLastCalledWith({
      where: { ...ref, status: { in: ['RECEIVED'] } },
      data: {
        status: 'REPLY_FAILED',
        errorMessage: 'x'.repeat(200),
        repliedAt: null,
      },
    });
  });

  it('답이 나가면 게시 시각을 남긴다', async () => {
    await repository.recordOutcome({ ...ref, status: 'REPLIED' });

    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        ...ref,
        status: { in: ['RECEIVED', 'REPLY_FAILED', 'ERROR_REPLIED'] },
      },
      data: {
        status: 'REPLIED',
        errorMessage: null,
        repliedAt: expect.any(Date),
      },
    });
  });
});
