import { Prisma } from '@prisma/client';

import { ScreeningHistoryPrismaRepository } from '../infrastructure/screening-history.prisma.repository';
import { ScoreScreeningOutcomesUsecase } from './score-screening-outcomes.usecase';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const bar = (
  tickerId: number,
  tradeDate: string,
  close: string,
  open: string | null = close,
): {
  tickerId: number;
  tradeDate: Date;
  open: Prisma.Decimal | null;
  close: Prisma.Decimal;
} => ({
  tickerId,
  tradeDate: date(tradeDate),
  open: open === null ? null : decimal(open),
  close: decimal(close),
});

// 5거래일을 채우려면 진입 포함 여섯 봉이 필요하다.
const sixBars = (tickerId: number, entryOpen: string, lastClose: string) => [
  bar(tickerId, '2026-07-02', '1000', entryOpen),
  bar(tickerId, '2026-07-03', '1000'),
  bar(tickerId, '2026-07-06', '1000'),
  bar(tickerId, '2026-07-07', '1000'),
  bar(tickerId, '2026-07-08', '1000'),
  bar(tickerId, '2026-07-09', lastClose),
];

const buildRepository = () => ({
  findUnscoredRuns: jest.fn().mockResolvedValue([]),
  findBarsAfter: jest.fn().mockResolvedValue([]),
  saveScreeningItemOutcomes: jest
    .fn()
    .mockImplementation((rows: unknown[]) => Promise.resolve(rows.length)),
});

const buildUsecase = (
  repository: ReturnType<typeof buildRepository>,
): ScoreScreeningOutcomesUsecase =>
  new ScoreScreeningOutcomesUsecase(
    repository as unknown as ScreeningHistoryPrismaRepository,
  );

describe('ScoreScreeningOutcomesUsecase', () => {
  it('회차에 실린 종목을 산 것과 안 산 것 구분 없이 모두 채점한다', async () => {
    const repository = buildRepository();
    repository.findUnscoredRuns.mockImplementation((horizonDays: number) =>
      Promise.resolve(
        horizonDays === 5
          ? [
              {
                runId: 1,
                strategy: 'SWING',
                asOf: date('2026-07-01'),
                items: [
                  { itemId: 11, tickerId: 100 },
                  { itemId: 12, tickerId: 200 },
                ],
              },
            ]
          : [],
      ),
    );
    repository.findBarsAfter.mockResolvedValue([
      ...sixBars(100, '1000', '1100'),
      ...sixBars(200, '1000', '900'),
    ]);

    const result = await buildUsecase(repository).execute();

    expect(result.totalScoredCount).toBe(2);
    const [saved] = repository.saveScreeningItemOutcomes.mock.calls[0];
    expect(saved).toEqual([
      expect.objectContaining({
        itemId: 11,
        horizonDays: 5,
        entryPrice: '1000',
        horizonPrice: '1100',
        returnPct: '10',
      }),
      expect.objectContaining({ itemId: 12, returnPct: '-10' }),
    ]);
  });

  // 건너뛴 이유를 세지 않으면 "대상은 있는데 채점이 0" 인 날에 무엇을 기다려야 하는지
  // 알 수 없다. 미도래와 값 결손은 대응이 다르다.
  it('건너뛴 사유를 지평별로 나눠 센다', async () => {
    const repository = buildRepository();
    repository.findUnscoredRuns.mockImplementation((horizonDays: number) =>
      Promise.resolve(
        horizonDays === 5
          ? [
              {
                runId: 1,
                strategy: 'SWING',
                asOf: date('2026-07-01'),
                items: [
                  { itemId: 11, tickerId: 100 },
                  { itemId: 12, tickerId: 200 },
                ],
              },
            ]
          : [],
      ),
    );
    repository.findBarsAfter.mockResolvedValue([
      // 봉이 모자란 종목과 진입일 시가가 빠진 종목.
      bar(100, '2026-07-02', '1000'),
      ...sixBars(200, '1000', '1100').map((row, index) =>
        index === 0 ? { ...row, open: null } : row,
      ),
    ]);

    const result = await buildUsecase(repository).execute();

    const fiveDay = result.horizons.find(
      (horizon) => horizon.horizonDays === 5,
    );
    expect(fiveDay).toMatchObject({
      attemptedCount: 2,
      scoredCount: 0,
      skipped: {
        NOT_DUE: 1,
        ENTRY_OPEN_MISSING: 1,
        ENTRY_PRICE_NOT_POSITIVE: 0,
      },
    });
    expect(result.totalScoredCount).toBe(0);
  });

  it('남은 회차가 없으면 조회만 하고 저장을 부르지 않는다', async () => {
    const repository = buildRepository();

    const result = await buildUsecase(repository).execute();

    expect(result.totalScoredCount).toBe(0);
    expect(repository.saveScreeningItemOutcomes).not.toHaveBeenCalled();
    expect(result.horizons.map((horizon) => horizon.horizonDays)).toEqual([
      5, 20,
    ]);
  });
});
