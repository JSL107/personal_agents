# 가상 시드 모의투자 1단계 구현 계획

> **For agentic workers:** 이 계획은 태스크 단위로 실행한다. 각 태스크는 독립적으로 테스트 가능한 산출물로 끝나며, 태스크 종료 시 `pnpm lint:check && pnpm exec jest <해당 경로> && pnpm build` 를 통과해야 한다.

**Goal:** 가상 시드로 기록한 포지션을 토스증권 시세로 매일 장 마감 후 평가해 Slack에 손익 표와 수익률을 보고한다.

**Architecture:** `src/paper-trading/` 을 hexagonal 3층(domain/application/infrastructure)으로 신설한다. 도메인은 순수 계산(비용·원가·평가·불변식)만 담고, application 이 단일 트랜잭션으로 상태를 바꾸며, autopilot task 가 매일 17:40 에 평가를 트리거한다. 실계좌 경로(`Holding`, `sync-holdings`)와 `DailyPrice` 는 읽지도 쓰지도 않는다.

**Tech Stack:** NestJS 10, Prisma 6 (PostgreSQL@5434), pnpm 9.15.9, jest, BullMQ(autopilot), Slack Bolt 4

**설계 원본:** `docs/superpowers/specs/2026-08-11-paper-trading-toss-design.md` — 이 계획과 스펙이 어긋나면 스펙이 정본이다.

## Global Constraints

- 패키지 매니저는 `pnpm` 고정. `npm`/`yarn` 금지.
- ORM 은 Prisma 만. TypeORM import 금지.
- `process.env` 직접 참조 금지 → `ConfigService.get(...)`. `scripts/` 도 Nest DI 컨텍스트를 쓰므로 동일 적용.
- Prisma enum 금지 — 상태값은 `String` + 도메인 파싱 가드.
- 전 Prisma 모델에 snake_case `@@map`, 관계 양방향 선언, `createdAt`, 시계열 `@@index`.
- 변수명 줄임말 금지(`err`→`error`, `repo`→`repository`), `if` 단일 라인도 중괄호, try 블록 안 `return await`, 인라인 반환 타입 금지(별도 interface 추출).
- 파일명 kebab-case + role suffix. 도메인 순수 함수 파일은 suffix 없음(`trade-cost.ts`).
- 도메인은 Prisma 를 import 하지 않는다. 금액은 `MoneyValue` 구조적 인터페이스로 받는다(Task 3).
- DB 변경은 `pnpm db:push` (마이그레이션 파일 없음). push 후 `pnpm prisma:generate` 필수.
- 테스트 실행은 `pnpm exec jest <경로>` — `pnpm test -- <경로>` 는 2단계 실행 구조 때문에 필터가 먹지 않는다.
- 커밋은 `<type>(<scope>): <subject>` 한국어 허용. 태스크 단위 atomic commit.

## 이 계획의 범위 밖

- 자산 곡선 PNG 와 `SlackNotifierPort` 파일 업로드 확장 → 별도 PR(스펙 §6 "Slack 이미지 전달 경로"). 이번 리포트는 **텍스트 표까지만**.
- LLM 자동 매매 판단 → 3단계.
- 미국 주식, 배당·분할 정식 처리, 지정가 주문, 입출금.

---

## File Structure

### 신규

| 파일 | 책임 |
|---|---|
| `src/paper-trading/domain/paper-account.type.ts` | 상태값 union 타입, 파싱 가드, 계산 입출력 interface |
| `src/paper-trading/domain/trade-cost.ts` | 시장별·방향별 수수료·세금 계산, 원 단위 절사 |
| `src/paper-trading/domain/position-cost.ts` | 평균원가 갱신, 실현손익 |
| `src/paper-trading/domain/paper-valuation.ts` | 포지션·계좌 평가액, 수익률 |
| `src/paper-trading/domain/paper-invariant.ts` | 현금·수량·평가액 불변식 검증 |
| `src/paper-trading/domain/corporate-action-guard.ts` | 비정상 가격 점프 감지 |
| `src/paper-trading/infrastructure/paper-trading.repository.ts` | Prisma 접근(`PrismaService` 직접 주입 — `stock-monitor.repository.ts` 선례) |
| `src/paper-trading/infrastructure/paper-trading.formatter.ts` | Slack mrkdwn 손익 표 |
| `src/paper-trading/application/record-paper-trade.usecase.ts` | 주문 생성·체결, 포지션·현금 갱신(단일 트랜잭션) |
| `src/paper-trading/application/evaluate-paper-account.usecase.ts` | 평가 → 스냅샷 적재 |
| `src/paper-trading/paper-trading.module.ts` | DI 등록 |
| `src/autopilot/infrastructure/tasks/paper-trading.autopilot-task.ts` | 매일 17:40 실행 진입점 |
| `scripts/paper-trade.ts` | 수동 매매 입력 CLI(얇은 인자 파서) |

### 수정

