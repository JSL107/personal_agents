import { PrismaService } from '../../prisma/prisma.service';
import { RecordSlackDeliveryInput } from '../domain/port/slack-delivery.repository.port';
import { SlackDeliveryPrismaRepository } from './slack-delivery.prisma.repository';

describe('SlackDeliveryPrismaRepository', () => {
  const create = jest.fn();
  const repository = new SlackDeliveryPrismaRepository({
    slackDelivery: { create },
  } as unknown as PrismaService);

  beforeEach(() => {
    create.mockReset();
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
});
