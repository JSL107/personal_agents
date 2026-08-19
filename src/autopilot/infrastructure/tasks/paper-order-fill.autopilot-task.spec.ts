import {
  FillPendingOrdersResult,
  FillPendingOrdersUsecase,
  PaperOrderFillDetail,
} from '../../../paper-trading/application/fill-pending-orders.usecase';
import { PaperOrderFillAutopilotTask } from './paper-order-fill.autopilot-task';

const detail = (
  overrides: Partial<PaperOrderFillDetail> = {},
): PaperOrderFillDetail => ({
  accountName: 'LONG_TERM',
  tickerName: '코메론',
  tickerCode: '049430',
  side: 'BUY',
  outcome: 'FILLED',
  quantity: '71',
  price: '20550',
  reason: null,
  ...overrides,
});

const makeTask = (
  result: Partial<FillPendingOrdersResult>,
): PaperOrderFillAutopilotTask =>
  new PaperOrderFillAutopilotTask({
    execute: jest.fn().mockResolvedValue({
      window: 'TRADING',
      attempted: 0,
      filled: 0,
      expired: 0,
      lookupFailure: 0,
      notYetTraded: 0,
      details: [],
      bulkExpired: 0,
      ...result,
    }),
  } as unknown as FillPendingOrdersUsecase);

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-19' };

describe('PaperOrderFillAutopilotTask', () => {
  it('체결한 종목·수량·체결가·금액을 카드에 적는다', async () => {
    const task = makeTask({
      attempted: 2,
      filled: 2,
      details: [
        detail(),
        detail({
          accountName: 'SWING',
          tickerName: '아이진',
          tickerCode: '185490',
          side: 'SELL',
          quantity: '985',
          price: '1955',
        }),
      ],
    });

    const result = await task.run(context);

    expect(result.summaryText).toContain('매수 1건 146만 · 매도 1건 193만');
    expect(result.summaryText).toContain(
      ' • [장기] 매수 *코메론*(049430) 71주 @20,550원 = 146만',
    );
    expect(result.summaryText).toContain(
      ' • [스윙] 매도 *아이진*(185490) 985주 @1,955원 = 193만',
    );
  });

  it('체결되지 않은 주문은 사유와 함께 남긴다', async () => {
    const task = makeTask({
      attempted: 3,
      expired: 1,
      lookupFailure: 1,
      notYetTraded: 1,
      details: [
        detail({ outcome: 'EXPIRED', price: null, reason: '현금 부족' }),
        detail({ outcome: 'LOOKUP_FAILURE', price: null }),
        detail({ outcome: 'NOT_YET_TRADED', price: null }),
      ],
    });

    const result = await task.run(context);

    expect(result.summaryText).toContain(
      '체결 0건, 대기 주문 3건은 아래 사유로 처리 못 함',
    );
    expect(result.summaryText).toContain(
      ' • 미체결 [장기] 매수 *코메론*(049430) 71주 — 현금 부족(주문 취소됨)',
    );
    expect(result.summaryText).toContain('시세를 못 받음(다음 회차 재시도)');
    expect(result.summaryText).toContain(
      '당일 거래 기록이 아직 없음(다음 회차 재시도)',
    );
  });

  it('종목 단위로 식별할 수 없는 일괄 만료는 건수와 뜻을 함께 적는다', async () => {
    const task = makeTask({ attempted: 2, expired: 2, bulkExpired: 2 });

    const result = await task.run(context);

    expect(result.summaryText).toContain(
      ' • 장 마감까지 체결가를 못 받아 만료 2건 — 주문은 사라지고 다음 추천을 기다립니다',
    );
  });

  it('집계 어디에도 안 잡힌 주문이 있으면 빈 사유 대신 이미 처리됨을 알린다', async () => {
    const task = makeTask({ attempted: 2 });

    const result = await task.run(context);

    expect(result.summaryText).toContain(
      ' • 대기 주문 2건은 이미 다른 회차에서 처리돼 이번 회차엔 바뀐 것이 없습니다',
    );
  });

  it('체결이 섞인 회차에서도 상세에 없는 주문을 빠뜨리지 않는다', async () => {
    // 겹친 실행으로 3건 중 1건이 이미 처리돼 상세가 2건만 남은 회차.
    const task = makeTask({
      attempted: 3,
      filled: 2,
      details: [detail(), detail({ tickerCode: '000660', side: 'SELL' })],
    });

    const result = await task.run(context);

    expect(result.summaryText).toContain(
      ' • 대기 주문 1건은 이미 다른 회차에서 처리돼 이번 회차엔 바뀐 것이 없습니다',
    );
  });

  it('종목별 만료와 식별 불가 일괄 만료를 한 카드에서 구분해 적는다', async () => {
    const task = makeTask({
      attempted: 3,
      filled: 1,
      expired: 2,
      bulkExpired: 1,
      details: [
        detail(),
        detail({
          tickerName: '아이진',
          tickerCode: '185490',
          outcome: 'EXPIRED',
          price: null,
          reason: '체결가 조회 실패',
        }),
      ],
    });

    const result = await task.run(context);

    expect(result.summaryText).toContain(
      ' • 미체결 [장기] 매수 *아이진*(185490) 71주 — 체결가 조회 실패(주문 취소됨)',
    );
    expect(result.summaryText).toContain(
      ' • 장 마감까지 체결가를 못 받아 만료 1건 — 주문은 사라지고 다음 추천을 기다립니다',
    );
    // 같은 카드가 "재시도" 와 "주문 소멸" 을 동시에 말하면 안 된다.
    expect(result.summaryText).not.toContain('다음 회차 재시도');
  });

  it('대기 주문이 없는 회차를 사유 없는 0건과 구분한다', async () => {
    const task = makeTask({});

    const result = await task.run(context);

    expect(result.summaryText).toBe(
      '*모의투자 체결* — 대기 중인 주문이 없어 체결 0건',
    );
  });

  it('체결 시간 창 밖 회차를 일반 0건 실행과 구분해 skip한다', async () => {
    const task = makeTask({ window: 'BEFORE_OPEN' });

    await expect(task.run(context)).resolves.toEqual({
      skip: true,
      summaryText: '모의투자 체결 시간 창 이전 — 주문 미처리',
    });
  });
});