| 파일 | 무엇을 |
|---|---|
| `prisma/schema.prisma` | 모델 6개 추가 + `Ticker`·`AgentRun` back-relation |
| `src/market-data/domain/market-data.type.ts` | `DailyBar` 에 `open`/`high`/`low` optional 추가, `MoneyValue` 정의 |
| `src/market-data/domain/port/market-data.port.ts` | `fetchDailyBars` 3번째 optional 인자 |
| `src/market-data/infrastructure/toss/toss-market-data.mapper.ts` | OHL optional 파싱 |
| `src/market-data/infrastructure/toss/toss-market-data.client.ts` | `adjusted` 파라미터화(기본 `true` 유지) |
| `src/market-data/infrastructure/yahoo-finance.market-data.client.ts` | 포트 시그니처 정합 |
| `src/model-router/domain/model-router.type.ts` | `AgentType.PAPER_TRADE` |
| `src/model-router/domain/agent-provider.map.ts` | `PAPER_TRADE` 매핑 |
| `src/agent-registry/agent-registry.ts` | 레지스트리 항목 |
| `src/agent-registry/agent-contract.ts` | 계약 항목 |
| `src/agent-run/domain/agent-run.type.ts` | `TriggerType.AUTOPILOT_PAPER_TRADING_CRON` |
| `src/autopilot/domain/autopilot.playbook-defaults.ts` | cron·timezone 상수 |
| `src/autopilot/domain/autopilot.playbook.ts` | standalone `PlaybookEntry` |
| `src/autopilot/autopilot.module.ts` | imports + providers + `AUTOPILOT_TASKS` factory 인자·inject 양쪽 |
| `src/app.module.ts` | `PaperTradingModule` |
| `.env.example`, `src/config/app.config.ts`, `README.md` | env 3개 |

---

## Task 1: 시세 확장 — OHL 필드와 조정 여부 옵션

기존 매퍼는 `closePrice` 만 읽고 시가·고가·저가를 버리며, `adjusted: 'true'` 가 하드코딩돼 있다. 모의투자는 **미조정 실제 가격**으로 장부를 써야 하고(스펙 §5-(1)), 체결가 계산에 시가가 필요하다.

**Files:**
- Modify: `src/market-data/domain/market-data.type.ts`
- Modify: `src/market-data/domain/port/market-data.port.ts`
- Modify: `src/market-data/infrastructure/toss/toss-market-data.mapper.ts`
- Modify: `src/market-data/infrastructure/toss/toss-market-data.client.ts`
- Modify: `src/market-data/infrastructure/yahoo-finance.market-data.client.ts`
- Test: 위 3개의 기존 `.spec.ts`

**Interfaces (Produces):**

```ts
// market-data.type.ts — 기존 DecimalValue 를 확장한다. Prisma.Decimal 이 구조적으로 만족하므로
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

// market-data.port.ts
export interface FetchDailyBarsOptions {
  // false 면 배당·분할이 반영되지 않은 실제 거래 가격. 모의투자 장부·체결이 이것을 쓴다.
  // 생략 시 true — 기존 주가 감시 호출자의 동작을 바꾸지 않는다.
  adjusted?: boolean;
}

export interface MarketDataPort {
  fetchDailyBars(symbol: string, days: number, options?: FetchDailyBarsOptions): Promise<DailyBar[]>;
  fetchUsdKrwRate(): Promise<string | null>;
}
```

- [ ] **Step 1: 매퍼 테스트 추가 (실패 확인용)**

`toss-market-data.mapper.spec.ts` 에 3케이스 추가.

```ts
it('openPrice·highPrice·lowPrice 를 DailyBar 에 담는다', () => {
  const bars = mapTossCandlesResponse({
    result: { candles: [{ timestamp: '2026-08-10T00:00:00+09:00', openPrice: '12300',
      highPrice: '12400', lowPrice: '12250', closePrice: '12360', volume: '955', currency: 'KRW' }] },
  });
  expect(bars).not.toBeNull();
  expect(bars?.[0].open?.toString()).toBe('12300');
  expect(bars?.[0].high?.toString()).toBe('12400');
  expect(bars?.[0].low?.toString()).toBe('12250');
});

it('OHL 이 없어도 응답을 버리지 않는다 (close 만 있으면 유효)', () => {
  const bars = mapTossCandlesResponse({
    result: { candles: [{ timestamp: '2026-08-10T00:00:00+09:00',
      closePrice: '12360', volume: '955', currency: 'KRW' }] },
  });
  expect(bars).toHaveLength(1);
  expect(bars?.[0].open).toBeUndefined();
});

it('OHL 이 숫자로 파싱 불가하면 그 필드만 버리고 봉은 유지한다', () => {
  const bars = mapTossCandlesResponse({
    result: { candles: [{ timestamp: '2026-08-10T00:00:00+09:00', openPrice: 'N/A',
      closePrice: '12360', volume: '955', currency: 'KRW' }] },
  });
  expect(bars).toHaveLength(1);
  expect(bars?.[0].open).toBeUndefined();
});
```

