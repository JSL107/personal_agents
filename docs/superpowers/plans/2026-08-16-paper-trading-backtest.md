# 모의투자 백테스트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 과거 주가를 재생해 "그때 이 규칙대로 샀으면 어떻게 됐을지"를 계산하는 CLI 하나를 만든다.

**Architecture:** 지표·스크리너·비중산정·체결·채점은 전부 기존 프로덕션 함수를 그대로 호출한다. 신규 코드는 (1) 과거 날짜를 넘기는 재생 루프, (2) LLM 자리를 대신하는 결정론적 선택, (3) DB 대신 메모리에서 계좌를 굴리는 대역, (4) CLI 껍데기 넷뿐이다. DB는 읽기만 하고 쓰지 않는다.

**Tech Stack:** NestJS 10 (standalone application context), Prisma 6, `Prisma.Decimal`, jest + ts-jest, ts-node CLI

**설계서:** [2026-08-16-paper-trading-backtest-design.md](../specs/2026-08-16-paper-trading-backtest-design.md)

---

## 이 레포에서 반드시 지킬 것

- **패키지 매니저는 `pnpm`.** `npm`/`yarn` 금지.
- **커밋은 사용자가 명시 요청한 뒤에만.** 각 Task 마지막의 커밋 단계는 사용자 승인이 있을 때만 실행한다 ([CLAUDE.md §2](../../../CLAUDE.md) 1번).
- **끝났다고 보고하기 전 `pnpm lint:check && pnpm test && pnpm build` 3중 green.**
- `process.env` 직접 참조 금지 → `ConfigService`. 단 CLI 진입 스크립트는 DI 밖이라 예외.
- 변수명 줄임말 금지 (`err`→`error`, `repo`→`repository`), `if` 단일 라인도 중괄호 필수, try-catch 안에서는 `return await`.
- 파일명은 kebab-case + 역할 suffix. 테스트는 대상 파일 옆에 `*.spec.ts`.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `prisma/schema.prisma` (수정) | `DailyPrice.open` 컬럼 추가 |
| `src/screener/application/collect-universe-prices.usecase.ts` (수정) | 수집 시 `open` 함께 저장 |
| `src/market-data/infrastructure/market-data.prisma.repository.ts` (수정) | `insertDailyPrices`/`upsertDailyPrices`가 `open` 처리, 백테스트용 전 구간 봉 조회 추가 |
| `src/screener/domain/screener-rule.ts` (수정) | 거래대금 하한을 인자로 받도록 (기본값은 기존 상수) |
| `src/backtest/domain/backtest-bar.type.ts` | 백테스트가 다루는 봉 타입 (`open` 포함) |
| `src/backtest/domain/backtest-calendar.ts` | 추천일(평일)과 체결일(거래일) 두 축 생성 |
| `src/backtest/domain/top-scored-selection.ts` | LLM 자리를 대신하는 결정론적 매수·매도 선택 |
| `src/backtest/domain/backtest-metric.ts` | 비중 초과·만료 사유·동시 체결 집계 |
| `src/backtest/infrastructure/in-memory-paper-ledger.ts` | `fillPendingOrderAtomically` 대역 (메모리 계좌) |
| `src/backtest/infrastructure/backtest.formatter.ts` | 성적표 텍스트 출력 |
| `src/backtest/infrastructure/backtest.prisma.repository.ts` | 유니버스·봉·벤치마크 종가 읽기 |
| `src/backtest/application/replay-backtest.usecase.ts` | 재생 루프 본체 |
| `src/backtest/interface/backtest-cli.parser.ts` | CLI 인자 파싱 |
| `src/backtest/backtest.module.ts` | 모듈 등록 |
| `scripts/backtest.ts` | CLI 진입점 |

---

## Task 1: `DailyPrice.open` 컬럼 추가

**Files:**
- Modify: `prisma/schema.prisma:371-385`
- Modify: `src/market-data/infrastructure/market-data.prisma.repository.ts`
- Test: `src/market-data/infrastructure/market-data.prisma.repository.spec.ts`

- [ ] **Step 1: 스키마에 nullable `open` 추가**

`prisma/schema.prisma` 의 `model DailyPrice` 에 `close` 바로 위 줄로 추가한다.

```prisma
model DailyPrice {
  id             Int       @id @default(autoincrement())
  tickerId       Int       @map("ticker_id")
  ticker         Ticker    @relation(fields: [tickerId], references: [id], onDelete: Cascade)
  tradeDate      DateTime  @map("trade_date") @db.Date
  // 백테스트가 실전과 같은 "다음 영업일 시가 체결"을 재현하려면 시가가 필요하다.
  // 기존 행을 보존해야 하므로 nullable 이다. 재수집이 끝나면 사실상 전 행이 채워진다.
  open           Decimal?  @db.Decimal(18, 4)
  close          Decimal   @db.Decimal(18, 4)
  adjClose       Decimal   @map("adj_close") @db.Decimal(18, 4)
  volume         BigInt
  fetchedAt      DateTime  @default(now()) @map("fetched_at")
  lastResyncedAt DateTime? @map("last_resynced_at")

  @@unique([tickerId, tradeDate])
  @@index([tickerId, tradeDate])
  @@map("daily_price")
}
```

- [ ] **Step 2: 스키마 반영과 클라이언트 재생성**

```bash
pnpm prisma format
pnpm db:push
pnpm prisma:generate
```

Expected: `db:push` 가 `The database is already in sync` 또는 `Your database is now in sync` 로 끝나고, `prisma:generate` 가 `Generated Prisma Client` 를 출력한다.

`pnpm db:push` 가 DB 접속 실패로 끝나면 먼저 `pnpm db:up` 으로 컨테이너를 올린다.

- [ ] **Step 3: 쓰기 경로가 `open` 을 싣는지 확인하는 실패 테스트**

`src/market-data/infrastructure/market-data.prisma.repository.spec.ts` 에 추가한다. 기존 파일의 mock 구성 방식을 그대로 따르되, 아래는 자립적으로 동작하도록 필요한 mock 을 직접 만든다.

```ts
describe('MarketDataPrismaRepository open 컬럼', () => {
  it('insertDailyPrices 가 시가를 함께 저장한다', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      dailyPrice: { createMany },
    } as unknown as PrismaService;
    const repository = new MarketDataPrismaRepository(prisma);

    await repository.insertDailyPrices([
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-14T00:00:00.000Z'),
        open: '69000',
        close: '70000',
        adjClose: '70000',
        volume: 1000n,
      },
    ]);

    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ open: '69000' })],
      }),
    );
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

```bash
pnpm exec jest src/market-data/infrastructure/market-data.prisma.repository.spec.ts -t 'open 컬럼'
```

Expected: FAIL. `DailyPriceWriteInput` 에 `open` 이 없어 타입 에러가 나거나, `createMany` 인자에 `open` 이 없어 단언이 깨진다.

- [ ] **Step 5: `DailyPriceWriteInput` 에 `open` 추가**

`src/market-data/infrastructure/market-data.prisma.repository.ts` 의 `DailyPriceWriteInput` 인터페이스에 필드를 추가한다.

```ts
export interface DailyPriceWriteInput {
  tickerId: number;
  tradeDate: Date;
  // 토스 응답에 시가가 없는 캔들이 섞일 수 있어 optional 이다.
  open?: string;
  close: string;
  adjClose: string;
  volume: bigint;
}
```

그리고 `insertDailyPrices` 와 `upsertDailyPrices` 가 행을 만들 때 `open: row.open ?? null` 을 함께 싣도록 수정한다. 두 메서드 안에서 Prisma 에 넘기는 객체 리터럴마다 이 필드를 추가하면 된다.

- [ ] **Step 6: 테스트 통과 확인**

```bash
pnpm exec jest src/market-data/infrastructure/market-data.prisma.repository.spec.ts -t 'open 컬럼'
```

Expected: PASS

- [ ] **Step 7: 수집 usecase 가 시가를 넘기게 한다**

`src/screener/application/collect-universe-prices.usecase.ts:43-53` 의 `toWriteRows` 를 수정한다.

```ts
const toWriteRows = (
  ticker: UniverseTicker,
  bars: DailyBar[],
): DailyPriceWriteInput[] =>
  bars.map((bar) => ({
    tickerId: ticker.id,
    tradeDate: bar.tradeDate,
    open: bar.open?.toString(),
    close: bar.close.toString(),
    adjClose: bar.adjClose.toString(),
    volume: bar.volume,
  }));
