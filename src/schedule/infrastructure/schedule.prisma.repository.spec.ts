import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleStatus } from '../domain/schedule.type';
import { SchedulePrismaRepository } from './schedule.prisma.repository';

// 조회 범위를 만드는 자리. 아침 브리핑이 하한 없이 부르는 것을 태스크 쪽 테스트가 고정하지만,
// **그 호출이 실제 쿼리에서 어떤 where 가 되는지는 여기서만 드러난다** — Prisma 가
// `gte: undefined` 를 알아서 빼 준다는 동작에 기대고 있었다면 이 테스트가 그것을 못 박는다.
describe('SchedulePrismaRepository.findByDateRange', () => {
  const buildRepository = (findMany: jest.Mock): SchedulePrismaRepository => {
    return new SchedulePrismaRepository({
      scheduleItem: { findMany },
    } as unknown as PrismaService);
  };

  it('from 을 생략하면 하한(gte)을 아예 걸지 않는다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = buildRepository(findMany);

    await repository.findByDateRange({
      slackUserId: 'U1',
      to: new Date('2026-09-29T00:00:00Z'),
    });

    const where = findMany.mock.calls[0][0].where as {
      dueDate: { gte?: Date; lte: Date };
    };
    expect(where.dueDate).toEqual({ lte: new Date('2026-09-29T00:00:00Z') });
    // `toEqual` 은 `{ gte: undefined }` 도 통과시키므로 키 자체가 없음을 따로 본다 —
    // 에폭 같은 대체 하한이 슬쩍 들어오면 여기서 깨져야 한다.
    expect('gte' in where.dueDate).toBe(false);
  });

  it('from 을 주면 하한을 그대로 건다 — 달 단위로 보는 콘솔 격자 경로', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = buildRepository(findMany);

    await repository.findByDateRange({
      slackUserId: 'U1',
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-30T00:00:00Z'),
    });

    const where = findMany.mock.calls[0][0].where as {
      dueDate: { gte?: Date; lte: Date };
    };
    expect(where.dueDate).toEqual({
      gte: new Date('2026-09-01T00:00:00Z'),
      lte: new Date('2026-09-30T00:00:00Z'),
    });
  });

  // "지난 것이 먼저" 는 소비자(브리핑 한 줄·콘솔 목록)가 받은 순서를 그대로 쓰기 때문에
  // 이 orderBy 하나에 달려 있다. 여기서 바뀌면 지난 마감이 다가올 마감 뒤로 밀린다.
  it('마감일 오름차순으로 정렬해 지난 마감이 앞에 오게 한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = buildRepository(findMany);

    await repository.findByDateRange({
      slackUserId: 'U1',
      to: new Date('2026-09-29T00:00:00Z'),
    });

    expect(findMany.mock.calls[0][0].orderBy).toEqual([
      { dueDate: 'asc' },
      { id: 'asc' },
    ]);
  });
});

