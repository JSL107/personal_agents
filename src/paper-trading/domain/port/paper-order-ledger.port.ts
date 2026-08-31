import { MoneyValue } from '../../../market-data/domain/market-data.type';
import { TradeSide, TradeStrategy } from '../paper-account.type';

export const PAPER_ORDER_LEDGER_PORT = Symbol('PAPER_ORDER_LEDGER_PORT');

export interface PaperAccountRecord {
  id: number;
  seedAmount: MoneyValue;
  cashBalance: MoneyValue;
  // 지급일이 아직 오지 않은 배당. cashBalance 에 이미 들어 있지만 쓸 수 없는 돈이라
  // 매수 여력에서 뺀다. 기업행동 원장이 없는 구현(백테스트 인메모리 장부)은 채우지
  // 않으며, 그 경우 차감이 0 이라 기존 판정이 그대로 유지된다.
  pendingDividendCash?: MoneyValue;
}

export interface PaperPositionRecord {
  id: number;
  accountId: number;
  tickerId: number;
  quantity: MoneyValue;
  avgPrice: MoneyValue;
}

export interface ApplyTradeMutation {
  fee: string;
  tax: string;
  realizedPnl: string | null;
  cashBalance: string;
  positionQuantity: string;
  positionAvgPrice: string;
}

export type PendingOrderFillDecision =
  | { status: 'EXPIRED'; statusReason: string }
  | ({ status: 'FILLED'; quantity: string } & ApplyTradeMutation);

export type PendingOrderFillResult =
  | PendingOrderFillDecision
  | { status: 'ALREADY_PROCESSED' };

export interface FillPendingOrderInput {
  orderId: number;
  accountId: number;
  tickerId: number;
  side: TradeSide;
  strategy: Exclude<TradeStrategy, 'MANUAL'>;
  price: string;
  tradeDate: Date;
  decide: (state: {
    account: PaperAccountRecord;
    position: PaperPositionRecord | null;
  }) => PendingOrderFillDecision;
}

// 체결 원장 — 대기 주문 하나를 "잠그고, 결정을 받고, 반영한다".
//
// 체결 규칙(수량 축소·만료 판정·수수료·평단)은 여기 없다. 그것은 `decide` 콜백을 넘기는
// ExecutePaperOrderUsecase 한 곳에만 있고, 이 포트는 그 결정을 어디에 적을지만 고른다.
// 그래서 구현이 몇 개로 늘어나도 "무엇을 체결로 치는가" 는 갈리지 않는다.
//
// 구현 둘: 운영·모의는 PaperTradingPrismaRepository(트랜잭션 + DB 장부), 백테스트는
// InMemoryPaperLedger(메모리). 예전에는 후자를 리포지토리로 캐스팅해 끼워 넣었고, 대역이
// 어떤 메서드를 갖춰야 하는지는 주석에만 적혀 있었다 — 컴파일러가 보게 옮긴 자리가 이 포트다.
export interface PaperOrderLedgerPort {
  fillPendingOrderAtomically(
    input: FillPendingOrderInput,
  ): Promise<PendingOrderFillResult>;
}
