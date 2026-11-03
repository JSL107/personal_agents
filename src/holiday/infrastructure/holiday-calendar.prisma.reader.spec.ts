import { PrismaService } from '../../prisma/prisma.service';
import { readHolidayCalendar } from './holiday-calendar.prisma.reader';

describe('readHolidayCalendar', () => {
  it('마감일이 없는 행은 공휴일 조회에서 제외한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await readHolidayCalendar({
      scheduleItem: { findMany },
    } as unknown as PrismaService);
    expect(findMany.mock.calls[0][0].where).toEqual({
      isHoliday: true,
      dueDate: { not: null },
    });
  });
});
