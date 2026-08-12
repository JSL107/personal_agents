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

// 기존 DecimalValue 를 확장한다. Prisma.Decimal 이 구조적으로 만족하므로
// 도메인이 Prisma 를 import 하지 않고도 금액 산술을 할 수 있다(CODE_RULES §2-1).
export interface MoneyValue extends DecimalValue {
  plus(other: MoneyValue | string | number): MoneyValue;
  minus(other: MoneyValue | string | number): MoneyValue;
  times(other: MoneyValue | string | number): MoneyValue;
  dividedBy(other: MoneyValue | string | number): MoneyValue;
  isZero(): boolean;
  isNegative(): boolean;
  comparedTo(other: MoneyValue | string | number): number;
}

export interface DailyBar {
  tradeDate: Date;
  close: DecimalValue;
  adjClose: DecimalValue;
  volume: bigint;
  currency: string;
  // 토스 /candles 는 openPrice·highPrice·lowPrice 를 준다(실측: 2026-08-06 설계 문서).
  // optional 인 이유는 매퍼가 캔들 하나만 실패해도 응답 전체를 버리기 때문이다 —
  // 필수로 올리면 이 필드가 없는 응답에서 종목 전체 조회가 실패한다.
  open?: DecimalValue;
  high?: DecimalValue;
  low?: DecimalValue;
}

// 저장된 일봉을 계산용 숫자로 편 형태. 공급자 응답인 DailyBar 와 달리
// 지표 계산만을 위한 것이라 Decimal 정밀도를 버리고 number 를 쓴다 —
// 이동평균·수익률은 소수 넷째 자리 정밀도가 결과를 바꾸지 않는다.
export interface DailySeriesPoint {
  tradeDate: string;
  // 원본 체결가. 거래대금(유동성) 판정과 화면 표시에 쓴다.
  close: number;
  // 분할·배당 조정가. 추세 지표는 전부 이 값으로 계산한다.
  adjClose: number;
  volume: number;
}
