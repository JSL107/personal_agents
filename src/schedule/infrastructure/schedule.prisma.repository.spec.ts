import { PrismaService } from '../../prisma/prisma.service';
import { ScheduleActor } from '../domain/schedule.repository.type';
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

  it('소유자의 미완 업무를 기한 제한 없이 읽는다', async () => {
    const findMany = jest.fn().mockResolvedValue([row]);
    const repository = new SchedulePrismaRepository({
      scheduleItem: { findMany },
    } as unknown as PrismaService);
    const found = await repository.findUnfinished({ slackUserId: 'U1' });
    expect(findMany.mock.calls[0][0].where).toEqual({
      slackUserId: 'U1',
      status: { in: ['OPEN', 'IN_PROGRESS', 'CANDIDATE'] },
    });
    expect(found).toHaveLength(1);
  });

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
      actor: ScheduleActor.USER,
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
      actor: ScheduleActor.USER,
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
  it('초안은 같은 선점이며 아직 미발송·초안 없는 연락만 저장한다', async () => {
    const claimAt = new Date('2026-11-04T05:00:00Z');
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const repository = new SchedulePrismaRepository({
      scheduleFollowUp: { updateMany },
    } as unknown as PrismaService);
    expect(
      await repository.saveFollowUpDraft({ id: 8, claimAt, draft: '초안' }),
    ).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 8,
        deliveryClaimedAt: claimAt,
        notifiedAt: null,
        draft: null,
      },
      data: { draft: '초안' },
    });
  });

  it('연락 대상이 바뀌면 기존 초안과 선점을 함께 지운다', async () => {
    const found = {
      id: 8,
      scheduleItemId: 7,
      recipient: 'PM',
      topic: '배포',
      trigger: 'AT_TIME',
      triggerAt: new Date('2026-11-04T05:00:00Z'),
      draft: '이전 초안',
      deliveryClaimedAt: new Date('2026-11-04T05:01:00Z'),
      notifiedAt: null,
      sentAt: null,
    };
    const update = jest.fn().mockResolvedValue({
      ...found,
      recipient: 'CEO',
      draft: null,
      deliveryClaimedAt: null,
    });
    const repository = new SchedulePrismaRepository({
      scheduleFollowUp: {
        findFirst: jest.fn().mockResolvedValue(found),
        update,
      },
    } as unknown as PrismaService);
    await repository.updateFollowUp({
      id: 8,
      slackUserId: 'U1',
      recipient: 'CEO',
    });
    expect(update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ draft: null, deliveryClaimedAt: null }),
    );
  });
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
    expect(findMany.mock.calls[0][0].where.sentAt).toBeNull();
    expect(where.sentAt).toBeNull();
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
      actor: ScheduleActor.USER,
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
      actor: ScheduleActor.USER,
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
      actor: ScheduleActor.USER,
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

describe('리뷰 1회차 저장소 회귀', () => {
  const now = new Date('2026-11-05T05:00:00Z');
  const row = {
    id: 1,
    slackUserId: 'U1',
    status: 'DONE',
    startedAt: now,
    remindAt: now,
  };
  it.each([ScheduleStatus.IN_PROGRESS, ScheduleStatus.SKIPPED])(
    'DONE에서 %s로 가면 완료 시각과 미발송 발동을 지운다',
    async (to) => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const followUpUpdate = jest.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        scheduleItem: {
          findUnique: jest.fn().mockResolvedValue(row),
          updateMany,
        },
        scheduleFollowUp: { updateMany: followUpUpdate },
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
        from: ScheduleStatus.DONE,
        to,
        now,
        actor: ScheduleActor.USER,
      });
      expect(updateMany.mock.calls[0][0].data.completedAt).toBeNull();
      expect(followUpUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            trigger: 'ON_DONE',
            notifiedAt: null,
          }),
          data: { triggerAt: null },
        }),
      );
    },
  );
  it.each([ScheduleStatus.DONE, ScheduleStatus.OPEN])(
    'ON_DONE을 %s 업무에 추가하면 업무 상태에 따라 발동한다',
    async (status) => {
      jest.useFakeTimers().setSystemTime(now);
      try {
        const create = jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 2, ...data }),
          );
        const findFirst = jest.fn().mockResolvedValue({ id: 1, status });
        const repository = new SchedulePrismaRepository({
          scheduleItem: { findFirst },
          scheduleFollowUp: { create },
        } as unknown as PrismaService);
        await repository.addFollowUp({
          scheduleItemId: 1,
          slackUserId: 'U1',
          recipient: 'PM',
          topic: '공유',
          trigger: 'ON_DONE' as never,
          triggerAt: new Date('2027-01-01'),
        });
        expect(findFirst.mock.calls[0][0].select).toEqual({
          id: true,
          status: true,
        });
        expect(create.mock.calls[0][0].data.triggerAt).toEqual(
          status === ScheduleStatus.DONE ? now : null,
        );
      } finally {
        jest.useRealTimers();
      }
    },
  );
  it('필드 수정으로 알림 시각이 바뀌면 기존 선점도 해제한다', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue(row);
    const findUnique = jest.fn().mockResolvedValue(row);
    const repository = new SchedulePrismaRepository({
      scheduleItem: { findFirst, findUnique, updateMany },
    } as unknown as PrismaService);
    await repository.updateFields({
      id: 1,
      slackUserId: 'U1',
      expected: { dueDate: null, startDate: null, dueTime: null },
      patch: { remindAt: null },
    });
    expect(updateMany.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ remindedAt: null, deliveryClaimedAt: null }),
    );
  });
  it('상태 전이와 함께 알림 시각이 바뀌면 기존 선점도 해제한다', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      scheduleItem: {
        findUnique: jest.fn().mockResolvedValue(row),
        updateMany,
      },
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
      from: ScheduleStatus.DONE,
      to: ScheduleStatus.OPEN,
      now,
      actor: ScheduleActor.USER,
      patch: { remindAt: null },
    });
    expect(updateMany.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ remindedAt: null, deliveryClaimedAt: null }),
    );
  });
});

