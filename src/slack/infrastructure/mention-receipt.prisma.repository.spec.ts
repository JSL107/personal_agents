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

  it('결과 답장 대기는 아직 기록이 없는 행에만 적는다', async () => {
    await repository.recordFinalReply({ ...ref, status: 'PENDING' });

    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        ...ref,
        OR: [{ finalReplyStatus: null }, { finalReplyStatus: { in: [] } }],
      },
      data: { finalReplyStatus: 'PENDING' },
    });
  });

  it('결과 답장 게시는 대기·실패를 덮지만, 실패는 게시를 덮지 못한다', async () => {
    await repository.recordFinalReply({ ...ref, status: 'POSTED' });
    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        ...ref,
        OR: [
          { finalReplyStatus: null },
          { finalReplyStatus: { in: ['PENDING', 'FAILED'] } },
        ],
      },
      data: { finalReplyStatus: 'POSTED' },
    });

    await repository.recordFinalReply({ ...ref, status: 'FAILED' });
    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        ...ref,
        OR: [
          { finalReplyStatus: null },
          { finalReplyStatus: { in: ['PENDING'] } },
        ],
      },
      data: { finalReplyStatus: 'FAILED' },
    });
  });
});