- [ ] **Step 2: 실패 확인** — `pnpm exec jest src/market-data/infrastructure/toss/toss-market-data.mapper.spec.ts`

- [ ] **Step 3: `DailyBar` 와 `MoneyValue` 를 `market-data.type.ts` 에 추가** (위 Interfaces 블록 그대로)

- [ ] **Step 4: 매퍼 확장** — `closePrice` 파싱 로직을 재사용하는 optional 파서를 만들어 `openPrice`/`highPrice`/`lowPrice` 에 적용한다. 값이 없거나 `Prisma.Decimal` 생성이 실패하면 `undefined` 로 두고 **봉 자체는 유지**한다(기존 `close` 실패 시 전체 `null` 정책은 유지).

- [ ] **Step 5: 포트와 클라이언트에 `adjusted` 옵션 배선**

`toss-market-data.client.ts`:
```ts
async fetchDailyBars(symbol: string, days: number, options?: FetchDailyBarsOptions): Promise<DailyBar[]> {
  // ... 기존 가드·간격 로직 유지
  const adjusted = options?.adjusted ?? true;
  const query = new URLSearchParams({ symbol, interval: '1d', count: String(count), adjusted: String(adjusted) });
  // ...
}
```

기존 주석(`:33-38`, 조정가를 쓰는 이유와 441640 실측)은 **삭제하지 않고** 아래 문장을 덧붙인다: "모의투자 장부는 반대로 미조정 실제 가격이 필요해 `options.adjusted=false` 로 호출한다(스펙 §5-(1)). 기본값 `true` 는 기존 감시 호출자의 동작을 보존한다."

`yahoo-finance.market-data.client.ts` 는 세 번째 인자를 받아 무시한다(Yahoo 는 조정가만 제공). 그 사실을 주석으로 남긴다.

- [ ] **Step 6: 클라이언트 테스트 추가** — `adjusted` 미지정 시 쿼리에 `adjusted=true`, `{ adjusted: false }` 시 `adjusted=false` 가 실리는지 각각 단언.

- [ ] **Step 7: 전체 게이트** — `pnpm lint:check && pnpm exec jest src/market-data && pnpm build`

- [ ] **Step 8: 커밋** — `feat(market-data): 일봉에 시가·고가·저가와 조정 여부 옵션`

---

## Task 2: Prisma 스키마 — 가상 계좌 6모델

**Files:**
- Modify: `prisma/schema.prisma`

**⚠️ 실행 전 확인**: DB(PostgreSQL@5434)는 모든 worktree 가 공유한다. `db:push` 는 synchronize 방식이라, 다른 worktree 가 이후 구 스키마로 push 하면 이번에 만든 `paper_*` 테이블이 사라진다. push 직전에 다른 세션이 스키마를 만지는지 확인한다.

- [ ] **Step 1: 모델 6개 추가** — 스펙 §4 의 스키마 블록을 그대로 옮긴다. `PaperAccount` / `PaperOrder` / `PaperPosition` / `PaperTrade` / `PaperPositionSnapshot` / `PaperEquitySnapshot`.

- [ ] **Step 2: back-relation 추가**

```prisma
model Ticker {
  // ... 기존 필드 유지
  paperOrders            PaperOrder[]
  paperPositions         PaperPosition[]
  paperTrades            PaperTrade[]
  paperPositionSnapshots PaperPositionSnapshot[]
}

model AgentRun {
  // ... 기존 필드 유지
  paperOrders PaperOrder[]
}
```

- [ ] **Step 3: 포맷·적용·생성**

```bash
pnpm prisma format
pnpm db:push
pnpm prisma:generate
```

- [ ] **Step 4: 적용 확인** — 생성된 Prisma Client 타입으로 6모델이 잡히는지 `pnpm build` 로 확인.

- [ ] **Step 5: 커밋** — `feat(paper-trading): 가상 계좌·주문·원장·스냅샷 스키마`

---

## Task 3: 도메인 순수 계산

이 태스크의 산출물은 전부 순수 함수다. DB·네트워크·`ConfigService` 를 쓰지 않는다.

**Files:**
- Create: `src/paper-trading/domain/paper-account.type.ts`
- Create: `src/paper-trading/domain/trade-cost.ts` + `trade-cost.spec.ts`
- Create: `src/paper-trading/domain/position-cost.ts` + `position-cost.spec.ts`
- Create: `src/paper-trading/domain/paper-valuation.ts` + `paper-valuation.spec.ts`
- Create: `src/paper-trading/domain/paper-invariant.ts` + `paper-invariant.spec.ts`
- Create: `src/paper-trading/domain/corporate-action-guard.ts` + `corporate-action-guard.spec.ts`

**Interfaces (Produces):**

