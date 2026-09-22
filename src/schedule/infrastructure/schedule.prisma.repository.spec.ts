import { PrismaService } from '../../prisma/prisma.service';
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
