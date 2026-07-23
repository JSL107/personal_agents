import { PrismaService } from '../../prisma/prisma.service';
import { PreviewActionPrismaRepository } from './preview-action.prisma.repository';

describe('PreviewActionPrismaRepository.countOutcomesByKind', () => {
  it('상태별 count와 PENDING 사실상 만료를 expired로 합산한다', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce([
        { kind: 'PM_WRITE_BACK', status: 'APPLIED', _count: { _all: 5 } },
        { kind: 'PM_WRITE_BACK', status: 'CANCELLED', _count: { _all: 2 } },
        { kind: 'PM_WRITE_BACK', status: 'EXPIRED', _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([{ kind: 'PM_WRITE_BACK', _count: { _all: 3 } }]);
    const prismaMock = {
      previewAction: { groupBy },
    } as unknown as PrismaService;
    const repository = new PreviewActionPrismaRepository(prismaMock);
    const now = new Date('2026-07-01T00:00:00Z');

    const result = await repository.countOutcomesByKind({
      sinceDays: 30,
      now,
    });

    expect(result).toEqual([
      { kind: 'PM_WRITE_BACK', applied: 5, cancelled: 2, expired: 4 },
    ]);
    expect(groupBy).toHaveBeenCalledTimes(2);
    expect(groupBy.mock.calls[1][0].where).toEqual(
      expect.objectContaining({
        status: 'PENDING',
        expiresAt: { lte: now },
      }),
    );
  });

  it('현재 시각과 expiresAt이 같으면 만료로 집계한다', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ kind: 'CTO_ASSIGN', _count: { _all: 1 } }]);
    const prismaMock = {
      previewAction: { groupBy },
    } as unknown as PrismaService;
    const repository = new PreviewActionPrismaRepository(prismaMock);
    const now = new Date('2026-07-01T00:00:00Z');

    await repository.countOutcomesByKind({ sinceDays: 30, now });

    expect(groupBy.mock.calls[1][0].where.expiresAt).toEqual({ lte: now });
  });

  it('아직 만료되지 않은 PENDING만 있는 kind는 종결 집계에서 제외한다', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce([
        { kind: 'PM_WRITE_BACK', status: 'PENDING', _count: { _all: 2 } },
      ])
      .mockResolvedValueOnce([]);
    const prismaMock = {
      previewAction: { groupBy },
    } as unknown as PrismaService;
    const repository = new PreviewActionPrismaRepository(prismaMock);

    const result = await repository.countOutcomesByKind({
      sinceDays: 30,
      now: new Date('2026-07-01T00:00:00Z'),
    });

    expect(result).toEqual([]);
  });
});

describe('PreviewActionPrismaRepository.attachSlackMessage', () => {
  it('id 로 좌표(channel/ts)를 update 한다', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prismaMock = {
      previewAction: { update },
    } as unknown as PrismaService;
    const repository = new PreviewActionPrismaRepository(prismaMock);

    await repository.attachSlackMessage({
      id: 'p-1',
      slackChannelId: 'C1',
      slackMessageTs: '111.222',
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { slackChannelId: 'C1', slackMessageTs: '111.222' },
    });
  });
});

describe('PreviewActionPrismaRepository.findExpiredPending', () => {
  it('status=PENDING + expiresAt<=now 를 limit 만큼 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'p-1',
        slackUserId: 'U1',
        kind: 'EVENING_BLOG_PUBLISH',
        payload: {},
        status: 'PENDING',
        previewText: 't',
        responseUrl: null,
        expiresAt: new Date('2026-07-01T00:00:00Z'),
        createdAt: new Date('2026-06-30T00:00:00Z'),
        appliedAt: null,
        cancelledAt: null,
        slackChannelId: 'C1',
        slackMessageTs: '111.222',
      },
    ]);
    const prismaMock = {
      previewAction: { findMany },
    } as unknown as PrismaService;
    const repository = new PreviewActionPrismaRepository(prismaMock);
    const now = new Date('2026-07-01T12:00:00Z');

    const result = await repository.findExpiredPending({ now, limit: 50 });

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      take: 50,
      orderBy: { expiresAt: 'asc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p-1');
    expect(result[0].slackChannelId).toBe('C1');
  });
});