```ts
// paper-account.type.ts
import { MoneyValue } from '../../market-data/domain/market-data.type';

export type TradeSide = 'BUY' | 'SELL';
export type TradeStrategy = 'LONG_TERM' | 'SWING' | 'MANUAL';
export type OrderStatus = 'PENDING' | 'FILLED' | 'PARTIALLY_FILLED' | 'EXPIRED' | 'CANCELLED';
export type PaperMarket = 'KOSPI' | 'KOSDAQ' | 'KONEX';

export const parseTradeSide = (value: string): TradeSide => { /* 대문자 비교, 불일치 시 throw */ };
export const parseTradeStrategy = (value: string): TradeStrategy => { /* 동일 */ };
export const parsePaperMarket = (value: string): PaperMarket => { /* 동일 */ };
// 국내 주식은 정수 주 단위다. 소수 수량은 존재할 수 없는 체결이므로 입구에서 막는다.
export const assertWholeShares = (quantity: MoneyValue): void => { /* 정수 아니면 throw */ };

export interface TradeCostInput {
  market: PaperMarket;
  side: TradeSide;
  grossAmount: MoneyValue;   // 수량 × 단가
  tradeDate: Date;           // 요율 적용일자 조회용
}
export interface TradeCost {
  fee: string;   // 원 단위 절사된 정수 문자열
  tax: string;
}

export interface PositionState {
  quantity: MoneyValue;
  avgPrice: MoneyValue;
}
export interface BuyOutcome {
  quantity: string;
  avgPrice: string;
}
export interface SellOutcome {
  quantity: string;
  avgPrice: string;
  realizedPnl: string;
}

export interface PositionValuationInput {
  tickerId: number;
  quantity: MoneyValue;
  avgPrice: MoneyValue;
  price: MoneyValue;
  priceDate: Date;
}
export interface PositionValuation {
  tickerId: number;
  marketValue: string;
  costBasis: string;
  unrealizedPnl: string;
  returnRate: string;
  isStale: boolean;
}
export interface AccountValuationInput {
  seedAmount: MoneyValue;
  cashBalance: MoneyValue;
  tradeDate: Date;
  positions: PositionValuationInput[];
}
export interface AccountValuation {
  positions: PositionValuation[];
  positionValue: string;
  totalValue: string;
  returnRate: string;
  staleTickerCount: number;
}
```

- [ ] **Step 1: 비용 계산 테스트 먼저 작성** (`trade-cost.spec.ts`)

케이스: ① KOSPI 매수는 수수료만·세금 0, ② KOSPI 매도는 수수료 + 거래세, ③ KOSDAQ 매도 세율이 KOSPI 와 다름, ④ 계산 결과가 **원 단위 정수**(소수 원이 남지 않음), ⑤ 금액 0 이면 비용 0.

```ts
it('매수에는 거래세가 붙지 않는다', () => {
  const cost = calculateTradeCost({ market: 'KOSPI', side: 'BUY',
    grossAmount: new Prisma.Decimal('1000000'), tradeDate: new Date('2026-08-11') });
  expect(cost.tax).toBe('0');
  expect(Number(cost.fee)).toBeGreaterThan(0);
});

it('비용은 원 단위 정수로 절사된다', () => {
  const cost = calculateTradeCost({ market: 'KOSPI', side: 'SELL',
    grossAmount: new Prisma.Decimal('12345'), tradeDate: new Date('2026-08-11') });
  expect(cost.fee).toMatch(/^\d+$/u);
  expect(cost.tax).toMatch(/^\d+$/u);
});
```

- [ ] **Step 2: 실패 확인** — `pnpm exec jest src/paper-trading/domain/trade-cost.spec.ts`

- [ ] **Step 3: `trade-cost.ts` 구현**

요율표는 파일 상단 상수로 둔다. **적용일자별 배열**로 만들어 요율 개정 시 과거 거래 재계산이 틀리지 않게 한다.

```ts
interface CostSchedule {
  effectiveFrom: string;                    // 'YYYY-MM-DD'
  brokerageFeeRate: string;                 // 매수·매도 공통 위탁수수료
  transactionTaxRate: Record<PaperMarket, string>;  // 매도 시 증권거래세(농특세 포함 총율)
}
// 실제 요율은 구현 시점 공식 자료로 확인해 채운다. 확인 전에는 이 표에 값을 넣지 않고
// 테스트가 요구하는 관계(매수 tax=0, 시장별 tax 상이, 원 단위 절사)만 만족시키지 않는다 —
// 즉 요율 확인이 이 태스크의 선행 조건이다.
```

- [ ] **Step 4: 통과 확인** 후 원가 계산으로 이동.

- [ ] **Step 5: 원가 테스트 작성** (`position-cost.spec.ts`)