describe('SchedulePrismaRepository 업무 트래킹', () => {
  const date = new Date('2026-11-05T05:00:00Z');
  const row = {
    id: 1,
    slackUserId: 'U1',
    title: '업무',
    dueDate: date,
    dueTime: null,
    linkUrl: null,
    memo: null,
    status: 'OPEN',
    completedAt: null,
    isHoliday: false,
    source: 'MANUAL',
    sourceKey: null,
    sourceUrl: null,
    startDate: null,
    startedAt: null,
    remindAt: null,
    remindedAt: null,
    candidateExpiresAt: null,
    deliveryClaimedAt: null,
  };

  it('월 추적 조회는 시작일과 마감일 중 하나가 범위에 들면 돌려준다', async () => {
    const findMany = jest.fn().mockResolvedValue([row]);
    const repository = new SchedulePrismaRepository({
      scheduleItem: { findMany },
    } as unknown as PrismaService);
    const from = new Date('2026-11-01T00:00:00Z');
    const to = new Date('2026-11-30T00:00:00Z');
    await repository.findTrackingMonth({ slackUserId: 'U1', from, to });
    expect(findMany.mock.calls[0][0].where).toEqual({
      slackUserId: 'U1',
      OR: [
        { dueDate: { gte: from, lte: to } },
        { startDate: { gte: from, lte: to } },
      ],
    });
  });

  it('기한 없는 조회는 미완 상태만 가져온다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new SchedulePrismaRepository({
      scheduleItem: { findMany },
    } as unknown as PrismaService);
    await repository.findUndated('U1');
    expect(findMany.mock.calls[0][0].where).toEqual({
      slackUserId: 'U1',
      dueDate: null,
      status: { in: ['OPEN', 'IN_PROGRESS', 'CANDIDATE'] },
    });
  });

  it('전이 선점이 0건이면 이벤트를 쓰지 않는다', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const create = jest.fn();
    const findUnique = jest.fn().mockResolvedValue(row);
    const prisma = {
      scheduleItem: { updateMany, findUnique },
      scheduleEvent: { create },
      $transaction: async (callback: (client: unknown) => Promise<unknown>) =>
        callback(prisma),
    };
    const repository = new SchedulePrismaRepository(
      prisma as unknown as PrismaService,
    );
    const result = await repository.transition({
      id: 1,
      slackUserId: 'U1',
      from: 'OPEN' as never,
      to: 'DONE' as never,
      now: date,
      actor: 'USER',
    });
    expect(result).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('완료 전이는 같은 트랜잭션에서 미발송 ON_DONE 연락을 발동한다', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const followUpUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn();
    const findUnique = jest
      .fn()
      .mockResolvedValue({ ...row, status: 'DONE', completedAt: date });
    const prisma = {
      scheduleItem: { updateMany, findUnique },
      scheduleFollowUp: { updateMany: followUpUpdate },
      scheduleEvent: { create },
      $transaction: async (callback: (client: unknown) => Promise<unknown>) =>
        callback(prisma),
    };
    const repository = new SchedulePrismaRepository(
      prisma as unknown as PrismaService,
    );
    await repository.transition({
      id: 1,
      slackUserId: 'U1',
      from: 'OPEN' as never,
      to: 'DONE' as never,
      now: date,
      actor: 'USER',
    });
    expect(followUpUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scheduleItemId: 1,
          trigger: 'ON_DONE',
          notifiedAt: null,
        }),
        data: { triggerAt: date },
      }),
    );
    expect(create).toHaveBeenCalled();
  });

  it('중복 수집 P2002는 DUPLICATE로 반환한다', async () => {
    const create = jest.fn().mockRejectedValue({ code: 'P2002' });
    const repository = new SchedulePrismaRepository({
      scheduleItem: { create },
    } as unknown as PrismaService);
    const result = await repository.createCollected({
      slackUserId: 'U1',
      title: '업무',
      dueDate: null,
      source: 'SLACK_MENTION' as never,
      sourceKey: 'C:1',
      sourceUrl: null,
      status: 'CANDIDATE' as never,
    });
    expect(result).toBe('DUPLICATE');
  });

  it('다른 회차가 먼저 선점한 알림은 반환 목록에서 뺀다', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ ...row, remindAt: date, status: 'OPEN' }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const repository = new SchedulePrismaRepository({
      scheduleItem: { findMany, updateMany },
    } as unknown as PrismaService);
    const result = await repository.claimDueReminders({
      now: date,
      ownerId: 'U1',
    });
    expect(result).toEqual([]);
    expect(updateMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        id: 1,
        remindedAt: null,
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        OR: [
          { deliveryClaimedAt: null },
          { deliveryClaimedAt: { lt: new Date(date.getTime() - 600000) } },
        ],
      }),
    );
  });
});

describe('알림 선점 시점 재검증', () => {
  it('조회 후 알림 시각이 바뀐 행을 선점하지 않도록 시각 조건을 다시 건다', async () => {
    const now = new Date('2026-11-05T05:00:00Z');
    const findMany = jest.fn().mockResolvedValue([{ id: 1 }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const repository = new SchedulePrismaRepository({
      scheduleItem: { findMany, updateMany },
    } as unknown as PrismaService);
    await repository.claimDueReminders({ now, ownerId: 'U1' });
    expect(updateMany.mock.calls[0][0].where.remindAt).toEqual({ lte: now });
  });
});

describe('수동 일정 생성 타임라인', () => {
  it('일정과 CREATED 사건을 함께 생성한다', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 1,
      slackUserId: 'U1',
      title: '업무',
      dueDate: new Date('2026-11-05'),
      dueTime: null,
      linkUrl: null,
      memo: null,
      status: 'OPEN',
      completedAt: null,
      isHoliday: false,
    });
    const repository = new SchedulePrismaRepository({
      scheduleItem: { create },
    } as unknown as PrismaService);
    await repository.save({
      slackUserId: 'U1',
      title: '업무',
      dueDate: new Date('2026-11-05'),
    });
    expect(create.mock.calls[0][0].data.events.create.kind).toBe('CREATED');
  });
});

