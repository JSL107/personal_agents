import { PrismaService } from '../../prisma/prisma.service';
import { StudyBriefPrismaRepository } from './study-brief.prisma.repository';

describe('StudyBriefPrismaRepository', () => {
  it('브리핑 원장을 저장한다', async () => {
    const create = jest.fn().mockResolvedValue({ id: 7 });
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { create },
    } as unknown as PrismaService);

    await expect(
      repository.save({
        agentRunId: 41,
        ownerUserId: 'U1',
        kind: 'CONCEPT',
        topic: 'durable execution',
        verdict: {
          kind: 'CONCEPT',
          whyNow: '지금 필요',
          whereItLands: 'src/agent-run/',
          readingPlan: '공식 문서',
          minutes: 10,
        },
        reportMd: 'report',
        sourceUrls: ['https://example.com'],
      }),
    ).resolves.toEqual({ id: 7 });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentRunId: 41,
        ownerUserId: 'U1',
        topic: 'durable execution',
      }),
      select: { id: true },
    });
  });

  it('기준 시각 이후 브리핑을 최신순으로 조회한다', async () => {
    const since = new Date('2026-07-01T00:00:00Z');
    const rows = [
      {
        kind: 'TOOL',
        topic: 'context7',
        createdAt: new Date('2026-07-02T00:00:00Z'),
      },
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const repository = new StudyBriefPrismaRepository({
      studyBrief: { findMany },
    } as unknown as PrismaService);

    await expect(repository.findRecentSince('U1', since)).resolves.toEqual(
      rows,
    );
    expect(findMany).toHaveBeenCalledWith({
      where: { ownerUserId: 'U1', createdAt: { gte: since } },
      select: { kind: true, topic: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  });
});