```ts
it('평균단가에 매수 수수료를 포함한다', () => {
  // 10주 @100, 수수료 10 → 장부원가 1010, avgPrice 101
  const outcome = applyBuy({ quantity: dec('0'), avgPrice: dec('0') },
    { quantity: dec('10'), price: dec('100'), fee: dec('10') });
  expect(outcome.avgPrice).toBe('101');
});

it('부분 매도 후 평균단가는 변하지 않는다', () => {
  const outcome = applySell({ quantity: dec('10'), avgPrice: dec('101') },
    { quantity: dec('4'), price: dec('120'), fee: dec('5'), tax: dec('9') });
  expect(outcome.quantity).toBe('6');
  expect(outcome.avgPrice).toBe('101');
});

it('실현손익은 매도 비용을 뺀 순액에서 원가를 뺀다', () => {
  // 4주 @120 = 480, 비용 14 → 순수취 466, 원가 4×101 = 404 → 실현 62
  const outcome = applySell({ quantity: dec('10'), avgPrice: dec('101') },
    { quantity: dec('4'), price: dec('120'), fee: dec('5'), tax: dec('9') });
  expect(outcome.realizedPnl).toBe('62');
});

it('보유 수량을 넘는 매도를 거부한다 (공매도 방지)', () => {
  expect(() => applySell({ quantity: dec('3'), avgPrice: dec('100') },
    { quantity: dec('4'), price: dec('120'), fee: dec('0'), tax: dec('0') })).toThrow();
});
```

- [ ] **Step 6~7: `position-cost.ts` 구현 → 통과 확인**

- [ ] **Step 8: 평가 테스트 작성** (`paper-valuation.spec.ts`)

케이스: ① 단일 포지션 평가액·수익률, ② 다중 포지션 합산, ③ `priceDate` 가 `tradeDate` 와 다르면 `isStale=true` 이고 `staleTickerCount` 에 반영, ④ 포지션 0건이면 `positionValue=0` 이고 `totalValue=cashBalance`, ⑤ 수익률은 시드 대비 백분율.

- [ ] **Step 9~10: `paper-valuation.ts` 구현 → 통과 확인**

- [ ] **Step 11: 불변식 테스트 작성** (`paper-invariant.spec.ts`)

```ts
export interface InvariantInput {
  seedAmount: MoneyValue;
  cashBalance: MoneyValue;
  trades: { side: TradeSide; quantity: MoneyValue; price: MoneyValue; fee: MoneyValue; tax: MoneyValue; tickerId: number }[];
  positions: { tickerId: number; quantity: MoneyValue }[];
}
export interface InvariantViolation {
  kind: 'CASH_MISMATCH' | 'QUANTITY_MISMATCH';
  detail: string;
}
export const verifyPaperInvariants = (input: InvariantInput): InvariantViolation[] => { /* ... */ };
```

케이스: ① 정합 상태에서 위반 0건, ② 현금이 1원 어긋나면 `CASH_MISMATCH`, ③ 포지션 수량이 거래 합과 다르면 `QUANTITY_MISMATCH`, ④ 거래가 0건이고 현금 == 시드면 위반 0건.

- [ ] **Step 12~13: 구현 → 통과 확인**

- [ ] **Step 14: 가격 점프 가드 테스트 작성** (`corporate-action-guard.spec.ts`)

배당·분할을 정식 처리하지 않는 1단계에서, 분할로 인한 가격 급변을 평가 손실로 기록하지 않게 막는 장치다.

```ts
export interface PriceJumpInput {
  tickerId: number;
  previousClose: MoneyValue;
  currentClose: MoneyValue;
}
export interface PriceJumpSuspicion {
  tickerId: number;
  ratio: string;          // currentClose / previousClose
  suspectedRatio: string; // 가장 가까운 정수비 (예: '10' → 10:1 분할 의심)
}
export const detectSuspiciousPriceJump = (inputs: PriceJumpInput[]): PriceJumpSuspicion[] => { /* ... */ };
```

케이스: ① 10:1 분할(100000 → 10000)을 의심으로 잡는다, ② 정상 변동(-5%)은 잡지 않는다, ③ 하루 -35% 급락도 정수비에서 멀면 잡지 않는다(실제 폭락과 분할을 구분), ④ 5:1(50000 → 10000)도 잡는다, ⑤ 이전 종가가 0 이면 판정하지 않는다(0 나눗셈 방지).

- [ ] **Step 15~16: 구현 → 통과 확인**

- [ ] **Step 17: 게이트** — `pnpm lint:check && pnpm exec jest src/paper-trading && pnpm build`

- [ ] **Step 18: 커밋** — `feat(paper-trading): 비용·원가·평가·불변식 도메인 계산`

---

## Task 4: 저장소와 usecase

**Files:**
- Create: `src/paper-trading/infrastructure/paper-trading.repository.ts`
- Create: `src/paper-trading/application/record-paper-trade.usecase.ts` + `.spec.ts`
- Create: `src/paper-trading/application/evaluate-paper-account.usecase.ts` + `.spec.ts`
- Create: `src/paper-trading/paper-trading.module.ts`

**Interfaces (Consumes):** Task 1 의 `MarketDataPort.fetchDailyBars(symbol, days, { adjusted: false })`, Task 3 의 전체 도메인 함수.

**Interfaces (Produces):**