describe('연락할 일 선점 시점 재검증', () => {
  it('조회 이후 발동 시각과 업무 상태가 바뀌면 선점하지 않도록 조건을 다시 건다', async () => {
    const now = new Date('2026-11-05T05:00:00Z');
    const findMany = jest.fn().mockResolvedValue([{ id: 1 }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const repository = new SchedulePrismaRepository({
      scheduleFollowUp: { findMany, updateMany },
    } as unknown as PrismaService);
    await repository.claimDueFollowUps({ now, ownerId: 'U1' });
    const where = updateMany.mock.calls[0][0].where;
    expect(where.triggerAt).toEqual({ lte: now });
    expect(where.scheduleItem).toEqual({ slackUserId: 'U1' });
    expect(where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              trigger: 'ON_DONE',
              scheduleItem: { status: 'DONE' },
            }),
          ]),
        }),
      ]),
    );
  });
});

describe('건너뜀 복구', () => {
  it('SKIPPED 에서 OPEN 으로 되돌리면 완료 시각을 비운다', async () => {
    const row = {
      id: 1,
      slackUserId: 'U1',
      status: 'SKIPPED',
      startedAt: null,
    };
    const findUnique = jest.fn().mockResolvedValue(row);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      scheduleItem: { findUnique, updateMany },
      scheduleEvent: { create: jest.fn() },
      $transaction: async (callback: (client: unknown) => Promise<unknown>) =>
        callback(prisma),
    };
    const repository = new SchedulePrismaRepository(
      prisma as unknown as PrismaService,
    );
    await repository.transition({
      id: 1,
      slackUserId: 'U1',
      from: 'SKIPPED' as never,
      to: 'OPEN' as never,
      now: new Date(),
      actor: 'USER',
    });
    expect(updateMany.mock.calls[0][0].data.completedAt).toBeNull();
  });
});

describe('발송 표식의 이벤트 중복', () => {
  it('같은 연락할 일 재알림도 기존 이벤트와 충돌하지 않고 표식을 남긴다', async () => {
    const now = new Date('2026-11-05T05:00:00Z');
    const createMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      scheduleFollowUp: {
        findUnique: jest.fn().mockResolvedValue({ scheduleItemId: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      scheduleEvent: { createMany },
      $transaction: async (callback: (client: unknown) => Promise<unknown>) =>
        callback(prisma),
    };
    const repository = new SchedulePrismaRepository(
      prisma as unknown as PrismaService,
    );
    expect(
      await repository.markFollowUpNotified({
        id: 5,
        draft: '초안',
        now,
        claimAt: now,
        triggerAt: now,
      }),
    ).toBe(true);
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });
});

describe('상태와 필드의 동시 변경', () => {
  it('상태 전이 선점과 필드 변경을 하나의 갱신으로 처리한다', async () => {
    const row = {
      id: 1,
      slackUserId: 'U1',
      status: 'OPEN',
      startedAt: null,
      remindAt: null,
    };
    const findUnique = jest.fn().mockResolvedValue(row);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      scheduleItem: { findUnique, updateMany },
      scheduleFollowUp: { updateMany: jest.fn() },
      scheduleEvent: { create: jest.fn() },
      $transaction: async (callback: (client: unknown) => Promise<unknown>) =>
        callback(prisma),
    };
    const repository = new SchedulePrismaRepository(
      prisma as unknown as PrismaService,
    );
    await repository.transition({
      id: 1,
      slackUserId: 'U1',
      from: 'OPEN' as never,
      to: 'DONE' as never,
      now: new Date(),
      actor: 'USER',
      patch: { title: '새 제목' },
    });
    expect(updateMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'OPEN' }),
        data: expect.objectContaining({ status: 'DONE', title: '새 제목' }),
      }),
    );
  });
});

