import { PrismaService } from '../../prisma/prisma.service';
import { CujLedgerPrismaReader } from './cuj-ledger.prisma.reader';

describe('CujLedgerPrismaReader.readPaperRecommendations', () => {
  const since = new Date('2026-10-12T15:00:00.000Z');
  const until = new Date('2026-10-13T15:00:00.000Z');
  const row = (id: number, inputSnapshot: unknown) => ({
    status: 'SUCCEEDED',
    agentType: 'PAPER_RECOMMEND',
    durationMs: null,
    startedAt: new Date('2026-10-13T10:30:00.000Z'),
    output: { id },
    inputSnapshot,
  });

  it('과거 decidedAt 으로 재실행한 회차는 빼고 판단 기준일이 범위 안이거나 없는 회차는 남긴다', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        row(1, { decidedAt: '2026-10-13T10:30:00.000Z' }),
        row(2, { decidedAt: '2026-10-06T10:30:00.000Z' }),
        row(3, {}),
      ]);
    const reader = new CujLedgerPrismaReader({
      agentRun: { findMany },
    } as unknown as PrismaService);

    const rows = await reader.readPaperRecommendations(since, until);

    expect(rows.map((found) => found.output)).toEqual([{ id: 1 }, { id: 3 }]);
    expect(rows[0]).not.toHaveProperty('inputSnapshot');
  });
});

describe('CujLedgerPrismaReader.findLatestDeliveryBefore', () => {
  it('발송 실패(FAILED) 행은 회차 기록으로 치지 않는다', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const reader = new CujLedgerPrismaReader({
      slackDelivery: { findFirst },
    } as unknown as PrismaService);
    const before = new Date('2026-10-16T15:00:00.000Z');

    await reader.findLatestDeliveryBefore('weekly-summary', before);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          itemKinds: { has: 'weekly-summary' },
          createdAt: { lt: before },
          status: { not: 'FAILED' },
        },
      }),
    );
  });
});
