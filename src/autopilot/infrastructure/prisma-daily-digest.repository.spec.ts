import { PrismaDailyDigestRepository } from './prisma-daily-digest.repository';

describe('PrismaDailyDigestRepository.findNextPaperOrders', () => {
  const tradeDate = new Date('2026-07-03T00:00:00.000Z');

  it('다음 체결일 하루치만 센다 — 그 뒤 날짜의 대기 주문은 "다음 체결일 예정" 에 넣지 않는다', async () => {
    const nextDay = new Date('2026-07-06T00:00:00.000Z');
    const prisma = {
      paperOrder: {
        findFirst: jest.fn().mockResolvedValue({ targetTradeDate: nextDay }),
        groupBy: jest.fn().mockResolvedValue([
          { side: 'BUY', _count: { _all: 1 } },
          { side: 'SELL', _count: { _all: 3 } },
        ]),
      },
    };
    const repository = new PrismaDailyDigestRepository(prisma as never);

    const found = await repository.findNextPaperOrders({ tradeDate });

    expect(prisma.paperOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING', targetTradeDate: { gt: tradeDate } },
        orderBy: { targetTradeDate: 'asc' },
      }),
    );
    // 세는 조건은 "오늘 이후 전부" 가 아니라 가장 이른 체결일과 같은 날이다.
    expect(prisma.paperOrder.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING', targetTradeDate: nextDay },
      }),
    );
    expect(found).toEqual({
      buyCount: 1,
      sellCount: 3,
      tradeDate: '2026-07-06',
    });
  });

  it('오늘 이후 대기 주문이 없으면 null 이고 세지 않는다', async () => {
    const prisma = {
      paperOrder: {
        findFirst: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn(),
      },
    };
    const repository = new PrismaDailyDigestRepository(prisma as never);

    await expect(
      repository.findNextPaperOrders({ tradeDate }),
    ).resolves.toBeNull();
    expect(prisma.paperOrder.groupBy).not.toHaveBeenCalled();
  });
});