```ts
// record-paper-trade.usecase.ts
export interface RecordTradeCommand {
  accountName: string;
  tickerCode: string;      // 6자리 종목코드
  tickerName?: string;     // Ticker 신규 생성 시 사용
  market: PaperMarket;
  side: TradeSide;
  quantity: string;
  price: string;
  tradeDate: string;       // 'YYYY-MM-DD'
  strategy: TradeStrategy;
  reason?: string;
}
export interface RecordTradeResult {
  tradeId: number;
  cashBalance: string;
  positionQuantity: string;
  positionAvgPrice: string;
  realizedPnl: string | null;
}

// evaluate-paper-account.usecase.ts
export interface EvaluateAccountCommand {
  accountName: string;
  executedAt: Date;
}
export interface EvaluateAccountResult {
  skipped: boolean;
  skipReason?: string;
  tradeDate: string | null;
  totalValue: string | null;
  returnRate: string | null;
  positionCount: number;
  staleTickerCount: number;
  invariantViolations: string[];
  suspiciousJumps: string[];
}
```

- [ ] **Step 1: 매매 기록 테스트 작성**

케이스:
① 매수 시 현금이 `대금 + 비용` 만큼 줄고 포지션이 생성된다
② 현금보다 큰 매수를 거부한다
③ 소수 수량을 거부한다(`assertWholeShares`)
④ 매도 시 현금이 `순수취` 만큼 늘고 `realizedPnl` 이 기록된다
⑤ 전량 매도 시 포지션 수량이 0 이 된다
⑥ 같은 `fingerprint` 로 두 번 기록하면 두 번째가 거부된다(멱등)
⑦ `tossSymbol` 이 없는 Ticker 는 생성 시 종목코드로 채운다

`fingerprint` 생성 규칙을 테스트로 못박는다 — `accountId:tickerId:tradeDate:side:quantity:price` 를 이어붙인 문자열. 같은 날 같은 종목을 같은 수량·단가로 두 번 사는 것은 실제로 가능하므로, 자동 매매(3단계)는 `orderId` 를 fingerprint 에 포함해 구분한다. 수동 CLI 는 중복 입력 방지가 목적이므로 이 규칙이 맞다.

- [ ] **Step 2: 실패 확인** — `pnpm exec jest src/paper-trading/application/record-paper-trade.usecase.spec.ts`

- [ ] **Step 3: repository 구현**

`PrismaService` 를 직접 주입한다(`stock-monitor.repository.ts` 선례 — 포트 추상화 대상이 없다). 필요한 메서드:

```ts
findAccountByName(name: string): Promise<PaperAccountRecord | null>
upsertKrTicker(input: { code: string; name: string; market: PaperMarket }): Promise<{ id: number }>
findPosition(accountId: number, tickerId: number): Promise<PaperPositionRecord | null>
findPositionsWithTicker(accountId: number): Promise<PaperPositionWithTicker[]>
// 거래·포지션·현금을 한 트랜잭션으로 쓴다. 하나라도 실패하면 전부 롤백된다.
applyTradeAtomically(input: ApplyTradeInput): Promise<{ tradeId: number }>
findTradesForInvariant(accountId: number): Promise<InvariantTradeRow[]>
upsertEquitySnapshot(input: UpsertSnapshotInput): Promise<{ snapshotId: number }>
findRecentSnapshots(accountId: number, limit: number): Promise<SnapshotRow[]>
findLatestSnapshotBefore(accountId: number, tradeDate: Date): Promise<SnapshotRow | null>
```

`Ticker` 조회·생성은 **`marketCountry='KR'` + `tossSymbol` 채움**을 강제한다(스펙 §3). 종목코드만으로 Ticker 를 찾을 때 `market` 이 `KOSPI`/`KOSDAQ` 인 기존 행과 `KR` 인 행이 함께 있을 수 있으므로, `tossSymbol IS NOT NULL` 인 행을 우선한다.

- [ ] **Step 4: `record-paper-trade.usecase.ts` 구현** — 도메인 함수로 계산하고 repository 의 트랜잭션 메서드로 한 번에 쓴다. usecase 안에서 Prisma 를 직접 호출하지 않는다.

- [ ] **Step 5: 통과 확인**

- [ ] **Step 6: 평가 usecase 테스트 작성**

케이스:
① 포지션 2건을 각각 최신 종가로 평가해 합산한다
② 포지션 0건이면 `skipped=false` 로 진행하고 `totalValue=cashBalance` 를 적재한다(0건도 기록을 남긴다)
③ 어느 종목의 봉 거래일이 실행 거래일과 다르면 `staleTickerCount` 가 증가하고 리포트에 남는다
④ **모든** 포지션이 stale 이면 스냅샷을 적재하지 않고 `skipped=true`
⑤ 불변식 위반이 있으면 스냅샷을 적재하지 않는다
⑥ 가격 점프 의심이 있으면 스냅샷을 적재하지 않는다
⑦ 같은 거래일 재실행은 기존 스냅샷을 덮어쓴다(overwrite)
⑧ 시세 조회를 `{ adjusted: false }` 로 호출한다 — mock 호출 인자로 단언
⑨ `DailyPrice` 에 **쓰지 않는다** — Prisma mock 에 `dailyPrice.upsert` 가 호출되지 않음을 단언

