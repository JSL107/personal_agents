import { Prisma } from '@prisma/client';

import {
  buildHoldingChangeFingerprint,
  detectHoldingChanges,
  HoldingPosition,
} from './holding-change';

const createPosition = (
  overrides: Partial<HoldingPosition> = {},
): HoldingPosition => ({
  tickerId: 11,
  tickerName: 'KODEX 미국AI테크TOP10타겟커버드콜',
  symbol: '498400',
  quantity: new Prisma.Decimal('50'),
  avgPrice: new Prisma.Decimal('11044.7'),
  currency: 'KRW',
  ...overrides,
});

describe('detectHoldingChanges', () => {
  it('직전 스냅샷에 없던 종목을 신규 매수로 잡는다', () => {
    const changes = detectHoldingChanges([], [createPosition()]);

    expect(changes).toEqual([
      {
        tickerId: 11,
        tickerName: 'KODEX 미국AI테크TOP10타겟커버드콜',
        symbol: '498400',
        kind: 'BOUGHT',
        previousQuantity: null,
        quantity: '50',
        previousAvgPrice: null,
        avgPrice: '11044.7',
        currency: 'KRW',
      },
    ]);
  });

  it('브로커 응답에서 사라진 종목을 전량 매도로 잡고 평단은 직전 값을 유지한다', () => {
    const changes = detectHoldingChanges([createPosition()], []);

    expect(changes).toEqual([
      {
        tickerId: 11,
        tickerName: 'KODEX 미국AI테크TOP10타겟커버드콜',
        symbol: '498400',
        kind: 'SOLD_ALL',
        previousQuantity: '50',
        quantity: '0',
        previousAvgPrice: '11044.7',
        avgPrice: '11044.7',
        currency: 'KRW',
      },
    ]);
  });

  it('브로커가 수량 0 으로 실어 보낸 종목도 전량 매도로 잡는다', () => {
    const changes = detectHoldingChanges(
      [createPosition()],
      [createPosition({ quantity: new Prisma.Decimal('0') })],
    );

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('SOLD_ALL');
    expect(changes[0].quantity).toBe('0');
  });

  it('수량이 늘면 추가 매수로 잡고 평단 변화를 함께 담는다', () => {
    const changes = detectHoldingChanges(
      [createPosition()],
      [
        createPosition({
          quantity: new Prisma.Decimal('80'),
          avgPrice: new Prisma.Decimal('10800'),
        }),
      ],
    );

    expect(changes).toEqual([
      expect.objectContaining({
        kind: 'INCREASED',
        previousQuantity: '50',
        quantity: '80',
        previousAvgPrice: '11044.7',
        avgPrice: '10800',
      }),
    ]);
  });

  it('수량이 줄면 일부 매도로 잡는다', () => {
    const changes = detectHoldingChanges(
      [createPosition({ quantity: new Prisma.Decimal('80') })],
      [createPosition({ quantity: new Prisma.Decimal('50') })],
    );

    expect(changes).toEqual([
      expect.objectContaining({
        kind: 'DECREASED',
        previousQuantity: '80',
        quantity: '50',
      }),
    ]);
  });

  it('수량이 같고 평단만 움직이면 평단 변동으로 잡는다', () => {
    const changes = detectHoldingChanges(
      [createPosition()],
      [createPosition({ avgPrice: new Prisma.Decimal('10800') })],
    );

    expect(changes).toEqual([
      expect.objectContaining({
        kind: 'AVG_PRICE_CHANGED',
        previousQuantity: '50',
        quantity: '50',
        previousAvgPrice: '11044.7',
        avgPrice: '10800',
      }),
    ]);
  });

  it('수량과 평단이 그대로면 아무 사건도 만들지 않는다', () => {
    expect(
      detectHoldingChanges([createPosition()], [createPosition()]),
    ).toEqual([]);
  });

  // 저장 정밀도(Decimal(18,4)) 밖 자릿수로는 발화하지 않는다. 이 가드가 없으면 브로커가
  // 5자리 이상 평단을 주는 순간 아무 매매가 없어도 매일 AVG_PRICE_CHANGED 가 적재된다.
  it('저장 정밀도 밖 자릿수 차이는 변화로 보지 않는다', () => {
    const changes = detectHoldingChanges(
      [createPosition({ avgPrice: new Prisma.Decimal('11044.7000') })],
      [createPosition({ avgPrice: new Prisma.Decimal('11044.70004') })],
    );

    expect(changes).toEqual([]);
  });

  it('저장 정밀도 안(넷째 자리) 차이는 변화로 잡는다', () => {
    const changes = detectHoldingChanges(
      [createPosition({ avgPrice: new Prisma.Decimal('11044.7000') })],
      [createPosition({ avgPrice: new Prisma.Decimal('11044.7001') })],
    );

    expect(changes).toEqual([
      expect.objectContaining({ kind: 'AVG_PRICE_CHANGED' }),
    ]);
  });

  it('소수 수량(해외 소수점 매수)도 증감으로 잡는다', () => {
    const changes = detectHoldingChanges(
      [
        createPosition({
          tickerId: 21,
          symbol: 'PFE',
          currency: 'USD',
          quantity: new Prisma.Decimal('62.0845'),
          avgPrice: new Prisma.Decimal('26.8245'),
        }),
      ],
      [
        createPosition({
          tickerId: 21,
          symbol: 'PFE',
          currency: 'USD',
          quantity: new Prisma.Decimal('70.1234'),
          avgPrice: new Prisma.Decimal('26.9'),
        }),
      ],
    );

    expect(changes).toEqual([
      expect.objectContaining({
        kind: 'INCREASED',
        previousQuantity: '62.0845',
        quantity: '70.1234',
      }),
    ]);
  });

  // 시장을 섞어 넣어도 전부 반환해야 한다. 국내 감시와 미국 감시 사이에 일어난 매매는
  // 다음 감시의 비교 구간에만 나타나므로, 시장으로 걸러내면 그 매매가 영구히 사라진다.
  it('국내·미국 종목을 시장으로 걸러내지 않고 모두 반환한다', () => {
    const changes = detectHoldingChanges(
      [
        createPosition({ tickerId: 11, currency: 'KRW' }),
        createPosition({
          tickerId: 21,
          symbol: 'PFE',
          tickerName: '화이자',
          currency: 'USD',
          quantity: new Prisma.Decimal('62.0845'),
          avgPrice: new Prisma.Decimal('26.8245'),
        }),
      ],
      [
        createPosition({
          tickerId: 11,
          currency: 'KRW',
          quantity: new Prisma.Decimal('80'),
        }),
        createPosition({
          tickerId: 21,
          symbol: 'PFE',
          tickerName: '화이자',
          currency: 'USD',
          quantity: new Prisma.Decimal('70'),
          avgPrice: new Prisma.Decimal('26.8245'),
        }),
      ],
    );

    expect(changes.map((change) => [change.symbol, change.kind])).toEqual([
      ['498400', 'INCREASED'],
      ['PFE', 'INCREASED'],
    ]);
  });

  it('한 번 반영된 뒤 같은 잔고로 다시 비교하면 중복 사건이 생기지 않는다', () => {
    const afterSync = [createPosition({ quantity: new Prisma.Decimal('80') })];

    expect(detectHoldingChanges([createPosition()], afterSync)).toHaveLength(1);
    expect(detectHoldingChanges(afterSync, afterSync)).toEqual([]);
  });

  it('저장 정밀도 다섯째 자리는 DB 와 같은 방향(half-up)으로 반올림한다', () => {
    const changes = detectHoldingChanges(
      [createPosition({ avgPrice: new Prisma.Decimal('11044.7000') })],
      [createPosition({ avgPrice: new Prisma.Decimal('11044.70005') })],
    );

    expect(changes).toEqual([
      expect.objectContaining({
        kind: 'AVG_PRICE_CHANGED',
        avgPrice: '11044.7001',
      }),
    ]);
  });

  // toNumber() 로 비교하면 두 값이 같은 double 로 뭉개져(1e14 부근 double 간격은 0.015625)
  // 실제 수량 변화가 조용히 누락된다. Decimal(18,4) 가 허용하는 값이므로 경계를 남기지 않는다.
  it('안전 정수 범위를 넘는 값도 넷째 자리 차이를 구분한다', () => {
    const previous = new Prisma.Decimal('99999999999999.9998');
    const current = new Prisma.Decimal('99999999999999.9999');
    expect(previous.toNumber() * 10_000).toBe(current.toNumber() * 10_000);

    const changes = detectHoldingChanges(
      [createPosition({ quantity: previous })],
      [createPosition({ quantity: current })],
    );

    expect(changes).toEqual([
      expect.objectContaining({
        kind: 'INCREASED',
        previousQuantity: '99999999999999.9998',
        quantity: '99999999999999.9999',
      }),
    ]);
  });
});