describe('연락할 일 발송 표시', () => {
  it('triggerAt을 변경하지 않는 보냄 표시는 notifiedAt을 초기화하지 않는다', async () => {
    const found = {
      id: 1,
      scheduleItemId: 1,
      recipient: 'PM',
      topic: '공유',
      trigger: 'AT_TIME',
      triggerAt: new Date('2026-11-05T05:00:00Z'),
      draft: null,
      notifiedAt: new Date(),
      sentAt: null,
      deliveryClaimedAt: null,
    };
    const update = jest.fn().mockResolvedValue(found);
    const repository = new SchedulePrismaRepository({
      scheduleFollowUp: {
        findFirst: jest.fn().mockResolvedValue(found),
        update,
      },
    } as unknown as PrismaService);
    await repository.updateFollowUp({
      id: 1,
      slackUserId: 'U1',
      triggerAt: undefined,
      sentAt: new Date(),
    });
    expect(update.mock.calls[0][0].data).not.toHaveProperty('notifiedAt');
  });
});

describe('오래된 선점의 발송 표식', () => {
  it('선점한 알림 시각과 선점 시각을 조건으로 발송 표식을 남긴다', async () => {
    const now = new Date('2026-11-05T05:00:00Z');
    const claimAt = new Date('2026-11-05T04:59:00Z');
    const reminderAt = new Date('2026-11-05T04:58:00Z');
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      scheduleItem: {
        findUnique: jest.fn().mockResolvedValue({ remindAt: reminderAt }),
        updateMany,
      },
      $transaction: async (callback: (client: unknown) => Promise<unknown>) =>
        callback(prisma),
    };
    const repository = new SchedulePrismaRepository(
      prisma as unknown as PrismaService,
    );
    expect(
      await repository.markReminded({ id: 1, now, claimAt, reminderAt }),
    ).toBe(false);
    expect(updateMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        deliveryClaimedAt: claimAt,
        remindAt: reminderAt,
      }),
    );
  });
});

describe('연락할 일 초안 무효화', () => {
  it('받는 사람이나 주제가 바뀌면 이전 초안을 비운다', async () => {
    const found = {
      id: 1,
      scheduleItemId: 1,
      recipient: 'PM',
      topic: '공유',
      trigger: 'AT_TIME',
      triggerAt: null,
      draft: '기존 초안',
      notifiedAt: null,
      sentAt: null,
      deliveryClaimedAt: null,
    };
    const update = jest.fn().mockResolvedValue(found);
    const repository = new SchedulePrismaRepository({
      scheduleFollowUp: {
        findFirst: jest.fn().mockResolvedValue(found),
        update,
      },
    } as unknown as PrismaService);
    await repository.updateFollowUp({
      id: 1,
      slackUserId: 'U1',
      recipient: '개발팀',
    });
    expect(update.mock.calls[0][0].data.draft).toBeNull();
  });
});

describe('필드 수정 날짜 CAS', () => {
  const expected = {
    dueDate: new Date('2026-11-05'),
    startDate: null,
    dueTime: '09:00',
  };
  it('필드 수정은 검증 당시 날짜와 시각을 where에 걸고 경합 0건이면 null이다', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue({ id: 1, slackUserId: 'U1', remindAt: null });
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const findUnique = jest.fn();
    const repository = new SchedulePrismaRepository({
      scheduleItem: { findFirst, updateMany, findUnique },
    } as unknown as PrismaService);
    const result = await repository.updateFields({
      id: 1,
      slackUserId: 'U1',
      patch: { startDate: new Date('2026-11-04') },
      expected,
    });
    expect(result).toBeNull();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1, slackUserId: 'U1', ...expected },
      }),
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('상태와 필드 동시 전이도 검증 날짜 스냅샷을 where에 건다', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 1,
      slackUserId: 'U1',
      status: 'OPEN',
      startedAt: null,
      remindAt: null,
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const create = jest.fn();
    const client = {
      scheduleItem: { findUnique, updateMany },
      scheduleEvent: { create },
    };
    const repository = new SchedulePrismaRepository({
      $transaction: (callback: (value: unknown) => Promise<unknown>) =>
        callback(client),
    } as unknown as PrismaService);
    const result = await repository.transition({
      id: 1,
      slackUserId: 'U1',
      from: ScheduleStatus.OPEN,
      to: ScheduleStatus.DONE,
      actor: 'USER',
      now: new Date(),
      patch: { dueDate: new Date('2026-11-06') },
      expected,
    });
    expect(result).toBeNull();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 1,
          slackUserId: 'U1',
          status: ScheduleStatus.OPEN,
          ...expected,
        },
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });
});