describe('미발송 연락 일괄 집계', () => {
  it('업무별 미발송 수를 groupBy로 조회한다', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValue([{ scheduleItemId: 1, _count: { _all: 2 } }]);
    const repository = new SchedulePrismaRepository({
      scheduleFollowUp: { groupBy },
    } as unknown as PrismaService);
    const actual = await (
      repository as unknown as {
        countPendingFollowUps(input: {
          scheduleItemIds: number[];
        }): Promise<Map<number, number>>;
      }
    ).countPendingFollowUps({ scheduleItemIds: [1, 2] });
    expect(actual.get(1)).toBe(2);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['scheduleItemId'],
      where: {
        scheduleItemId: { in: [1, 2] },
        notifiedAt: null,
        sentAt: null,
      },
      _count: { _all: true },
    });
  });
});

describe('보냄 표시가 된 연락', () => {
  it('상세 조회에서 보냄 표시를 미발송 수에서 제외한다', async () => {
    const followUp = {
      id: 8,
      scheduleItemId: 1,
      recipient: 'PM',
      topic: '배포',
      trigger: 'AT_TIME',
      triggerAt: new Date('2026-11-05T05:00:00Z'),
      draft: null,
      notifiedAt: null,
      sentAt: new Date('2026-11-05T05:01:00Z'),
      deliveryClaimedAt: null,
    };
    const findFirst = jest.fn().mockResolvedValue({
      id: 1,
      slackUserId: 'U1',
      title: '배포',
      dueDate: null,
      dueTime: null,
      linkUrl: null,
      memo: null,
      status: 'OPEN',
      completedAt: null,
      isHoliday: false,
      followUps: [followUp, { ...followUp, id: 9, sentAt: null }],
      events: [],
    });
    const repository = new SchedulePrismaRepository({
      scheduleItem: { findFirst },
    } as unknown as PrismaService);

    const detail = await repository.findDetail({ id: 1, slackUserId: 'U1' });
    expect(detail?.pendingFollowUpCount).toBe(1);
  });
});

describe('집계와 연락 시각 경계', () => {
  it('빈 업무 ID 목록은 groupBy를 호출하지 않는다', async () => {
    const groupBy = jest.fn();
    const repository = new SchedulePrismaRepository({
      scheduleFollowUp: { groupBy },
    } as unknown as PrismaService);
    expect(
      await repository.countPendingFollowUps({ scheduleItemIds: [] }),
    ).toEqual(new Map());
    expect(groupBy).not.toHaveBeenCalled();
  });
  it('AT_TIME은 업무 상태와 무관하게 요청 시각을 보존한다', async () => {
    const triggerAt = new Date('2026-11-05T05:00:00Z');
    const create = jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve({ id: 2, ...data }));
    const repository = new SchedulePrismaRepository({
      scheduleItem: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, status: 'DONE' }),
      },
      scheduleFollowUp: { create },
    } as unknown as PrismaService);
    await repository.addFollowUp({
      scheduleItemId: 1,
      slackUserId: 'U1',
      recipient: 'PM',
      topic: '공유',
      trigger: 'AT_TIME' as never,
      triggerAt,
    });
    expect(create.mock.calls[0][0].data.triggerAt).toEqual(triggerAt);
  });
  it('중복 위반이 아닌 저장 오류는 삼키지 않는다', async () => {
    const error = new Error('database unavailable');
    const repository = new SchedulePrismaRepository({
      scheduleEvent: { create: jest.fn().mockRejectedValue(error) },
    } as unknown as PrismaService);
    await expect(
      repository.addEvent({
        scheduleItemId: 1,
        kind: 'NOTE' as never,
        payload: {},
        occurredAt: new Date(),
      }),
    ).rejects.toThrow(error);
  });
});

