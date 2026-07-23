export type MarketCode = 'KOSPI' | 'KOSDAQ' | 'NASDAQ' | 'NYSE';

// Yahoo 심볼 접미사 ↔ 시장 코드. 접미사를 틀리면 조회가 실패하는 게 아니라
// 다른 종목의 가격이 돌아오므로(설계 §3.1) 매핑을 한 곳에서만 관리한다.
export const MARKET_SUFFIX: Record<
  Extract<MarketCode, 'KOSPI' | 'KOSDAQ'>,
  string
> = {
  KOSPI: '.KS',
  KOSDAQ: '.KQ',
};

export interface ResolvedInstrument {
  yahooSymbol: string;
  code: string;
  market: MarketCode;
  name: string;
  currency: string;
}

// 도메인은 Prisma 에 의존하지 않는다(CODE_RULES §2-1). 금액을 다루는 데 실제로
// 필요한 연산만 선언하고, Infrastructure 가 Prisma.Decimal 을 그대로 넘긴다.
// Prisma.Decimal 은 두 메서드를 모두 가지므로 구조적으로 이 타입을 만족한다.
// 판정은 toNumber() 로 퍼센트를 계산하고, 저장은 toString() 으로 정밀도를 보존한다.
export interface DecimalValue {
  toNumber(): number;
  toString(): string;
}

export interface DailyBar {
  tradeDate: Date;
  close: DecimalValue;
  adjClose: DecimalValue;
  volume: bigint;
  currency: string;
}