describe('buildHoldingChangeFingerprint', () => {
  const effectiveDate = new Date('2026-08-06T00:00:00.000Z');
  const [change] = detectHoldingChanges(
    [createPosition()],
    [createPosition({ quantity: new Prisma.Decimal('80') })],
  );

  it('같은 사건은 같은 지문이 된다', () => {
    const [again] = detectHoldingChanges(
      [createPosition()],
      [createPosition({ quantity: new Prisma.Decimal('80') })],
    );

    expect(buildHoldingChangeFingerprint({ change, effectiveDate })).toBe(
      buildHoldingChangeFingerprint({ change: again, effectiveDate }),
    );
  });

  // 겹친 두 실행은 브로커를 각각 호출하므로 원본 정밀도가 다를 수 있다. 지문이 그것 때문에
  // 갈리면 중복 차단이 정작 필요한 순간에 무력해진다.
  it('브로커 원본 정밀도가 달라도 저장 정밀도가 같으면 같은 지문이 된다', () => {
    const [noisy] = detectHoldingChanges(
      [createPosition({ avgPrice: new Prisma.Decimal('11044.70001') })],
      [
        createPosition({
          quantity: new Prisma.Decimal('80.00002'),
          avgPrice: new Prisma.Decimal('11044.699996'),
        }),
      ],
    );

    expect(
      buildHoldingChangeFingerprint({ change: noisy, effectiveDate }),
    ).toBe(buildHoldingChangeFingerprint({ change, effectiveDate }));
  });

  // 하루에 두 번 변한 종목이 중복으로 오인돼 사라지면 안 된다.
  it('같은 날 같은 종목의 두 번째 매매는 다른 지문이 된다', () => {
    const [second] = detectHoldingChanges(
      [createPosition({ quantity: new Prisma.Decimal('80') })],
      [createPosition({ quantity: new Prisma.Decimal('120') })],
    );

    expect(
      buildHoldingChangeFingerprint({ change: second, effectiveDate }),
    ).not.toBe(buildHoldingChangeFingerprint({ change, effectiveDate }));
  });

  it('날짜가 다르면 같은 수량 변화라도 다른 지문이 된다', () => {
    expect(
      buildHoldingChangeFingerprint({
        change,
        effectiveDate: new Date('2026-08-07T00:00:00.000Z'),
      }),
    ).not.toBe(buildHoldingChangeFingerprint({ change, effectiveDate }));
  });
});