describe('알림 시각 미변경', () => {
  it('remindAt이 undefined면 발송 및 선점 표식을 건드리지 않는다', async () => {
    const found = {
      id: 1,
      slackUserId: 'U1',
      remindAt: new Date('2026-11-05T05:00:00Z'),
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const repository = new SchedulePrismaRepository({
      scheduleItem: {
        findFirst: jest.fn().mockResolvedValue(found),
        findUnique: jest.fn().mockResolvedValue(found),
        updateMany,
      },
    } as unknown as PrismaService);
    await repository.updateFields({
      id: 1,
      slackUserId: 'U1',
      expected: { dueDate: null, startDate: null, dueTime: null },
      patch: { remindAt: undefined, title: '제목' },
    });
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty('remindedAt');
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty(
      'deliveryClaimedAt',
    );
  });
});

it('만료 전 Slack 후보를 마감일 유무와 관계없이 센다', async () => {
  const count = jest.fn().mockResolvedValue(2);
  const repository = new SchedulePrismaRepository({
    scheduleItem: { count },
  } as never);
  const now = new Date('2026-11-03T00:00:00Z');
  expect(
    await repository.countActiveCandidates({ slackUserId: 'U1', now }),
  ).toBe(2);
  expect(count).toHaveBeenCalledWith({
    where: {
      slackUserId: 'U1',
      status: 'CANDIDATE',
      source: 'SLACK_MENTION',
      candidateExpiresAt: { gt: now },
    },
  });
});

describe('PR 이벤트와 상태 전이의 원자성', () => {
  const now = new Date('2026-11-04T05:00:00Z');
  const event = {
    scheduleItemId: 1,
    kind: 'PR_MERGED' as never,
    payload: { url: 'https://github.com/o/r/pull/4' },
    dedupeKey: 'https://github.com/o/r/pull/4',
    occurredAt: now,
  };
  const input = {
    event,
    slackUserId: 'U1',
    transitionFrom: [ScheduleStatus.IN_PROGRESS],
    transitionTo: ScheduleStatus.DONE,
    now,
    actor: ScheduleActor.COLLECTOR,
  };

  it('전이 쓰기가 실패하면 앞선 PR 사건도 커밋하지 않고 오류를 전파한다', async () => {
    const committedEvents: unknown[] = [];
    const pendingEvents: unknown[] = [];
    const error = new Error('transient transition failure');
    const client = {
      scheduleEvent: {
        create: jest.fn().mockImplementation(async ({ data }) => {
          pendingEvents.push(data);
          return { id: 1, ...data };
        }),
      },
      scheduleItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          slackUserId: 'U1',
          status: ScheduleStatus.IN_PROGRESS,
        }),
        updateMany: jest.fn().mockRejectedValue(error),
      },
    };
    const transaction = jest.fn().mockImplementation(async (callback) => {
      try {
        const result = await callback(client);
        committedEvents.push(...pendingEvents);
        return result;
      } catch (error) {
        pendingEvents.length = 0;
        throw error;
      }
    });
    const repository = new SchedulePrismaRepository({
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(repository.recordEventAndTransition(input)).rejects.toThrow(
      error,
    );
    expect(client.scheduleEvent.create).toHaveBeenCalledTimes(1);
    expect(client.scheduleItem.updateMany).toHaveBeenCalledTimes(1);
    expect(committedEvents).toHaveLength(0);
  });

  it('사건 생성 P2002는 트랜잭션 밖에서 DUPLICATE로 처리한다', async () => {
    const client = {
      scheduleEvent: {
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
      },
      scheduleItem: { findUnique: jest.fn(), updateMany: jest.fn() },
    };
    const transaction = jest
      .fn()
      .mockImplementation(async (callback) => callback(client));
    const repository = new SchedulePrismaRepository({
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(repository.recordEventAndTransition(input)).resolves.toBe(
      'DUPLICATE',
    );
    expect(client.scheduleItem.updateMany).not.toHaveBeenCalled();
  });

  it('전이 단계의 P2002는 중복 사건으로 오인하지 않고 전파한다', async () => {
    const error = { code: 'P2002' };
    const client = {
      scheduleEvent: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      scheduleItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          slackUserId: 'U1',
          status: ScheduleStatus.IN_PROGRESS,
        }),
        updateMany: jest.fn().mockRejectedValue(error),
      },
    };
    const repository = new SchedulePrismaRepository({
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(client)),
    } as unknown as PrismaService);

    await expect(repository.recordEventAndTransition(input)).rejects.toBe(
      error,
    );
  });
});
