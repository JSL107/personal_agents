import { PrismaService } from '../../prisma/prisma.service';
import { PreviewActionPrismaRepository } from './preview-action.prisma.repository';

describe('PreviewActionPrismaRepository.countByPayloadValue', () => {
  it('kind와 JSON path equals 조건으로 count를 위임한다', async () => {
    const count = jest.fn().mockResolvedValue(2);
    const prismaMock = {
      previewAction: { count },
    } as unknown as PrismaService;
    const repository = new PreviewActionPrismaRepository(prismaMock);

    const result = await repository.countByPayloadValue({
      kind: 'SESSION_INJECT',
      payloadPath: ['prRef'],
      payloadValue: 'me/repo#7',
    });

    expect(result).toBe(2);
    expect(count).toHaveBeenCalledWith({
      where: {
        kind: 'SESSION_INJECT',
        payload: { path: ['prRef'], equals: 'me/repo#7' },
      },
    });
  });
});

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

describe('PreviewActionPrismaRepository.findAllOpen', () => {
  it('status=PENDING + expiresAt>now 전체를 최신 생성순으로 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'p-2',
        slackUserId: 'U9',
        kind: 'PM_WRITE_BACK',
        payload: {},
        status: 'PENDING',
        previewText: 't2',
        expiresAt: new Date('2026-07-02T00:00:00Z'),
        createdAt: new Date('2026-07-01T00:00:00Z'),
        appliedAt: null,
        cancelledAt: null,
        slackChannelId: null,
        slackMessageTs: null,
      },
    ]);
    const prismaMock = {
      previewAction: { findMany },
    } as unknown as PrismaService;
    const repository = new PreviewActionPrismaRepository(prismaMock);
    const now = new Date('2026-07-01T12:00:00Z');

    const result = await repository.findAllOpen({ now });

    expect(findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p-2');
  });
});

describe('PreviewActionPrismaRepository.findRecentAppliedByKind', () => {
  // 이 조회의 존재 이유가 곧 이 단언이다 — 카드를 **띄운** 기록이 아니라 **적용된** 기록만
  // 세야 한다. 거절·만료된 회차까지 세면 발행된 적 없는 주제가 중복으로 막힌다.
  it('APPLIED 상태만, 적용 시각 기준으로 자른다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prismaMock = {
      previewAction: { findMany },
    } as unknown as PrismaService;
    const repository = new PreviewActionPrismaRepository(prismaMock);
    const since = new Date('2026-07-29T00:00:00Z');

    await repository.findRecentAppliedByKind({
      kind: 'BLOG_GITHUB_PUBLISH',
      since,
      limit: 120,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        kind: 'BLOG_GITHUB_PUBLISH',
        status: 'APPLIED',
        appliedAt: { gte: since },
      },
      orderBy: { appliedAt: 'desc' },
      take: 120,
    });
  });
});

describe('PreviewActionPrismaRepository.findById — 폐지된 kind', () => {
  const rowOf = (kind: string) => ({
    id: 'p1',
    slackUserId: 'U1',
    kind,
    payload: {},
    status: 'APPLIED',
    previewText: '옛 카드',
    expiresAt: new Date('2026-08-03T01:00:00Z'),
    createdAt: new Date('2026-08-03T00:00:00Z'),
    appliedAt: new Date('2026-08-03T00:10:00Z'),
    cancelledAt: null,
    slackChannelId: null,
    slackMessageTs: null,
    lastFailedAt: null,
    lastFailureReason: null,
    applyProgress: null,
  });

  const repositoryReturning = (kind: string) => {
    const findUnique = jest.fn().mockResolvedValue(rowOf(kind));
    const prismaMock = {
      previewAction: { findUnique },
    } as unknown as PrismaService;
    return new PreviewActionPrismaRepository(prismaMock);
  };

  // 실행 경로는 사라졌지만 원장에 종결 카드가 남아 있는 kind — 상수를 지우면 이 조회가 예외로 끊긴다.
  it.each(['BE_SANDBOX_APPLY', 'SESSION_INJECT'])(
    '%s 행을 예외 없이 도메인으로 변환한다',
    async (kind) => {
      const preview = await repositoryReturning(kind).findById('p1');

      expect(preview?.kind).toBe(kind);
    },
  );

  // 미등록이면 조회가 끊긴다는 전제가 여전히 살아 있는지. 재료는 상수로 등록될 일이 없는
  // 값을 쓴다 — 실재했던 폐지 kind 를 쓰면 그것이 복원되는 날 전제 파기와 무관한 이유로 깨진다.
  it('상수에 없는 kind 는 예외로 끊는다', async () => {
    await expect(
      repositoryReturning('NOT_A_REGISTERED_KIND').findById('p1'),
    ).rejects.toThrow('알 수 없는 PreviewAction kind: NOT_A_REGISTERED_KIND');
  });
});
