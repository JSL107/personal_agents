import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleSource } from '../domain/schedule.type';
import { ScheduleCollectionStatePrismaRepository } from './schedule-collection-state.prisma.repository';

describe('ScheduleCollectionStatePrismaRepository', () => {
  const findUnique = jest.fn();
  const upsert = jest.fn();
  const repository = new ScheduleCollectionStatePrismaRepository({
    scheduleCollectionState: { findUnique, upsert },
  } as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('기록이 없으면 null을 돌려준다', async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      repository.get(ScheduleSource.SLACK_MENTION),
    ).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith({
      where: { source: ScheduleSource.SLACK_MENTION },
    });
  });

  it('출처별 마지막 성공 시각을 upsert한다', async () => {
    const at = new Date('2026-11-04T01:00:00Z');
    await repository.markSucceeded(ScheduleSource.NOTION_TASK, at);
    expect(upsert).toHaveBeenCalledWith({
      where: { source: ScheduleSource.NOTION_TASK },
      create: { source: ScheduleSource.NOTION_TASK, lastSucceededAt: at },
      update: { lastSucceededAt: at },
    });
  });
});