```

- [ ] **Step 8: 전체 테스트와 빌드**

```bash
pnpm lint:check && pnpm test && pnpm build
```

Expected: 3개 모두 exit 0

- [ ] **Step 9: 커밋 (사용자 승인 후에만)**

```bash
git add prisma/schema.prisma src/market-data/infrastructure/market-data.prisma.repository.ts src/market-data/infrastructure/market-data.prisma.repository.spec.ts src/screener/application/collect-universe-prices.usecase.ts
git commit -m "feat(market-data): 백테스트가 시가 체결을 재현하도록 일봉에 시가를 저장한다"
```

- [ ] **Step 10: 전 종목 재수집 (야간 실행)**

```bash
pnpm exec ts-node scripts/screener.ts collect-prices --days 200
```

Expected: `성공 N종목, 실패 M종목` 요약이 출력된다. 2,500종목 기준 수십 분이 걸린다. 실패 종목이 나오면 재실행한다 — `upsertDailyPrices` 라 재실행이 안전하다.

---

## Task 2: 거래대금 하한을 인자로 받게 한다

**설계서에 없던 항목이다.** `MINIMUM_TURNOVER60` 이 상수로 박혀 있어 CLI 의 `--turnover-min` 이 지금 구조로는 동작할 수 없다. 기본값을 유지하는 optional 인자로 열어 기존 호출부는 건드리지 않는다.

**Files:**
- Modify: `src/screener/domain/screener-rule.ts:91-133`
- Test: `src/screener/domain/screener-rule.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/screener/domain/screener-rule.spec.ts` 에 추가한다. `buildCandidate` 같은 기존 헬퍼가 있으면 재사용하고, 없으면 아래처럼 직접 만든다.

```ts
describe('screenStocks 거래대금 하한 주입', () => {
  const candidate = (code: string, turnover60: number): ScreenCandidate => ({
    tickerId: Number(code),
    code,
    name: `종목${code}`,
    krxMarket: 'KOSPI',
    indicators: {
      close: 10000,
      ma5: 9900,
      ma20: 9800,
      ma60: 9700,
      ma120: 9600,
      isAligned: true,
      volumeSurge: 1.0,
      return1m: 5,
      return3m: 10,
      return6m: 20,
      high200Position: 0.95,
      volatility20: 20,
      turnover60,
      barCount: 200,
    },
  });

  it('하한을 높이면 그 아래 종목이 탈락한다', () => {
    const candidates = [candidate('000001', 2e9), candidate('000002', 7e8)];

    const withDefault = screenStocks(candidates, 'LONG_TERM', 10);
    const withRaised = screenStocks(candidates, 'LONG_TERM', 10, 1e9);

    expect(withDefault.map((stock) => stock.code)).toEqual([
      '000001',
      '000002',
    ]);
    expect(withRaised.map((stock) => stock.code)).toEqual(['000001']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm exec jest src/screener/domain/screener-rule.spec.ts -t '거래대금 하한 주입'
```

Expected: FAIL — `screenStocks` 가 인자 4개를 받지 않아 타입 에러

- [ ] **Step 3: 구현**

`src/screener/domain/screener-rule.ts` 의 `screenStocks` 시그니처를 바꾼다.

```ts
export const screenStocks = (
  candidates: ScreenCandidate[],
  strategy: ScreenStrategy,
  limit: number,
  // 백테스트가 하한을 바꿔가며 비교할 수 있도록 주입 가능하게 열어 둔다.
  // 기본값이 운영 규칙이므로 기존 호출부는 그대로 둔다.
  minimumTurnover60: number = MINIMUM_TURNOVER60,
): ScreenedStock[] => {
  const passed = candidates.filter(
    (candidate) =>
      candidate.indicators.turnover60 !== null &&
      candidate.indicators.turnover60 >= minimumTurnover60 &&
      (strategy === 'LONG_TERM'
        ? passesLongTerm(candidate)
        : passesSwing(candidate)),
  );
  // 이하 기존 본문 그대로
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/screener/domain/screener-rule.spec.ts
```

Expected: PASS (신규 + 기존 전부)

- [ ] **Step 5: 커밋 (사용자 승인 후에만)**

```bash
git add src/screener/domain/screener-rule.ts src/screener/domain/screener-rule.spec.ts
git commit -m "refactor(screener): 거래대금 하한을 주입 가능하게 열어 백테스트 비교를 준비한다"
```

---

## Task 3: 백테스트 봉 타입과 읽기 리포지토리

`findBarsForTickers` 는 최근 400일로 잘라 읽고 `open` 도 없어서 백테스트에 쓸 수 없다. 구간을 명시해 읽는 전용 메서드를 만든다.

**Files:**
- Create: `src/backtest/domain/backtest-bar.type.ts`
- Create: `src/backtest/infrastructure/backtest.prisma.repository.ts`
- Test: `src/backtest/infrastructure/backtest.prisma.repository.spec.ts`

- [ ] **Step 1: 봉 타입 작성**

`src/backtest/domain/backtest-bar.type.ts`

```ts
import { IndicatorBar } from '../../market-data/domain/stock-indicator';

// 지표 계산은 기존 IndicatorBar 를 그대로 쓰고, 체결에만 필요한 시가를 얹는다.
// 시가가 없는 거래일은 체결이 불가능하므로 재생 루프가 실패로 보고한다.
export interface BacktestBar extends IndicatorBar {
  open: number | null;
}

export interface BacktestTicker {
  tickerId: number;
  code: string;
  name: string;
  krxMarket: string;
}
```

- [ ] **Step 2: 리포지토리 실패 테스트 작성**

`src/backtest/infrastructure/backtest.prisma.repository.spec.ts`

```ts
import { PrismaService } from '../../prisma/prisma.service';
import { BacktestPrismaRepository } from './backtest.prisma.repository';

describe('BacktestPrismaRepository', () => {
  it('구간 안의 봉만 종목별로 오름차순 정렬해 돌려준다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-13T00:00:00.000Z'),
        open: { toString: () => '69000' },
        close: { toString: () => '70000', toNumber: () => 70000 },
        adjClose: { toString: () => '70000', toNumber: () => 70000 },
        volume: 1000n,
      },
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-14T00:00:00.000Z'),
        open: null,
        close: { toString: () => '71000', toNumber: () => 71000 },
        adjClose: { toString: () => '71000', toNumber: () => 71000 },
        volume: 1200n,
      },
    ]);
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new BacktestPrismaRepository(prisma);

    const bars = await repository.findBarsInRange(
      [1],
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-08-14T00:00:00.000Z'),
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ tickerId: 'asc' }, { tradeDate: 'asc' }],
      }),
    );
    expect(bars.get(1)).toHaveLength(2);
    expect(bars.get(1)![0].open).toBe(69000);
    expect(bars.get(1)![1].open).toBeNull();
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

```bash
pnpm exec jest src/backtest/infrastructure/backtest.prisma.repository.spec.ts
```

Expected: FAIL — `Cannot find module './backtest.prisma.repository'`

- [ ] **Step 4: 구현**

`src/backtest/infrastructure/backtest.prisma.repository.ts`

```ts
import { Injectable } from '@nestjs/common';

import { BenchmarkCloseInput } from '../../paper-trading/domain/shadow-performance';
import { PrismaService } from '../../prisma/prisma.service';
import { BacktestBar, BacktestTicker } from '../domain/backtest-bar.type';

@Injectable()
export class BacktestPrismaRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 재생은 현재 상장 종목만 본다. 상장폐지 종목이 빠지는 생존 편향은 설계서 §12 에 명시한 한계다.
  async findUniverse(): Promise<BacktestTicker[]> {
    const tickers = await this.prisma.ticker.findMany({
      where: {
        market: 'KR',
        krxMarket: { not: null },
        delistedAt: null,
      },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, krxMarket: true },
    });
    return tickers.map((ticker) => ({
      tickerId: ticker.id,
      code: ticker.code,
      name: ticker.name,
      krxMarket: ticker.krxMarket as string,
    }));
  }

  // 지표는 과거 200봉을 보므로 호출자가 from 을 넉넉히 앞당겨 넘긴다.
  async findBarsInRange(
    tickerIds: number[],
    from: Date,
    to: Date,
  ): Promise<Map<number, BacktestBar[]>> {
    const bars = new Map<number, BacktestBar[]>();
    if (tickerIds.length === 0) {
      return bars;
    }
    const rows = await this.prisma.dailyPrice.findMany({
      where: {
        tickerId: { in: tickerIds },
        tradeDate: { gte: from, lte: to },
      },
      orderBy: [{ tickerId: 'asc' }, { tradeDate: 'asc' }],
      select: {
        tickerId: true,
        tradeDate: true,
        open: true,
        close: true,
        adjClose: true,
        volume: true,
      },
    });
    for (const row of rows) {
      const list = bars.get(row.tickerId) ?? [];
      list.push({
        tradeDate: row.tradeDate,
        open: row.open === null ? null : Number(row.open.toString()),
        close: row.close,
        adjClose: row.adjClose,
        volume: row.volume,
      });
      bars.set(row.tickerId, list);
    }
    return bars;
  }

  // calculateBenchmarkPerformance 가 그대로 먹을 수 있는 형태로 돌려준다.
  // symbol 값 공간은 8종이고 코스피 대비만 재므로 'KOSPI' 로 좁힌다.
  async findBenchmarkCloses(
    from: Date,
    to: Date,
  ): Promise<BenchmarkCloseInput[]> {
    const rows = await this.prisma.benchmarkDailyClose.findMany({
      where: { symbol: 'KOSPI', tradeDate: { gte: from, lte: to } },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, close: true },
    });
    return rows.map((row) => ({
      tradeDate: row.tradeDate,
      close: row.close,
    }));
  }
}
```

`BenchmarkCloseInput` 는 `../../paper-trading/domain/shadow-performance` 에서 import 한다.

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm exec jest src/backtest/infrastructure/backtest.prisma.repository.spec.ts
```

Expected: PASS

- [ ] **Step 6: 커밋 (사용자 승인 후에만)**

```bash
git add src/backtest/
git commit -m "feat(backtest): 구간 지정 일봉 조회와 백테스트 봉 타입을 추가한다"
```

---

## Task 4: 재생 달력 — 추천일(평일)과 체결일(거래일)

**Files:**
- Create: `src/backtest/domain/backtest-calendar.ts`
- Test: `src/backtest/domain/backtest-calendar.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/backtest/domain/backtest-calendar.spec.ts`

```ts
import { buildBacktestCalendar } from './backtest-calendar';

