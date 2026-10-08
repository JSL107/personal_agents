import { PrismaService } from '../../prisma/prisma.service';
import { RecordSlackDeliveryInput } from '../domain/port/slack-delivery.repository.port';
import { SlackDeliveryPrismaRepository } from './slack-delivery.prisma.repository';

describe('SlackDeliveryPrismaRepository', () => {
  const create = jest.fn();
  const updateMany = jest.fn();
  const findMany = jest.fn();
  const repository = new SlackDeliveryPrismaRepository({
    slackDelivery: { create, updateMany, findMany },
  } as unknown as PrismaService);

  beforeEach(() => {
    create.mockReset();
    updateMany.mockReset();
    findMany.mockReset();
  });

  it('원장 입력을 Prisma create 에 전달한다', async () => {
    create.mockResolvedValue({});
    const input: RecordSlackDeliveryInput = {
      kind: 'autopilot:morning',
      itemKinds: ['secretariat'],
      target: 'C1',
      channelId: 'C1',
      messageTs: '111.222',
      status: 'SENT',
      textPreview: '브리핑',
    };

    await repository.record(input);

    expect(create).toHaveBeenCalledWith({ data: input });
  });

  it('Prisma 실패를 호출자에게 전달한다', async () => {
    const error = new Error('database unavailable');
    create.mockRejectedValue(error);

    await expect(
      repository.record({
        kind: 'study-brief',
        itemKinds: [],
        target: 'C1',
        status: 'FAILED',
        textPreview: '본문',
        errorMessage: 'Slack failure',
      }),
    ).rejects.toBe(error);
  });

  it('SENT 원장 메시지의 반응과 답글을 원자적으로 증가시키고 영향 행 수를 반환한다', async () => {
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const target = { channelId: 'C1', messageTs: '111.222' };

    await expect(repository.incrementReactionCount(target)).resolves.toBe(1);
    await expect(repository.incrementReplyCount(target)).resolves.toBe(0);

    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: { ...target, status: 'SENT' },
      data: { reactionCount: { increment: 1 } },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: { ...target, status: 'SENT' },
      data: { replyCount: { increment: 1 } },
    });
  });

  it('기간 집계에는 필요한 컬럼만 조회한다', async () => {
    findMany.mockResolvedValue([]);
    const since = new Date('2026-10-01T00:00:00Z');

    await expect(repository.findSince(since)).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith({
      where: { createdAt: { gte: since } },
      select: {
        kind: true,
        itemKinds: true,
        threadTs: true,
        status: true,
        suppressReason: true,
        reactionCount: true,
        replyCount: true,
      },
    });
  });

  it('상태별 원장을 최신순으로 제한하여 조회한다', async () => {
    findMany.mockResolvedValue([]);
    const since = new Date('2026-10-01T00:00:00Z');

    await expect(
      repository.findByStatus({ status: 'SUPPRESSED', since, limit: 50 }),
    ).resolves.toEqual([]);

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'SUPPRESSED', createdAt: { gte: since } },
      select: {
        id: true,
        kind: true,
        itemKinds: true,
        threadTs: true,
        target: true,
        channelId: true,
        messageTs: true,
        status: true,
        suppressReason: true,
        textPreview: true,
        fullText: true,
        errorMessage: true,
        reactionCount: true,
        replyCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });
});
