import { PrismaService } from '../../prisma/prisma.service';
import { DailyTodoPrismaRepository } from './daily-todo.prisma.repository';

describe('DailyTodoPrismaRepository', () => {
  const setup = () => {
    const lists = new Map<
      string,
      {
        id: number;
        status: string;
        entries: {
          scheduleItemId: number;
          turn: string;
          observed: boolean;
          position: number;
        }[];
      }
    >();
    const key = (slackUserId: string, kstDate: string) =>
      `${slackUserId}:${kstDate}`;
    const client = {
      dailyTodoList: {
        upsert: jest.fn(async ({ where, create, update }) => {
          const name = key(
            where.slackUserId_kstDate.slackUserId,
            where.slackUserId_kstDate.kstDate,
          );
          const list = lists.get(name) ?? {
            id: lists.size + 1,
            status: create.status,
            entries: [],
          };
          list.status = update.status;
          lists.set(name, list);
          return list;
        }),
        findUnique: jest.fn(
          async ({ where }) =>
            lists.get(
              key(
                where.slackUserId_kstDate.slackUserId,
                where.slackUserId_kstDate.kstDate,
              ),
            ) ?? null,
        ),
      },
      dailyTodoEntry: {
        deleteMany: jest.fn(async ({ where }) => {
          for (const list of lists.values()) {
            if (list.id === where.listId) {
              list.entries = [];
            }
          }
        }),
        createMany: jest.fn(async ({ data }) => {
          for (const entry of data) {
            for (const list of lists.values()) {
              if (list.id === entry.listId) {
                list.entries.push({
                  scheduleItemId: entry.scheduleItemId,
                  turn: entry.turn,
                  observed: entry.observed,
                  position: entry.position,
                });
              }
            }
          }
        }),
      },
      $transaction: async (
        callback: (transaction: unknown) => Promise<unknown>,
      ) => callback(client),
    };
    return new DailyTodoPrismaRepository(client as unknown as PrismaService);
  };
  const entry = {
    scheduleItemId: 1,
    turn: 'MY_TURN' as const,
    observed: true,
    position: 0,
  };
  it('replaceForDate replaces entries', async () => {
    const repository = setup();
    await repository.replaceForDate({
      slackUserId: 'U1',
      kstDate: '2026-11-05',
      status: 'LISTED',
      entries: [entry],
    });
    await repository.replaceForDate({
      slackUserId: 'U1',
      kstDate: '2026-11-05',
      status: 'LISTED',
      entries: [{ ...entry, scheduleItemId: 2 }],
    });
    expect(
      await repository.findForDate({
        slackUserId: 'U1',
        kstDate: '2026-11-05',
      }),
    ).toEqual({ status: 'LISTED', entries: [{ ...entry, scheduleItemId: 2 }] });
  });
  it('EMPTY 헤더는 항목 없이 저장된다', async () => {
    const repository = setup();
    await repository.replaceForDate({
      slackUserId: 'U1',
      kstDate: '2026-11-05',
      status: 'EMPTY',
      entries: [],
    });
    expect(
      await repository.findForDate({
        slackUserId: 'U1',
        kstDate: '2026-11-05',
      }),
    ).toEqual({ status: 'EMPTY', entries: [] });
  });
  it('다른 날짜는 건드리지 않는다', async () => {
    const repository = setup();
    await repository.replaceForDate({
      slackUserId: 'U1',
      kstDate: '2026-11-04',
      status: 'LISTED',
      entries: [entry],
    });
    await repository.replaceForDate({
      slackUserId: 'U1',
      kstDate: '2026-11-05',
      status: 'EMPTY',
      entries: [],
    });
    expect(
      await repository.findForDate({
        slackUserId: 'U1',
        kstDate: '2026-11-04',
      }),
    ).toEqual({ status: 'LISTED', entries: [entry] });
  });
});