⑨ 가 중요하다. 장중이든 아니든 `DailyPrice(tickerId, 오늘)` 이 생기면 그날 주가 감시가 "휴장이었다"로 오판해 판정을 건너뛴다(실제 사고: `docs/superpowers/plans/2026-08-06-invest-line-roadmap.md` §E). 테스트로 못박아 후속 변경이 이 제약을 깨지 못하게 한다.

- [ ] **Step 7: 실패 확인 → Step 8: 구현 → Step 9: 통과 확인**

- [ ] **Step 10: `paper-trading.module.ts` 작성** — `MarketDataModule`, `PrismaModule` import. repository·usecase 2개 provider 등록 및 export.

- [ ] **Step 11: 게이트 + 커밋** — `feat(paper-trading): 매매 기록·계좌 평가 usecase`

---

## Task 5: 수동 매매 입력 CLI

**Files:**
- Create: `scripts/paper-trade.ts`

`scripts/` 는 `pnpm test` 와 `nest build` 대상이 아니고 `lint:check` 만 통과한다. 따라서 **로직을 두지 않는다** — 인자 파싱과 결과 출력만 하고 상태 변경은 Task 4 의 usecase 를 호출한다.

**⚠️ `AppModule` 을 부팅하지 않는다.** autopilot 스케줄러가 부팅 시 플레이북 CRON 을 재등록해 **실행 중인 이대리의 예약 작업을 건드린다**(`autopilot.scheduler.ts:43-44, 75, 91`). `PaperTradingModule` + `PrismaModule` + `ConfigModule` 만 담은 전용 module 로 `NestFactory.createApplicationContext` 한다.

- [ ] **Step 1: 사용법 주석과 인자 파서 작성** (`scripts/register-holding.ts` 의 argv 파싱 형태를 따른다)

```
사용법:
  pnpm exec ts-node scripts/paper-trade.ts open --seed 10000000
  pnpm exec ts-node scripts/paper-trade.ts buy  --code 005930 --name 삼성전자 --market KOSPI --qty 10 --price 71000 --date 2026-08-11
  pnpm exec ts-node scripts/paper-trade.ts sell --code 005930 --market KOSPI --qty 4 --price 73000 --date 2026-08-12
  pnpm exec ts-node scripts/paper-trade.ts status
```

- [ ] **Step 2: 전용 부팅 module 로 컨텍스트 생성 → usecase 호출 → 결과 표 출력 → `app.close()`**

- [ ] **Step 3: 실행 확인** — 계좌 개설 → 매수 → `status` 로 현금·포지션 확인

- [ ] **Step 4: 게이트 + 커밋** — `feat(paper-trading): 수동 매매 입력 CLI`

---

## Task 6: autopilot task 와 등록

**Files:**
- Create: `src/paper-trading/infrastructure/paper-trading.formatter.ts` + `.spec.ts`
- Create: `src/autopilot/infrastructure/tasks/paper-trading.autopilot-task.ts` + `.spec.ts`
- Modify: `src/model-router/domain/model-router.type.ts`, `agent-provider.map.ts`
- Modify: `src/agent-registry/agent-registry.ts`, `agent-contract.ts`
- Modify: `src/agent-run/domain/agent-run.type.ts`
- Modify: `src/autopilot/domain/autopilot.playbook-defaults.ts`, `autopilot.playbook.ts`
- Modify: `src/autopilot/autopilot.module.ts`, `src/app.module.ts`
- Modify: `.env.example`, `src/config/app.config.ts`, `README.md`

- [ ] **Step 1: 포매터 테스트 → 구현**

Slack mrkdwn 표. 케이스: ① 종목별 수량·평단·현재가·평가액·손익률 행, ② 총 평가액·현금·수익률 요약, ③ 벤치마크가 있으면 대비 표시·없으면 생략, ④ stale 종목에 표식, ⑤ 포지션 0건이면 "보유 없음" 문구, ⑥ LLM 산출물이 아니므로 escape 는 종목명에만 적용.

- [ ] **Step 2: 등록 상수 추가**

```ts
// model-router.type.ts
PAPER_TRADE = 'PAPER_TRADE',
// agent-provider.map.ts — 결정론 계산이라 모델을 쓰지 않지만 Record 가 exhaustive 다.
//   INVEST 항목과 같은 값으로 채운다(실행 시 modelUsed: 'deterministic').
// agent-run.type.ts
AUTOPILOT_PAPER_TRADING_CRON = 'AUTOPILOT_PAPER_TRADING_CRON',
// autopilot.playbook-defaults.ts
export const DEFAULT_PAPER_TRADING_CRON = '40 17 * * 1-5';
export const DEFAULT_PAPER_TRADING_TIMEZONE = 'Asia/Seoul';
```

`agent-registry.ts` 와 `agent-contract.ts` 는 spec 이 enum 과 양방향 집합 일치를 강제하므로 항목을 빠뜨리면 테스트가 깨진다. 이것이 정상 동작이다.