describe('buildBacktestCalendar', () => {
  it('추천일은 주말을 뺀 모든 평일이고 체결일은 봉이 있는 날뿐이다', () => {
    // 2026-08-13(목) 2026-08-14(금) 2026-08-17(월) 봉 존재.
    // 2026-08-15(토) 2026-08-16(일) 주말, 2026-08-14 는 봉이 있으나
    // 2026-08-17 은 있고 2026-08-18(화) 은 없다고 가정한다.
    const tradeDates = ['2026-08-13', '2026-08-14', '2026-08-17'];

    const calendar = buildBacktestCalendar({
      from: '2026-08-13',
      to: '2026-08-18',
      tradeDates,
    });

    expect(calendar.recommendDates).toEqual([
      '2026-08-13',
      '2026-08-14',
      '2026-08-17',
      '2026-08-18',
    ]);
    expect(calendar.tradeDates).toEqual([
      '2026-08-13',
      '2026-08-14',
      '2026-08-17',
    ]);
  });

  it('구간 밖 거래일은 제외한다', () => {
    const calendar = buildBacktestCalendar({
      from: '2026-08-14',
      to: '2026-08-14',
      tradeDates: ['2026-08-13', '2026-08-14', '2026-08-17'],
    });

    expect(calendar.tradeDates).toEqual(['2026-08-14']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm exec jest src/backtest/domain/backtest-calendar.spec.ts
```

Expected: FAIL — `Cannot find module './backtest-calendar'`

- [ ] **Step 3: 구현**

`src/backtest/domain/backtest-calendar.ts`

```ts
export interface BuildBacktestCalendarInput {
  from: string;
  to: string;
  // DailyPrice 에 행이 존재하는 날짜들. 휴장일은 애초에 없으므로 별도 공휴일 달력이 필요 없다.
  tradeDates: string[];
}

export interface BacktestCalendar {
  // 추천 크론이 평일마다 도는 것을 그대로 재현한다. 공휴일에도 추천은 생성된다.
  recommendDates: string[];
  // 체결은 봉이 있는 날에만 성사된다.
  tradeDates: string[];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const assertDateText = (value: string, label: string): void => {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`${label}는 YYYY-MM-DD 형식이어야 합니다. 받은 값: ${value}`);
  }
};

const isWeekend = (dateText: string): boolean => {
  const day = new Date(`${dateText}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
};

export const buildBacktestCalendar = (
  input: BuildBacktestCalendarInput,
): BacktestCalendar => {
  assertDateText(input.from, 'from');
  assertDateText(input.to, 'to');
  if (input.from > input.to) {
    throw new Error(
      `from 이 to 보다 뒤일 수 없습니다. from: ${input.from}, to: ${input.to}`,
    );
  }

  const recommendDates: string[] = [];
  const cursor = new Date(`${input.from}T00:00:00.000Z`);
  const last = new Date(`${input.to}T00:00:00.000Z`);
  while (cursor.getTime() <= last.getTime()) {
    const dateText = cursor.toISOString().slice(0, 10);
    if (!isWeekend(dateText)) {
      recommendDates.push(dateText);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const tradeDates = [...new Set(input.tradeDates)]
    .filter((dateText) => dateText >= input.from && dateText <= input.to)
    .sort();

  return { recommendDates, tradeDates };
};
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/backtest/domain/backtest-calendar.spec.ts
```

Expected: PASS

- [ ] **Step 5: 커밋 (사용자 승인 후에만)**

```bash
git add src/backtest/domain/backtest-calendar.ts src/backtest/domain/backtest-calendar.spec.ts
git commit -m "feat(backtest): 추천일과 체결일을 분리한 재생 달력을 추가한다"
```

---

## Task 5: 결정론적 선택 — LLM 자리를 대신한다

**Files:**
- Create: `src/backtest/domain/top-scored-selection.ts`
- Test: `src/backtest/domain/top-scored-selection.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/backtest/domain/top-scored-selection.spec.ts`

```ts
import { selectDeterministicRecommendation } from './top-scored-selection';

describe('selectDeterministicRecommendation', () => {
  const stock = (code: string, score: number) => ({
    tickerId: Number(code),
    code,
    name: `종목${code}`,
    score,
  });

  it('점수 상위에서 최대 종목수만큼 매수한다', () => {
    const result = selectDeterministicRecommendation({
      rankedStocks: [stock('000001', 90), stock('000002', 80), stock('000003', 70)],
      heldPositions: [],
      maximumPositions: 2,
    });

    expect(result.buys.map((buy) => buy.code)).toEqual(['000001', '000002']);
    expect(result.sells).toEqual([]);
  });

  it('보유 중인 종목은 재매수하지 않는다', () => {
    const result = selectDeterministicRecommendation({
      rankedStocks: [stock('000001', 90), stock('000002', 80)],
      heldPositions: [{ code: '000001', holdingTradeDays: 3 }],
      maximumPositions: 2,
    });

    expect(result.buys.map((buy) => buy.code)).toEqual(['000002']);
  });

  it('보유일수가 청산 기준에 닿으면 매도한다', () => {
    const result = selectDeterministicRecommendation({
      rankedStocks: [stock('000001', 90)],
      heldPositions: [
        { code: '000001', holdingTradeDays: 60 },
        { code: '000009', holdingTradeDays: 59 },
      ],
      maximumPositions: 3,
      holdingTradeDays: 60,
    });

    expect(result.sells.map((sell) => sell.code)).toEqual(['000001']);
  });

  it('빈 자리 수만큼만 매수한다', () => {
    const result = selectDeterministicRecommendation({
      rankedStocks: [stock('000002', 80), stock('000003', 70)],
      heldPositions: [{ code: '000001', holdingTradeDays: 1 }],
      maximumPositions: 2,
    });

    expect(result.buys.map((buy) => buy.code)).toEqual(['000002']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm exec jest src/backtest/domain/top-scored-selection.spec.ts
```

Expected: FAIL — `Cannot find module './top-scored-selection'`

- [ ] **Step 3: 구현**

`src/backtest/domain/top-scored-selection.ts`

```ts
import { PaperRecommendation } from '../../agent/paper-recommend/domain/paper-recommendation.type';

export interface RankedStock {
  tickerId: number;
  code: string;
  name: string;
  score: number;
}

export interface HeldPosition {
  code: string;
  // 매수 체결일부터 센 거래일 수.
  holdingTradeDays: number;
}

export interface SelectDeterministicRecommendationInput {
  rankedStocks: RankedStock[];
  heldPositions: HeldPosition[];
  maximumPositions: number;
  holdingTradeDays?: number;
}

// 실전에서는 codex 가 고르고 판다. 백테스트는 그 자리를 규칙으로 채운다.
// 매수는 점수 상위, 매도는 보유일수 경과 전량 청산이다. 같은 입력이면 항상 같은 출력이어야
// 규칙 A/B 비교의 기준선이 흔들리지 않는다.
export const selectDeterministicRecommendation = (
  input: SelectDeterministicRecommendationInput,
): PaperRecommendation => {
  const heldCodes = new Set(
    input.heldPositions.map((position) => position.code),
  );
  const sells =
    input.holdingTradeDays === undefined
      ? []
      : input.heldPositions
          .filter(
            (position) =>
              position.holdingTradeDays >= (input.holdingTradeDays as number),
          )
          .map((position) => ({
            code: position.code,
            reason: `보유 ${position.holdingTradeDays}거래일 경과로 청산`,
          }));
  const sellCodes = new Set(sells.map((sell) => sell.code));
  const openSlots = Math.max(
    0,
    input.maximumPositions - (heldCodes.size - sellCodes.size),
  );
  const weightPercent = openSlots === 0 ? 0 : 100 / input.maximumPositions;
  const buys = input.rankedStocks
    .filter((stock) => !heldCodes.has(stock.code))
    .slice(0, openSlots)
    .map((stock) => ({
      code: stock.code,
      weightPercent,
      reason: `스크리너 점수 ${stock.score}`,
    }));

  return { sells, buys };
};
```

`weightPercent` 를 `100 / maximumPositions` 로 두는 이유는 재생 루프가 CLI 의 `--weight` 를 따로 넘기기 때문이다. 루프에서 덮어쓴다.

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/backtest/domain/top-scored-selection.spec.ts
```

Expected: PASS

- [ ] **Step 5: 커밋 (사용자 승인 후에만)**

```bash
git add src/backtest/domain/top-scored-selection.ts src/backtest/domain/top-scored-selection.spec.ts
git commit -m "feat(backtest): LLM 자리를 대신하는 결정론적 매수·매도 선택을 추가한다"
```

---

## Task 6: 인메모리 계좌 대역

실전 `RecordPaperTradeUsecase.executePendingOrder` 를 그대로 통과시키기 위한 대역이다. DB 를 건드리지 않는다.

**Files:**
- Create: `src/backtest/infrastructure/in-memory-paper-ledger.ts`
- Test: `src/backtest/infrastructure/in-memory-paper-ledger.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/backtest/infrastructure/in-memory-paper-ledger.spec.ts`

```ts
import { Prisma } from '@prisma/client';

import { RecordPaperTradeUsecase } from '../../paper-trading/application/record-paper-trade.usecase';
import { PaperTradingPrismaRepository } from '../../paper-trading/infrastructure/paper-trading.prisma.repository';
import { InMemoryPaperLedger } from './in-memory-paper-ledger';

const usecaseOf = (ledger: InMemoryPaperLedger): RecordPaperTradeUsecase =>
  new RecordPaperTradeUsecase(
    ledger as unknown as PaperTradingPrismaRepository,
  );

describe('InMemoryPaperLedger', () => {
  it('실전 체결 usecase 를 통과시켜 현금과 보유를 갱신한다', async () => {
    const ledger = new InMemoryPaperLedger('10000000');
    const usecase = usecaseOf(ledger);

    const fill = await usecase.executePendingOrder({
      orderId: 1,
      accountId: 1,
      tickerId: 11,
      market: 'KOSPI',
      side: 'BUY',
      requestedQuantity: '10',
      price: '10000',
      tradeDate: '2026-08-14',
      strategy: 'LONG_TERM',
    });

    expect(fill.status).toBe('FILLED');
    expect(ledger.positionOf(11)?.quantity.toString()).toBe('10');
    expect(ledger.cashBalance.comparedTo(new Prisma.Decimal('10000000'))).toBe(
      -1,
    );
    expect(ledger.trades).toHaveLength(1);
  });

  it('현금이 모자라면 실전 로직대로 수량이 줄어든다', async () => {
    const ledger = new InMemoryPaperLedger('100000');
    const usecase = usecaseOf(ledger);

    const fill = await usecase.executePendingOrder({
      orderId: 1,
      accountId: 1,
      tickerId: 11,
      market: 'KOSPI',
      side: 'BUY',
      requestedQuantity: '100',
      price: '10000',
      tradeDate: '2026-08-14',
      strategy: 'LONG_TERM',
    });

    expect(fill.status).toBe('FILLED');
    expect(Number(ledger.positionOf(11)!.quantity.toString())).toBeLessThan(100);
    expect(ledger.cashBalance.comparedTo(0)).toBeGreaterThanOrEqual(0);
  });

  it('보유하지 않은 종목 매도는 만료된다', async () => {
    const ledger = new InMemoryPaperLedger('10000000');
    const usecase = usecaseOf(ledger);

    const fill = await usecase.executePendingOrder({
      orderId: 1,
      accountId: 1,
      tickerId: 99,
      market: 'KOSPI',
      side: 'SELL',
      requestedQuantity: '10',
      price: '10000',
      tradeDate: '2026-08-14',
      strategy: 'LONG_TERM',
    });

    expect(fill.status).toBe('EXPIRED');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm exec jest src/backtest/infrastructure/in-memory-paper-ledger.spec.ts
```

Expected: FAIL — `Cannot find module './in-memory-paper-ledger'`

- [ ] **Step 3: 구현**

`src/backtest/infrastructure/in-memory-paper-ledger.ts`

```ts
import { Prisma } from '@prisma/client';

import {
  FillPendingOrderInput,
  PendingOrderFillResult,
} from '../../paper-trading/infrastructure/paper-trading.prisma.repository';
import {
  RecommendationOrderInput,
  RecommendationTradeInput,
} from '../../paper-trading/domain/recommendation-score';

interface LedgerPosition {
  id: number;
  accountId: number;
  tickerId: number;
  quantity: Prisma.Decimal;
  avgPrice: Prisma.Decimal;
}

// 실전 체결 usecase 를 그대로 통과시키되 DB 는 건드리지 않는다.
// RecordPaperTradeUsecase 가 쓰는 메서드는 fillPendingOrderAtomically 하나뿐이라
// 그것만 대역하고, 생성자 주입 시점에 호출자가 캐스팅한다.
export class InMemoryPaperLedger {
  readonly accountId = 1;
  readonly seedAmount: Prisma.Decimal;
  cashBalance: Prisma.Decimal;
  readonly trades: RecommendationTradeInput[] = [];
  readonly orders: RecommendationOrderInput[] = [];
  private readonly positions = new Map<number, LedgerPosition>();
  private nextTradeId = 1;

  constructor(seedAmount: string) {
    this.seedAmount = new Prisma.Decimal(seedAmount);
    this.cashBalance = new Prisma.Decimal(seedAmount);
  }

  positionOf(tickerId: number): LedgerPosition | null {
    return this.positions.get(tickerId) ?? null;
  }

  openPositions(): LedgerPosition[] {
    return [...this.positions.values()].filter(
      (position) => position.quantity.comparedTo(0) > 0,
    );
  }

  recordOrder(order: RecommendationOrderInput): void {
    this.orders.push(order);
  }

  markOrderStatus(orderId: number, status: 'FILLED' | 'EXPIRED'): void {
    const order = this.orders.find((candidate) => candidate.id === orderId);
    if (order) {
      order.status = status;
    }
  }

  async fillPendingOrderAtomically(
    input: FillPendingOrderInput,
  ): Promise<PendingOrderFillResult> {
    const account = {
      id: this.accountId,
      seedAmount: this.seedAmount,
      cashBalance: this.cashBalance,
    };
    const position = this.positions.get(input.tickerId) ?? null;
    const decision = input.decide({ account, position });
    if (decision.status === 'EXPIRED') {
      this.markOrderStatus(input.orderId, 'EXPIRED');
      return decision;
    }

    this.cashBalance = new Prisma.Decimal(decision.cashBalance);
    this.positions.set(input.tickerId, {
      id: input.tickerId,
      accountId: this.accountId,
      tickerId: input.tickerId,
      quantity: new Prisma.Decimal(decision.positionQuantity),
      avgPrice: new Prisma.Decimal(decision.positionAvgPrice),
    });
    this.trades.push({
      id: this.nextTradeId,
      orderId: input.orderId,
      accountId: this.accountId,
      tickerId: input.tickerId,
      side: input.side,
      quantity: new Prisma.Decimal(decision.quantity),
      price: new Prisma.Decimal(input.price),
      fee: new Prisma.Decimal(decision.fee),
      tax: new Prisma.Decimal(decision.tax),
      realizedPnl:
        decision.realizedPnl === null
          ? null
          : new Prisma.Decimal(decision.realizedPnl),
      tradeDate: input.tradeDate,
    });
    this.nextTradeId += 1;
    this.markOrderStatus(input.orderId, 'FILLED');
    return decision;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/backtest/infrastructure/in-memory-paper-ledger.spec.ts
```

Expected: PASS (3개)

- [ ] **Step 5: 커밋 (사용자 승인 후에만)**

```bash
git add src/backtest/infrastructure/in-memory-paper-ledger.ts src/backtest/infrastructure/in-memory-paper-ledger.spec.ts
git commit -m "feat(backtest): 실전 체결 usecase 를 통과시키는 인메모리 계좌 대역을 추가한다"
```

---

## Task 7: 백테스트 고유 지표

**Files:**
- Create: `src/backtest/domain/backtest-metric.ts`
- Test: `src/backtest/domain/backtest-metric.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/backtest/domain/backtest-metric.spec.ts`

```ts
import { summarizeBacktestMetrics } from './backtest-metric';

describe('summarizeBacktestMetrics', () => {
  it('목표 비중을 넘겨 체결된 건수와 최댓값을 센다', () => {
    const summary = summarizeBacktestMetrics({
      fills: [
        { tradeDate: '2026-08-14', filledAmount: 2600000, accountValuation: 10000000 },
        { tradeDate: '2026-08-14', filledAmount: 1900000, accountValuation: 10000000 },
      ],
      expirations: [],
      targetWeightPercent: 20,
      maximumPositions: 3,
    });

    expect(summary.weightExceededCount).toBe(1);
    expect(summary.maximumWeightPercent).toBeCloseTo(26, 5);
  });

  it('만료 사유별로 집계한다', () => {
    const summary = summarizeBacktestMetrics({
      fills: [],
      expirations: [
        { tradeDate: '2026-08-14', statusReason: '현금 부족' },
        { tradeDate: '2026-08-14', statusReason: '현금 부족' },
        { tradeDate: '2026-08-17', statusReason: '보유 수량 없음' },
      ],
      targetWeightPercent: 20,
      maximumPositions: 3,
    });

    expect(summary.expirationsByReason).toEqual({
      '현금 부족': 2,
      '보유 수량 없음': 1,
    });
  });

  it('한 거래일에 최대 종목수를 넘겨 체결된 날을 센다', () => {
    const summary = summarizeBacktestMetrics({
      fills: [
        { tradeDate: '2026-08-17', filledAmount: 100, accountValuation: 10000000 },
        { tradeDate: '2026-08-17', filledAmount: 100, accountValuation: 10000000 },
        { tradeDate: '2026-08-17', filledAmount: 100, accountValuation: 10000000 },
        { tradeDate: '2026-08-17', filledAmount: 100, accountValuation: 10000000 },
        { tradeDate: '2026-08-18', filledAmount: 100, accountValuation: 10000000 },
      ],
      expirations: [],
      targetWeightPercent: 20,
      maximumPositions: 3,
    });

    expect(summary.burstFillDayCount).toBe(1);
    expect(summary.maximumFillsInOneDay).toBe(4);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm exec jest src/backtest/domain/backtest-metric.spec.ts
```

Expected: FAIL — `Cannot find module './backtest-metric'`

- [ ] **Step 3: 구현**

`src/backtest/domain/backtest-metric.ts`

```ts
export interface BacktestFillRecord {
  tradeDate: string;
  filledAmount: number;
  accountValuation: number;
}

export interface BacktestExpirationRecord {
  tradeDate: string;
  statusReason: string;
}

export interface SummarizeBacktestMetricsInput {
  fills: BacktestFillRecord[];
  expirations: BacktestExpirationRecord[];
  targetWeightPercent: number;
  maximumPositions: number;
}

export interface BacktestMetricSummary {
  // 주문 수량은 전일 종가로 확정되고 체결은 다음날 시가라, 갭 상승분이 비중 상한을 넘긴다.
  // 2026-08-16 검증에서 실측한 결함이며 이 지표가 상시 감시한다.
  weightExceededCount: number;
  maximumWeightPercent: number;
  expirationsByReason: Record<string, number>;
  // 연휴 동안 추천이 쌓였다가 개장일에 한꺼번에 체결되는 현상의 관측치다.
  burstFillDayCount: number;
  maximumFillsInOneDay: number;
}

export const summarizeBacktestMetrics = (
  input: SummarizeBacktestMetricsInput,
): BacktestMetricSummary => {
  let weightExceededCount = 0;
  let maximumWeightPercent = 0;
  for (const fill of input.fills) {
    if (fill.accountValuation <= 0) {
      continue;
    }
    const weightPercent = (fill.filledAmount / fill.accountValuation) * 100;
    if (weightPercent > input.targetWeightPercent) {
      weightExceededCount += 1;
    }
    if (weightPercent > maximumWeightPercent) {
      maximumWeightPercent = weightPercent;
    }
  }

  const expirationsByReason: Record<string, number> = {};
  for (const expiration of input.expirations) {
    expirationsByReason[expiration.statusReason] =
      (expirationsByReason[expiration.statusReason] ?? 0) + 1;
  }

  const fillCountByDate = new Map<string, number>();
  for (const fill of input.fills) {
    fillCountByDate.set(
      fill.tradeDate,
      (fillCountByDate.get(fill.tradeDate) ?? 0) + 1,
    );
  }
  let burstFillDayCount = 0;
  let maximumFillsInOneDay = 0;
  for (const count of fillCountByDate.values()) {
    if (count > input.maximumPositions) {
      burstFillDayCount += 1;
    }
    if (count > maximumFillsInOneDay) {
      maximumFillsInOneDay = count;
    }
  }

  return {
    weightExceededCount,
    maximumWeightPercent,
    expirationsByReason,
    burstFillDayCount,
    maximumFillsInOneDay,
  };
};
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/backtest/domain/backtest-metric.spec.ts
```

Expected: PASS (3개)

- [ ] **Step 5: 커밋 (사용자 승인 후에만)**

```bash
git add src/backtest/domain/backtest-metric.ts src/backtest/domain/backtest-metric.spec.ts
git commit -m "feat(backtest): 비중 초과·만료 사유·동시 체결 지표를 추가한다"
```

---

## Task 8: 재생 루프

앞의 조각을 순서대로 부르는 본체다. 가장 크므로 테스트를 먼저 촘촘히 박는다.

> **메모리 주의 (Task 3 구현자 지적).** `findBarsInRange` 는 유니버스 전체 × 구간 전체를 한 번에 읽는다.
> 2,599종목 × 200봉 ≈ 52만 행이고 행마다 `Prisma.Decimal` 이 둘씩 붙어 수백 MB 가 된다.
> 재생은 날짜를 넘기며 매 시점 전 종목을 봐야 하므로 읽기를 청킹해도 동시 보유량이 줄지 않는다.
> 대응은 Task 11 의 `NODE_OPTIONS=--max-old-space-size=4096` 이고, 실제 유니버스로 처음 돌릴 때
> 메모리를 실측한다. 부족하면 그때 `close`/`adjClose` 를 읽는 시점에 number 로 좁히는 것을 검토한다
> (지금 미리 하지 않는다 — 실측 없이는 어느 쪽이 병목인지 모른다).

**Files:**
- Create: `src/backtest/application/replay-backtest.usecase.ts`
- Test: `src/backtest/application/replay-backtest.usecase.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/backtest/application/replay-backtest.usecase.spec.ts`

```ts
import { Prisma } from '@prisma/client';

import { BacktestBar, BacktestTicker } from '../domain/backtest-bar.type';
import { BacktestPrismaRepository } from '../infrastructure/backtest.prisma.repository';
import { ReplayBacktestUsecase } from './replay-backtest.usecase';

const BAR_COUNT = 220;

const buildBars = (
  priceAt: (index: number) => number,
  volumeAt: (index: number) => number,
): BacktestBar[] =>
  Array.from({ length: BAR_COUNT }, (_, index) => {
    const price = priceAt(index);
    return {
      tradeDate: new Date(Date.UTC(2026, 0, 1 + index)),
      open: price,
      close: new Prisma.Decimal(price),
      adjClose: new Prisma.Decimal(price),
      volume: BigInt(volumeAt(index)),
    };
  });

const repositoryOf = (
  tickers: BacktestTicker[],
  bars: Map<number, BacktestBar[]>,
): BacktestPrismaRepository =>
  ({
    findUniverse: jest.fn().mockResolvedValue(tickers),
    findBarsInRange: jest.fn().mockResolvedValue(bars),
    findBenchmarkCloses: jest.fn().mockResolvedValue([]),
  }) as unknown as BacktestPrismaRepository;

describe('ReplayBacktestUsecase', () => {
  const tickers: BacktestTicker[] = [
    { tickerId: 11, code: '000001', name: '꾸준상승', krxMarket: 'KOSPI' },
  ];
  const bars = new Map<number, BacktestBar[]>([
    [11, buildBars((index) => 5000 + index * 32, () => 200_000)],
  ]);

  it('구간을 재생해 체결과 성적을 낸다', async () => {
    const usecase = new ReplayBacktestUsecase(repositoryOf(tickers, bars));

    const result = await usecase.execute({
      strategy: 'LONG_TERM',
      from: '2026-07-01',
      to: '2026-08-07',
      seedAmount: '10000000',
      minimumTurnover60: 5e8,
      maximumPositions: 3,
      weightPercent: 20,
      holdingTradeDays: 5,
    });

    expect(result.filledCount).toBeGreaterThan(0);
    expect(result.invariantViolations).toEqual([]);
    expect(result.finalTotalValue).not.toBeNull();
  });

  it('같은 인자로 두 번 돌리면 완전히 같은 결과가 나온다', async () => {
    const command = {
      strategy: 'LONG_TERM' as const,
      from: '2026-07-01',
      to: '2026-08-07',
      seedAmount: '10000000',
      minimumTurnover60: 5e8,
      maximumPositions: 3,
      weightPercent: 20,
      holdingTradeDays: 5,
    };

    const first = await new ReplayBacktestUsecase(
      repositoryOf(tickers, bars),
    ).execute(command);
    const second = await new ReplayBacktestUsecase(
      repositoryOf(tickers, bars),
    ).execute(command);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('시가가 없는 거래일은 조용히 넘기지 않고 실패로 센다', async () => {
    const holed = new Map<number, BacktestBar[]>([
      [
        11,
        buildBars((index) => 5000 + index * 32, () => 200_000).map((bar) => ({
          ...bar,
          open: null,
        })),
      ],
    ]);
    const usecase = new ReplayBacktestUsecase(repositoryOf(tickers, holed));

    const result = await usecase.execute({
      strategy: 'LONG_TERM',
      from: '2026-07-01',
      to: '2026-08-07',
      seedAmount: '10000000',
      minimumTurnover60: 5e8,
      maximumPositions: 3,
      weightPercent: 20,
      holdingTradeDays: 5,
    });

    expect(result.filledCount).toBe(0);
    expect(result.missingOpenCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm exec jest src/backtest/application/replay-backtest.usecase.spec.ts
```

Expected: FAIL — `Cannot find module './replay-backtest.usecase'`

- [ ] **Step 3: 구현**

`src/backtest/application/replay-backtest.usecase.ts`

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { constrainPaperRecommendation } from '../../agent/paper-recommend/domain/paper-recommendation.constraint';
import { calculateIndicators } from '../../market-data/domain/stock-indicator';
import { RecordPaperTradeUsecase } from '../../paper-trading/application/record-paper-trade.usecase';
import { PaperMarket } from '../../paper-trading/domain/paper-account.type';
import { verifyPaperInvariants } from '../../paper-trading/domain/paper-invariant';
import {
  aggregateRecommendationScores,
  matchRecommendationCycles,
  StrategyRecommendationScore,
} from '../../paper-trading/domain/recommendation-score';
import {
  calculateBenchmarkPerformance,
  ShadowDailyPriceInput,
} from '../../paper-trading/domain/shadow-performance';
import { PaperTradingPrismaRepository } from '../../paper-trading/infrastructure/paper-trading.prisma.repository';
import {
  ScreenCandidate,
  screenStocks,
  ScreenStrategy,
} from '../../screener/domain/screener-rule';
import { BacktestBar } from '../domain/backtest-bar.type';
import { buildBacktestCalendar } from '../domain/backtest-calendar';
import {
  BacktestExpirationRecord,
  BacktestFillRecord,
  BacktestMetricSummary,
  summarizeBacktestMetrics,
} from '../domain/backtest-metric';
import { selectDeterministicRecommendation } from '../domain/top-scored-selection';
import { BacktestPrismaRepository } from '../infrastructure/backtest.prisma.repository';
import { InMemoryPaperLedger } from '../infrastructure/in-memory-paper-ledger';

// 지표는 최대 200봉을 본다. 재생 시작일보다 이만큼 앞선 봉을 미리 읽어 둬야
// 첫날부터 ma120·200일 고점이 계산된다. 달력일 기준 여유를 포함해 400일 앞당긴다.
const WARMUP_CALENDAR_DAYS = 400;
const INDICATOR_BAR_LIMIT = 200;

export interface ReplayBacktestCommand {
  strategy: ScreenStrategy;
  from: string;
  to: string;
  seedAmount: string;
  minimumTurnover60: number;
  maximumPositions: number;
  weightPercent: number;
  holdingTradeDays: number;
}

export interface ReplayBacktestResult {
  strategy: ScreenStrategy;
  from: string;
  to: string;
  tradeDateCount: number;
  orderCount: number;
  filledCount: number;
  expiredCount: number;
  missingOpenCount: number;
  finalCashBalance: string;
  finalTotalValue: string | null;
  finalReturnRate: string | null;
  scores: StrategyRecommendationScore[];
  // 코스피 대비 평균 초과수익. 벤치마크 종가가 없으면 null 이다.
  meanExcessReturnRate: string | null;
  benchmarkUnavailableCount: number;
  metrics: BacktestMetricSummary;
  invariantViolations: string[];
}

interface PendingOrder {
  orderId: number;
  tickerId: number;
  side: 'BUY' | 'SELL';
  quantity: number;
  targetTradeDate: string;
  snapshotClose: number;
}

const dateText = (value: Date): string => value.toISOString().slice(0, 10);

const nextWeekdayText = (dateTextValue: string): string => {
  const cursor = new Date(`${dateTextValue}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dateText(cursor);
};

@Injectable()
export class ReplayBacktestUsecase {
  constructor(private readonly repository: BacktestPrismaRepository) {}

  async execute(
    command: ReplayBacktestCommand,
  ): Promise<ReplayBacktestResult> {
    const tickers = await this.repository.findUniverse();
    const warmupFrom = new Date(`${command.from}T00:00:00.000Z`);
    warmupFrom.setUTCDate(warmupFrom.getUTCDate() - WARMUP_CALENDAR_DAYS);
    const barsByTicker = await this.repository.findBarsInRange(
      tickers.map((ticker) => ticker.tickerId),
      warmupFrom,
      new Date(`${command.to}T00:00:00.000Z`),
    );

    const tradeDateSet = new Set<string>();
    for (const bars of barsByTicker.values()) {
      for (const bar of bars) {
        tradeDateSet.add(dateText(bar.tradeDate));
      }
    }
    const calendar = buildBacktestCalendar({
      from: command.from,
      to: command.to,
      tradeDates: [...tradeDateSet],
    });
    const tradeDateIndex = new Map(
      calendar.tradeDates.map((value, index) => [value, index]),
    );

    const ledger = new InMemoryPaperLedger(command.seedAmount);
    const recordTrade = new RecordPaperTradeUsecase(
      // 대역은 fillPendingOrderAtomically 하나만 구현한다. usecase 가 그것만 쓰므로 안전하다.
      ledger as unknown as PaperTradingPrismaRepository,
    );
    const tickerById = new Map(
      tickers.map((ticker) => [ticker.tickerId, ticker]),
    );
    const fills: BacktestFillRecord[] = [];
    const expirations: BacktestExpirationRecord[] = [];
    const entryTradeDateIndexByTicker = new Map<number, number>();
    let pendingOrders: PendingOrder[] = [];
    let nextOrderId = 1;
    let missingOpenCount = 0;
    let filledCount = 0;
    let expiredCount = 0;

    const allDates = [
      ...new Set([...calendar.recommendDates, ...calendar.tradeDates]),
    ].sort();

    for (const today of allDates) {
      if (tradeDateIndex.has(today)) {
        const stillPending: PendingOrder[] = [];
        for (const order of pendingOrders) {
          if (order.targetTradeDate > today) {
            stillPending.push(order);
            continue;
          }
          const bar = this.findBar(barsByTicker, order.tickerId, today);
          if (!bar || bar.open === null) {
            missingOpenCount += 1;
            expirations.push({
              tradeDate: today,
              statusReason: '시가 없음',
            });
            expiredCount += 1;
            ledger.markOrderStatus(order.orderId, 'EXPIRED');
            continue;
          }
          const ticker = tickerById.get(order.tickerId);
          if (!ticker) {
            continue;
          }
          const valuationBefore = this.valuate(ledger, barsByTicker, today);
          const fill = await recordTrade.executePendingOrder({
            orderId: order.orderId,
            accountId: ledger.accountId,
            tickerId: order.tickerId,
            market: ticker.krxMarket as PaperMarket,
            side: order.side,
            requestedQuantity: String(order.quantity),
            price: String(bar.open),
            tradeDate: today,
            strategy: command.strategy,
          });
          if (fill.status === 'FILLED') {
            filledCount += 1;
            fills.push({
              tradeDate: today,
              filledAmount: Number(fill.quantity) * bar.open,
              accountValuation: valuationBefore,
            });
            if (order.side === 'BUY') {
              entryTradeDateIndexByTicker.set(
                order.tickerId,
                tradeDateIndex.get(today) as number,
              );
            } else {
              entryTradeDateIndexByTicker.delete(order.tickerId);
            }
          } else if (fill.status === 'EXPIRED') {
            expiredCount += 1;
            expirations.push({
              tradeDate: today,
              statusReason: fill.statusReason,
            });
          }
        }
        pendingOrders = stillPending;
      }

      if (!calendar.recommendDates.includes(today)) {
        continue;
      }

      const asOf = this.latestTradeDateOnOrBefore(calendar.tradeDates, today);
      if (asOf === null) {
        continue;
      }
      const candidates = this.buildCandidates(tickers, barsByTicker, asOf);
      const ranked = screenStocks(
        candidates,
        command.strategy,
        candidates.length,
        command.minimumTurnover60,
      );
      const todayIndex = tradeDateIndex.get(asOf) as number;
      const heldPositions = ledger.openPositions().map((position) => {
        const entryIndex =
          entryTradeDateIndexByTicker.get(position.tickerId) ?? todayIndex;
        return {
          code: tickerById.get(position.tickerId)?.code ?? '',
          holdingTradeDays: todayIndex - entryIndex,
        };
      });
      const pendingTickerIds = new Set(
        pendingOrders.map((order) => order.tickerId),
      );
      const recommendation = selectDeterministicRecommendation({
        rankedStocks: ranked.map((stock) => ({
          tickerId: stock.tickerId,
          code: stock.code,
          name: stock.name,
          score: stock.score,
        })),
        heldPositions,
        maximumPositions: command.maximumPositions,
        holdingTradeDays: command.holdingTradeDays,
      });
      const accountValuation = this.valuate(ledger, barsByTicker, asOf);
      const constrained = constrainPaperRecommendation({
        recommendation: {
          sells: recommendation.sells,
          buys: recommendation.buys.map((buy) => ({
            ...buy,
            weightPercent: command.weightPercent,
          })),
        },
        candidates: ranked.map((stock) => ({
          tickerId: stock.tickerId,
          code: stock.code,
          name: stock.name,
          close: stock.indicators.close,
        })),
        positions: ledger.openPositions().map((position) => ({
          tickerId: position.tickerId,
          code: tickerById.get(position.tickerId)?.code ?? '',
          quantity: Number(position.quantity.toString()),
        })),
        cashBalance: Number(ledger.cashBalance.toString()),
        accountValuation,
      });

      const targetTradeDate = nextWeekdayText(today);
      for (const intent of [...constrained.sells, ...constrained.buys]) {
        if (pendingTickerIds.has(intent.tickerId)) {
          continue;
        }
        const snapshotClose =
          ranked.find((stock) => stock.tickerId === intent.tickerId)?.indicators
            .close ?? 0;
        ledger.recordOrder({
          id: nextOrderId,
          accountId: ledger.accountId,
          tickerId: intent.tickerId,
          side: intent.side,
          strategy: command.strategy,
          status: 'PENDING',
          quantity: new Prisma.Decimal(intent.quantity),
        });
        pendingOrders.push({
          orderId: nextOrderId,
          tickerId: intent.tickerId,
          side: intent.side,
          quantity: intent.quantity,
          targetTradeDate,
          snapshotClose,
        });
        pendingTickerIds.add(intent.tickerId);
        nextOrderId += 1;
      }
    }

    const lastTradeDate = calendar.tradeDates.at(-1) ?? null;
    const finalTotalValue =
      lastTradeDate === null
        ? null
        : this.valuate(ledger, barsByTicker, lastTradeDate);
    const violations = verifyPaperInvariants({
      seedAmount: ledger.seedAmount,
      cashBalance: ledger.cashBalance,
      trades: ledger.trades.map((trade) => ({
        side: trade.side,
        quantity: trade.quantity,
        price: trade.price,
        fee: trade.fee,
        tax: trade.tax,
        tickerId: trade.tickerId,
      })),
      positions: ledger.openPositions().map((position) => ({
        tickerId: position.tickerId,
        quantity: position.quantity,
      })),
    });
    const matched = matchRecommendationCycles({
      orders: ledger.orders,
      trades: ledger.trades,
    });

    // 코스피 대비 초과수익은 실전 성적표와 같은 함수로 잰다.
    const benchmarkCloses = await this.repository.findBenchmarkCloses(
      new Date(`${command.from}T00:00:00.000Z`),
      new Date(`${command.to}T00:00:00.000Z`),
    );
    const dailyPrices: ShadowDailyPriceInput[] = [];
    for (const [tickerId, bars] of barsByTicker) {
      const market = tickerById.get(tickerId)?.krxMarket;
      if (market === undefined) {
        continue;
      }
      for (const bar of bars) {
        dailyPrices.push({
          tickerId,
          market: market as PaperMarket,
          tradeDate: bar.tradeDate,
          close: bar.close,
        });
      }
    }
    const benchmark = calculateBenchmarkPerformance({
      cycles: matched.cycles,
      evaluationDate:
        lastTradeDate === null
          ? new Date(`${command.to}T00:00:00.000Z`)
          : new Date(`${lastTradeDate}T00:00:00.000Z`),
      dailyPrices,
      benchmarkCloses,
    });

    return {
      strategy: command.strategy,
      from: command.from,
      to: command.to,
      tradeDateCount: calendar.tradeDates.length,
      orderCount: ledger.orders.length,
      filledCount,
      expiredCount,
      missingOpenCount,
      finalCashBalance: ledger.cashBalance.toString(),
      finalTotalValue:
        finalTotalValue === null ? null : String(finalTotalValue),
      finalReturnRate:
        finalTotalValue === null
          ? null
          : String(
              finalTotalValue / Number(ledger.seedAmount.toString()) - 1,
            ),
      scores: aggregateRecommendationScores(matched),
      meanExcessReturnRate: benchmark.meanExcessReturnRate,
      benchmarkUnavailableCount: benchmark.benchmarkUnavailableCount,
      metrics: summarizeBacktestMetrics({
        fills,
        expirations,
        targetWeightPercent: command.weightPercent,
        maximumPositions: command.maximumPositions,
      }),
      invariantViolations: violations.map((violation) => violation.detail),
    };
  }

  private findBar(
    barsByTicker: Map<number, BacktestBar[]>,
    tickerId: number,
    tradeDate: string,
  ): BacktestBar | null {
    const bars = barsByTicker.get(tickerId) ?? [];
    return (
      bars.find((bar) => dateText(bar.tradeDate) === tradeDate) ?? null
    );
  }

  private latestTradeDateOnOrBefore(
    tradeDates: string[],
    target: string,
  ): string | null {
    let found: string | null = null;
    for (const tradeDate of tradeDates) {
      if (tradeDate <= target) {
        found = tradeDate;
      }
    }
    return found;
  }

  private buildCandidates(
    tickers: { tickerId: number; code: string; name: string; krxMarket: string }[],
    barsByTicker: Map<number, BacktestBar[]>,
    asOf: string,
  ): ScreenCandidate[] {
    const candidates: ScreenCandidate[] = [];
    for (const ticker of tickers) {
      const bars = (barsByTicker.get(ticker.tickerId) ?? []).filter(
        (bar) => dateText(bar.tradeDate) <= asOf,
      );
      if (bars.length === 0) {
        continue;
      }
      // 마지막 봉이 asOf 가 아니면 그 종목은 그날 거래되지 않았다. 지연 가격을 후보에 섞지 않는다.
      if (dateText(bars[bars.length - 1].tradeDate) !== asOf) {
        continue;
      }
      const indicators = calculateIndicators(bars.slice(-INDICATOR_BAR_LIMIT));
      if (indicators === null) {
        continue;
      }
      candidates.push({
        tickerId: ticker.tickerId,
        code: ticker.code,
        name: ticker.name,
        krxMarket: ticker.krxMarket,
        indicators,
      });
    }
    return candidates;
  }

  private valuate(
    ledger: InMemoryPaperLedger,
    barsByTicker: Map<number, BacktestBar[]>,
    asOf: string,
  ): number {
    let total = Number(ledger.cashBalance.toString());
    for (const position of ledger.openPositions()) {
      const bars = (barsByTicker.get(position.tickerId) ?? []).filter(
        (bar) => dateText(bar.tradeDate) <= asOf,
      );
      const latest = bars.at(-1);
      if (!latest) {
        continue;
      }
      total +=
        Number(position.quantity.toString()) * latest.close.toNumber();
    }
    return total;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/backtest/application/replay-backtest.usecase.spec.ts
```

Expected: PASS (3개). 실패하면 합성 봉의 날짜 범위와 `from`/`to` 가 겹치는지 먼저 확인한다 — `buildBars` 는 2026-01-01 부터 220 달력일이므로 8월 초까지 덮는다.

- [ ] **Step 5: 커밋 (사용자 승인 후에만)**

```bash
git add src/backtest/application/
git commit -m "feat(backtest): 추천일·체결일 두 축으로 과거를 재생하는 루프를 추가한다"
```

---

## Task 9: 성적표 포매터

**Files:**
- Create: `src/backtest/infrastructure/backtest.formatter.ts`
- Test: `src/backtest/infrastructure/backtest.formatter.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/backtest/infrastructure/backtest.formatter.spec.ts`

```ts
import { ReplayBacktestResult } from '../application/replay-backtest.usecase';
import { formatBacktestResult } from './backtest.formatter';

const result: ReplayBacktestResult = {
  strategy: 'LONG_TERM',
  from: '2026-01-02',
  to: '2026-08-14',
  tradeDateCount: 152,
  orderCount: 34,
  filledCount: 31,
  expiredCount: 3,
  missingOpenCount: 0,
  finalCashBalance: '2159419',
  finalTotalValue: '10412880',
  finalReturnRate: '0.041288',
  scores: [
    {
      strategy: 'LONG_TERM',
      recommendationCount: 34,
      closedCount: 24,
      openCount: 7,
      expiredCount: 3,
      hitCount: 14,
      hitRate: '0.5833',
      meanReturnRate: '0.024',
      medianReturnRate: '0.011',
      maximumLoss: '-0.113',
      averageHoldingDays: '21',
      anomalyCount: 0,
      realizedPnlMismatchCount: 0,
    },
  ],
  meanExcessReturnRate: '0.037',
  benchmarkUnavailableCount: 0,
  metrics: {
    weightExceededCount: 4,
    maximumWeightPercent: 26.3,
    expirationsByReason: { '현금 부족': 2, '종목 시장 구분 없음': 1 },
    burstFillDayCount: 2,
    maximumFillsInOneDay: 6,
  },
  invariantViolations: [],
};

describe('formatBacktestResult', () => {
  it('기간·승률·비중 초과 경고를 담는다', () => {
    const text = formatBacktestResult(result);

    expect(text).toContain('2026-01-02 ~ 2026-08-14');
    expect(text).toContain('152 거래일');
    expect(text).toContain('58.33%');
    expect(text).toContain('코스피 대비 초과수익 3.70%');
    expect(text).toContain('목표비중 초과 편입 4건');
    expect(text).toContain('최대 26.3%');
  });

  it('불변식 위반이 있으면 경고를 앞세운다', () => {
    const text = formatBacktestResult({
      ...result,
      invariantViolations: ['현금 잔액 불일치: 원장 기준 1원, 실제 2원'],
    });

    expect(text).toContain('불변식 위반');
    expect(text).toContain('현금 잔액 불일치');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm exec jest src/backtest/infrastructure/backtest.formatter.spec.ts
```

Expected: FAIL — `Cannot find module './backtest.formatter'`

- [ ] **Step 3: 구현**

`src/backtest/infrastructure/backtest.formatter.ts`

```ts
import { ReplayBacktestResult } from '../application/replay-backtest.usecase';

const percent = (value: string | null): string =>
  value === null ? '—' : `${(Number(value) * 100).toFixed(2)}%`;

const won = (value: string | null): string =>
  value === null ? '—' : `${Number(value).toLocaleString('ko-KR')}원`;

export const formatBacktestResult = (result: ReplayBacktestResult): string => {
  const lines: string[] = [];

  if (result.invariantViolations.length > 0) {
    lines.push('❌ 불변식 위반 — 아래 성적은 신뢰할 수 없다');
    for (const violation of result.invariantViolations) {
      lines.push(`   ${violation}`);
    }
    lines.push('');
  }

  lines.push(
    `기간 ${result.from} ~ ${result.to} (${result.tradeDateCount} 거래일) · 전략 ${result.strategy}`,
  );
  lines.push('─'.repeat(60));
  const expirationText = Object.entries(result.metrics.expirationsByReason)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(', ');
  lines.push(
    `주문 ${result.orderCount}건 · 체결 ${result.filledCount}건 · 만료 ${result.expiredCount}건` +
      (expirationText === '' ? '' : ` (${expirationText})`),
  );

  for (const score of result.scores) {
    lines.push(
      `승률 ${percent(score.hitRate)}  평균수익률 ${percent(score.meanReturnRate)}  ` +
        `중앙값 ${percent(score.medianReturnRate)}  최대손실 ${percent(score.maximumLoss)}`,
    );
    lines.push(
      `종결 ${score.closedCount}건 · 보유중 ${score.openCount}건 · 평균보유 ${
        score.averageHoldingDays === null
          ? '—'
          : Number(score.averageHoldingDays).toFixed(0)
      }일`,
    );
    if (score.anomalyCount > 0) {
      lines.push(`⚠ 원장 이상 ${score.anomalyCount}건`);
    }
  }

  lines.push(
    `코스피 대비 초과수익 ${percent(result.meanExcessReturnRate)}` +
      (result.benchmarkUnavailableCount > 0
        ? ` (벤치마크 종가 없음 ${result.benchmarkUnavailableCount}건 제외)`
        : ''),
  );
  lines.push(
    `최종 평가액 ${won(result.finalTotalValue)} (${percent(result.finalReturnRate)}) · 현금 ${won(result.finalCashBalance)}`,
  );

  if (result.metrics.weightExceededCount > 0) {
    lines.push(
      `⚠ 목표비중 초과 편입 ${result.metrics.weightExceededCount}건 ` +
        `(최대 ${result.metrics.maximumWeightPercent.toFixed(1)}%)`,
    );
  }
  if (result.metrics.burstFillDayCount > 0) {
    lines.push(
      `⚠ 한 거래일 동시 체결 ${result.metrics.burstFillDayCount}회 ` +
        `(최대 ${result.metrics.maximumFillsInOneDay}종목)`,
    );
  }
  if (result.missingOpenCount > 0) {
    lines.push(
      `⚠ 시가 없는 거래일로 만료된 주문 ${result.missingOpenCount}건 — 재수집이 필요하다`,
    );
  }

  return lines.join('\n');
};
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/backtest/infrastructure/backtest.formatter.spec.ts
```

Expected: PASS (2개)

- [ ] **Step 5: 커밋 (사용자 승인 후에만)**

```bash
git add src/backtest/infrastructure/backtest.formatter.ts src/backtest/infrastructure/backtest.formatter.spec.ts
git commit -m "feat(backtest): 성적표 출력 포매터를 추가한다"
```

---

## Task 10: CLI 파서

**Files:**
- Create: `src/backtest/interface/backtest-cli.parser.ts`
- Test: `src/backtest/interface/backtest-cli.parser.spec.ts`

- [ ] **Step 1: 실패 테스트 작성**

`src/backtest/interface/backtest-cli.parser.spec.ts`

```ts
import { parseBacktestCliArguments } from './backtest-cli.parser';

describe('parseBacktestCliArguments', () => {
  it('필수 인자를 읽고 나머지는 기본값을 채운다', () => {
    const parsed = parseBacktestCliArguments([
      '--strategy',
      'LONG_TERM',
      '--from',
      '2026-01-02',
      '--to',
      '2026-08-14',
    ]);

    expect(parsed).toEqual({
      strategy: 'LONG_TERM',
      from: '2026-01-02',
      to: '2026-08-14',
      seedAmount: '10000000',
      minimumTurnover60: 500000000,
      maximumPositions: 3,
      weightPercent: 20,
      holdingTradeDays: 60,
    });
  });

  it('SWING 의 보유일수 기본값은 5다', () => {
    const parsed = parseBacktestCliArguments([
      '--strategy',
      'SWING',
      '--from',
      '2026-01-02',
      '--to',
      '2026-08-14',
    ]);

    expect(parsed.holdingTradeDays).toBe(5);
  });

  it('전략이 없으면 사용법과 함께 실패한다', () => {
    expect(() =>
      parseBacktestCliArguments(['--from', '2026-01-02', '--to', '2026-08-14']),
    ).toThrow('--strategy');
  });

  it('날짜 형식이 틀리면 실패한다', () => {
    expect(() =>
      parseBacktestCliArguments([
        '--strategy',
        'SWING',
        '--from',
        '20260102',
        '--to',
        '2026-08-14',
      ]),
    ).toThrow('YYYY-MM-DD');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
pnpm exec jest src/backtest/interface/backtest-cli.parser.spec.ts
```

Expected: FAIL — `Cannot find module './backtest-cli.parser'`

- [ ] **Step 3: 구현**

`src/backtest/interface/backtest-cli.parser.ts`

```ts
import { ReplayBacktestCommand } from '../application/replay-backtest.usecase';

export const BACKTEST_CLI_USAGE =
  '사용법:\n' +
  '  pnpm exec ts-node scripts/backtest.ts --strategy LONG_TERM|SWING --from YYYY-MM-DD --to YYYY-MM-DD\n' +
  '                 [--seed <금액>] [--turnover-min <거래대금>] [--max-positions <종목수>]\n' +
  '                 [--weight <비중퍼센트>] [--hold <보유거래일수>]';

const DEFAULT_HOLDING_TRADE_DAYS = { LONG_TERM: 60, SWING: 5 } as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const readOption = (argv: string[], key: string): string | undefined => {
  const index = argv.indexOf(`--${key}`);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${key} 에 값이 필요합니다.\n${BACKTEST_CLI_USAGE}`);
  }
  return value;
};

const readPositiveNumber = (
  argv: string[],
  key: string,
  fallback: number,
): number => {
  const raw = readOption(argv, key);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${key} 는 0보다 큰 수여야 합니다.\n${BACKTEST_CLI_USAGE}`);
  }
  return value;
};

const readDate = (argv: string[], key: string): string => {
  const value = readOption(argv, key);
  if (value === undefined) {
    throw new Error(`--${key} 는 필수입니다.\n${BACKTEST_CLI_USAGE}`);
  }
  if (!DATE_PATTERN.test(value)) {
    throw new Error(
      `--${key} 는 YYYY-MM-DD 형식이어야 합니다. 받은 값: ${value}\n${BACKTEST_CLI_USAGE}`,
    );
  }
  return value;
};

export const parseBacktestCliArguments = (
  argv: string[],
): ReplayBacktestCommand => {
  const strategy = readOption(argv, 'strategy');
  if (strategy !== 'LONG_TERM' && strategy !== 'SWING') {
    throw new Error(
      `--strategy 는 LONG_TERM 또는 SWING 이어야 합니다.\n${BACKTEST_CLI_USAGE}`,
    );
  }
  const seedRaw = readOption(argv, 'seed') ?? '10000000';
  if (!/^\d+$/u.test(seedRaw)) {
    throw new Error(`--seed 는 양의 정수여야 합니다.\n${BACKTEST_CLI_USAGE}`);
  }

  return {
    strategy,
    from: readDate(argv, 'from'),
    to: readDate(argv, 'to'),
    seedAmount: seedRaw,
    minimumTurnover60: readPositiveNumber(argv, 'turnover-min', 500_000_000),
    maximumPositions: readPositiveNumber(argv, 'max-positions', 3),
    weightPercent: readPositiveNumber(argv, 'weight', 20),
    holdingTradeDays: readPositiveNumber(
      argv,
      'hold',
      DEFAULT_HOLDING_TRADE_DAYS[strategy],
    ),
  };
};
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/backtest/interface/backtest-cli.parser.spec.ts
```

Expected: PASS (4개)

- [ ] **Step 5: 커밋 (사용자 승인 후에만)**

```bash
git add src/backtest/interface/
git commit -m "feat(backtest): CLI 인자 파서를 추가한다"
```

---

## Task 11: 모듈과 CLI 진입점

**Files:**
- Create: `src/backtest/backtest.module.ts`
- Create: `scripts/backtest.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: 모듈 작성**

`src/backtest/backtest.module.ts`

```ts
import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ReplayBacktestUsecase } from './application/replay-backtest.usecase';
import { BacktestPrismaRepository } from './infrastructure/backtest.prisma.repository';

// CLI 전용 모듈이다. AppModule 에 등록하지 않는다 — 서버 기동 시 쓸 일이 없다.
@Module({
  imports: [PrismaModule],
  providers: [BacktestPrismaRepository, ReplayBacktestUsecase],
  exports: [ReplayBacktestUsecase],
})
export class BacktestModule {}
```

- [ ] **Step 2: CLI 진입점 작성**

`scripts/backtest.ts` — `scripts/screener.ts` 의 구조를 그대로 따른다.

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { ReplayBacktestUsecase } from '../src/backtest/application/replay-backtest.usecase';
import { BacktestModule } from '../src/backtest/backtest.module';
import { formatBacktestResult } from '../src/backtest/infrastructure/backtest.formatter';
import { parseBacktestCliArguments } from '../src/backtest/interface/backtest-cli.parser';
import { PrismaModule } from '../src/prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    BacktestModule,
  ],
})
class BacktestCliModule {}

const main = async (): Promise<void> => {
  const command = parseBacktestCliArguments(process.argv.slice(2));
  const application =
    await NestFactory.createApplicationContext(BacktestCliModule);
  try {
    const result = await application.get(ReplayBacktestUsecase).execute(command);
    console.log(formatBacktestResult(result));
    if (result.invariantViolations.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await application.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

- [ ] **Step 3: npm script 추가**

`package.json` 의 `scripts` 에 추가한다. 유니버스 전체 봉을 메모리에 올리므로 힙을 넉넉히 준다.

```json
"backtest": "NODE_OPTIONS=--max-old-space-size=4096 ts-node scripts/backtest.ts"
```

- [ ] **Step 4: 실행 확인**

```bash
pnpm backtest --strategy LONG_TERM --from 2026-06-01 --to 2026-08-14
```

Expected: 성적표가 출력된다. DB 가 비어 있으면 `주문 0건 · 체결 0건` 이 나오고 이는 정상이다. `⚠ 시가 없는 거래일로 만료된 주문` 이 나오면 Task 1 Step 10 재수집이 안 끝난 것이다.

- [ ] **Step 5: 사용법 확인**

```bash
pnpm backtest --strategy WRONG --from 2026-06-01 --to 2026-08-14
```

Expected: `--strategy 는 LONG_TERM 또는 SWING 이어야 합니다.` 와 사용법이 출력되고 exit code 가 1

- [ ] **Step 6: 3중 green**

```bash
pnpm lint:check && pnpm test && pnpm build
```

Expected: 3개 모두 exit 0

- [ ] **Step 7: 커밋 (사용자 승인 후에만)**

```bash
git add src/backtest/backtest.module.ts scripts/backtest.ts package.json
git commit -m "feat(backtest): 백테스트 CLI 진입점과 모듈을 추가한다"
```

---

## Task 12: 20% 비중 초과 결함을 검출하는지 확인

설계서 §11 의 요구다. 결함을 고치는 것이 아니라 **백테스트가 그것을 잡아내는지** 확인한다.

**Files:**
- Modify: `src/backtest/application/replay-backtest.usecase.spec.ts`

- [ ] **Step 1: 갭 상승 시나리오 테스트 추가**

`src/backtest/application/replay-backtest.usecase.spec.ts` 에 추가한다.

```ts
it('갭 상승으로 목표 비중을 넘겨 체결되면 지표가 잡아낸다', async () => {
  // 마지막 20봉에서 종가는 완만한데 시가만 크게 뛰는 종목.
  // 주문 수량은 전일 종가로 확정되고 체결은 다음날 시가라 비중이 초과된다.
  const gapped = new Map<number, BacktestBar[]>([
    [
      11,
      buildBars((index) => 5000 + index * 32, () => 200_000).map(
        (bar, index) => ({
          ...bar,
          open:
            index >= BAR_COUNT - 20
              ? Number(bar.close.toString()) * 1.5
              : bar.open,
        }),
      ),
    ],
  ]);
  const usecase = new ReplayBacktestUsecase(repositoryOf(tickers, gapped));

  const result = await usecase.execute({
    strategy: 'LONG_TERM',
    from: '2026-07-20',
    to: '2026-08-07',
    seedAmount: '10000000',
    minimumTurnover60: 5e8,
    maximumPositions: 3,
    weightPercent: 20,
    holdingTradeDays: 60,
  });

  expect(result.metrics.weightExceededCount).toBeGreaterThan(0);
  expect(result.metrics.maximumWeightPercent).toBeGreaterThan(20);
});
```

- [ ] **Step 2: 테스트 실행**

```bash
pnpm exec jest src/backtest/application/replay-backtest.usecase.spec.ts
```

Expected: PASS. 실패하면 재생 루프가 비중을 잘못 재고 있는 것이므로 `fills` 에 싣는 `accountValuation` 이 체결 **직전** 값인지 확인한다.

- [ ] **Step 3: 커밋 (사용자 승인 후에만)**

```bash
git add src/backtest/application/replay-backtest.usecase.spec.ts
git commit -m "test(backtest): 갭 상승 비중 초과를 검출하는지 회귀로 못 박는다"
```

---

## Task 13: 문서 갱신

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md:1 절 표`

- [ ] **Step 1: README 에 명령어 추가**

`README.md` 의 스크립트/명령어 표에 한 줄 추가한다.

```markdown
| `pnpm backtest --strategy LONG_TERM --from 2026-01-02 --to 2026-08-14` | 과거 구간을 재생해 매매 규칙의 성적을 낸다 (DB 읽기 전용) |
```

- [ ] **Step 2: CLAUDE.md 파일 인덱스에 추가**

`CLAUDE.md` 의 §1 표에 추가한다.

```markdown
| 백테스트 재생 루프 | `src/backtest/application/replay-backtest.usecase.ts` |
```

- [ ] **Step 3: 3중 green 최종 확인**

```bash
pnpm lint:check && pnpm test && pnpm build
```

Expected: 3개 모두 exit 0

- [ ] **Step 4: 커밋 (사용자 승인 후에만)**

```bash
git add README.md CLAUDE.md
git commit -m "docs: 백테스트 명령어와 파일 인덱스를 반영한다"
```

---

## 자체 검토 결과

계획을 설계서와 대조해 확인한 사항이다.

| 설계서 항목 | 담당 Task |
|---|---|
| §5.1 LLM 제외, 결정론적 선택 | Task 5 |
| §5.1 보유일수 경과 청산 | Task 5 (`holdingTradeDays`) |
| §5.2 시가 체결, `open` 컬럼 | Task 1 |
| §5.3 실전 usecase 통과 | Task 6, Task 8 |
| §5.4 채점기 재사용 | Task 8 (`matchRecommendationCycles`, `aggregateRecommendationScores`) |
| §8 코스피 초과수익 | Task 3 (`findBenchmarkCloses`), Task 8 (`calculateBenchmarkPerformance`), Task 9 (출력) |
| §6 `open` null 을 실패로 보고 | Task 8 (`missingOpenCount`), Task 9 (경고 출력) |
| §7 추천=평일 / 체결=거래일 | Task 4, Task 8 |
| §8 신규 지표 3종 | Task 7 |
| §10 CLI | Task 10, Task 11 |
| §11 결정론 회귀 | Task 8 Step 1 (두 번 돌려 동일 확인) |
| §11 20% 결함 검출 | Task 12 |
| §12 생존 편향 명시 | Task 3 (`findUniverse` 주석) |

**설계서에 없어 추가한 것:** Task 2 (거래대금 하한 주입). `MINIMUM_TURNOVER60` 이 상수라 `--turnover-min` 이 동작할 수 없었다. 기본값 유지 optional 인자로 열어 기존 호출부는 무변경이다.

**범위 밖으로 남긴 것:** 20% 초과 결함의 **수정**은 설계서 §13 대로 이 계획에 넣지 않았다. Task 12 는 검출까지만 한다.
