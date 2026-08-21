import { Prisma } from '@prisma/client';

import { scoreScreeningItem, ScreeningOutcomeBar } from './screening-outcome';

const decimal = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const bar = (
  tradeDate: string,
  close: string,
  open: string | null = close,
): ScreeningOutcomeBar => ({
  tradeDate: date(tradeDate),
  open: open === null ? null : decimal(open),
  close: decimal(close),
});

describe('scoreScreeningItem', () => {
  it('다음 거래일 시가로 진입해 지평 거래일 종가로 수익률을 낸다', () => {
    const result = scoreScreeningItem({
      horizonDays: 5,
      barsAfterAsOf: [
        bar('2026-08-14', '10500', '10000'),
        bar('2026-08-18', '10600'),
        bar('2026-08-19', '10700'),
        bar('2026-08-20', '10800'),
        bar('2026-08-21', '10900'),
        bar('2026-08-24', '11000'),
      ],
    });

    expect(result).toEqual({
      kind: 'SCORED',
      outcome: {
        horizonDays: 5,
        entryTradeDate: date('2026-08-14'),
        entryPrice: '10000',
        horizonTradeDate: date('2026-08-24'),
        horizonPrice: '11000',
        returnPct: '10',
      },
    });
  });

  // 달력이 아니라 저장된 봉으로 센다. 휴장일이 섞여도 여섯 번째 행이 지평이다.
  it('봉이 지평 수에 한 개라도 모자라면 미도래로 건너뛴다', () => {
    const result = scoreScreeningItem({
      horizonDays: 5,
      barsAfterAsOf: [
        bar('2026-08-14', '10500', '10000'),
        bar('2026-08-18', '10600'),
        bar('2026-08-19', '10700'),
        bar('2026-08-20', '10800'),
        bar('2026-08-21', '10900'),
      ],
    });

    expect(result).toEqual({ kind: 'SKIPPED', reason: 'NOT_DUE' });
  });

  it('진입일 봉이 아직 없으면 미도래로 건너뛴다', () => {
    const result = scoreScreeningItem({ horizonDays: 5, barsAfterAsOf: [] });

    expect(result).toEqual({ kind: 'SKIPPED', reason: 'NOT_DUE' });
  });

  // 시가가 없는 봉으로 종가를 대신 쓰면 진입 기준이 종목마다 갈린다.
  it('진입일 시가가 없으면 종가로 대체하지 않고 사유를 남긴다', () => {
    const result = scoreScreeningItem({
      horizonDays: 1,
      barsAfterAsOf: [bar('2026-08-14', '10500', null), bar('2026-08-18', '1')],
    });

    expect(result).toEqual({ kind: 'SKIPPED', reason: 'ENTRY_OPEN_MISSING' });
  });

  it('진입가가 0이면 나눗셈 대신 사유를 남긴다', () => {
    const result = scoreScreeningItem({
      horizonDays: 1,
      barsAfterAsOf: [bar('2026-08-14', '10500', '0'), bar('2026-08-18', '1')],
    });

    expect(result).toEqual({
      kind: 'SKIPPED',
      reason: 'ENTRY_PRICE_NOT_POSITIVE',
    });
  });

  it('하락도 부호 그대로 낸다', () => {
    const result = scoreScreeningItem({
      horizonDays: 1,
      barsAfterAsOf: [
        bar('2026-08-14', '9000', '10000'),
        bar('2026-08-18', '9000'),
      ],
    });

    expect(result).toMatchObject({
      kind: 'SCORED',
      outcome: { returnPct: '-10' },
    });
  });
});