- [ ] **Step 3: playbook 엔트리 추가 — standalone**

`digestGroup` 을 지정하지 않는다. 기존 그룹(`evening`/`noon`)의 맨 앞에 넣으면 그룹 스케줄 env 키가 바뀌어 **기존 override 가 조용히 무시된다**(`autopilot.scheduler.ts:116-141`, `.env.example:102-108` 의 `morning-briefing → secretariat` 사례). standalone 이면 자기 자신이 그룹 첫 항목이라 안전하고, 대가로 Slack 메시지가 다이제스트에 합쳐지지 않고 독립 1건으로 나간다.

- [ ] **Step 4: task 구현**

`stock-monitor.autopilot-task.ts` 의 구조를 따른다.
- `PAPER_TRADING_ENABLED !== 'true'` 면 `{ skip: true }` 반환. **게이트 판정은 원장 밖**에서 한다(선례 `:176-181`).
- `AgentRunService` 로 원장을 남긴다. `agentType: AgentType.PAPER_TRADE`, `triggerType: TriggerType.AUTOPILOT_PAPER_TRADING_CRON`, `modelUsed: 'deterministic'`.
- 감사 요약(`agent_run.output`)에는 **일이 없었던 실행도** 남긴다: `positionCount`, `staleTickerCount`, `invariantViolationCount`, `suspiciousJumpCount`, `tradeDate`, `skipped`.
- `summaryText` 는 포매터 결과.

- [ ] **Step 5: task 테스트**

케이스: ① 게이트가 꺼져 있으면 usecase 를 호출하지 않는다, ② 평가 결과를 원장과 `summaryText` 에 함께 남긴다, ③ 포지션 0건 실행도 원장에 기록된다, ④ usecase 가 예외를 던지면 실패로 기록된다.

- [ ] **Step 6: 모듈 배선**

`autopilot.module.ts` 는 세 곳을 함께 고친다 — `imports` 에 `PaperTradingModule`, `providers` 배열, 그리고 `AUTOPILOT_TASKS` useFactory 의 **인자 목록과 `inject` 배열 양쪽**(`:175-242`). 순서가 어긋나면 다른 task 가 조용히 주입된다. `app.module.ts` 에도 `PaperTradingModule` 을 등록한다.

- [ ] **Step 7: env 3개 4곳 동기**

`PAPER_TRADING_ENABLED`, `AUTOPILOT_PAPER_TRADING_SCHEDULE`, `AUTOPILOT_PAPER_TRADING_TIMEZONE` 을 `.env.example` + `src/config/app.config.ts`(class-validator, optional) + `README.md` 표에 넣는다. 로컬 `.env` 는 사용자가 채운다.

```bash
pnpm check:env    # .env.example ↔ app.config.ts orphan 0 확인
pnpm docs:sync && pnpm docs:check
git add -f docs/agent-catalog.md docs/env-catalog.md   # docs/ 는 gitignore 지만 카탈로그는 tracked
```

- [ ] **Step 8: 전체 게이트**

```bash
pnpm lint:check
pnpm test            # 전체 — 포트/enum 확장이 다른 mock 을 깨뜨렸는지 여기서만 잡힌다
pnpm build
pnpm exec tsc --noEmit -p tsconfig.json
pnpm check:env
pnpm docs:check
```

- [ ] **Step 9: 커밋** — `feat(paper-trading): 장마감 평가 자동 실행과 Slack 손익 리포트`

---

## 실증 검증 (구현 완료 후)

단위 테스트만으로는 확인되지 않는 것들이다.

- [ ] 계좌 개설(시드 1,000만) → 2종목 매수 → 다음 거래일 1종목 부분 매도까지 CLI 로 넣는다. 매수 1건만으로는 수수료·세금·실현손익 경로가 한 번도 실행되지 않는다.
- [ ] 리포트의 평가액을 토스 앱 실제 종가와 직접 대조한다.
- [ ] 같은 거래일에 task 를 두 번 실행해 overwrite 가 동작하고 스냅샷이 중복되지 않음을 확인한다.
- [ ] 주말에 한 번 실행해 봉 미확보 경로(스냅샷 미적재)를 통과시킨다.
- [ ] `PAPER_TRADING_ENABLED=false` 로 두고 실행해 skip 이 원장에 남는지 확인한다.
- [ ] 실행 후 `stock-monitor` 가 정상 판정하는지 확인한다 — `daily_price` 에 이번 실행이 아무 행도 남기지 않았음을 직접 조회로 확인한다(§Task 4 Step 6 ⑨ 의 실물 대조).

## 후속 PR

- 자산 곡선 PNG + `SlackNotifierPort`·`AutopilotTaskResult` 파일 필드 확장 + Slack `files:write` 스코프
- 벤치마크(KOSPI 지수) 시세 조달 — 심볼 확인 후 스냅샷에 적재
- 과거 60거래일 스냅샷 백필(`isBackfilled=true`) — 차트 렌더러 검증용
