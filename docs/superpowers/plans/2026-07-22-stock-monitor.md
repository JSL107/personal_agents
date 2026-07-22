# 보유 종목 모니터링 (Spec 1) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보유한 국내 주식을 매일 장 마감 후 자동 점검해, 임계값을 넘은 종목이 있을 때만 Slack DM으로 알린다.

**Architecture:** 외부 시세 조회를 `src/market-data/`로 분리하고 포트/어댑터로 감싼다. 판정은 부작용 없는 순수함수로 도메인에 두고, 수집·판정·전달 조립은 autopilot task가 맡는다. LLM은 이 범위에서 사용하지 않는다.

**Tech Stack:** NestJS 10, Prisma 6 (PostgreSQL @ 5434), BullMQ, `yahoo-finance2@^3.15.4`, Jest

**설계 문서:** [2026-07-22-stock-monitor-design.md](../specs/2026-07-22-stock-monitor-design.md)

## Global Constraints

- 패키지 매니저는 `pnpm@9.15.9`. `npm`/`yarn` 사용 금지.
- Node 22 이상. (선행 PR `chore/node-22-upgrade`에서 처리됨. 이 계획은 그 PR이 머지된 뒤 시작한다.)
- ORM은 Prisma만. TypeORM import 금지.
- `process.env` 직접 참조 금지 → `ConfigService.get(...)`. DI 컨텍스트 밖(스크립트)만 예외.
- DB 변경은 `prisma/schema.prisma` 수정 후 `pnpm db:push`. 마이그레이션 파일을 만들지 않는다.
- 금액·수량은 `Decimal @db.Decimal(18,4)`. **`Float` 사용 금지** — 현재 스키마에 Decimal 사용처가 0건이라 관성적으로 Float를 쓰기 쉽다.
- 새 env 추가 시 4곳 동기: `.env.example`, `.env`, `src/config/app.config.ts`, README 표.
- 검증 게이트: `pnpm lint:check && pnpm test && pnpm build` 3중 green. env를 건드리면 `pnpm check:env`도 통과해야 한다.
- 변수명에 줄임말 금지 (`err`→`error`, `repo`→`repository`). `if` 단일 라인도 중괄호 필수. try-catch 안에서는 `return await`.
- 단일 테스트 파일 실행은 `pnpm exec jest src/...` — `pnpm test`는 jest를 2회 실행하는 구조라 경로 필터가 동작하지 않는다.
- 커밋은 각 태스크 끝에서 한다. push와 PR 생성은 하지 않는다.

---

## File Structure

**신규 — 시세 수집 계층** (`src/market-data/`)
- `domain/market-data.type.ts` — `ResolvedInstrument`, `DailyBar`, `MarketCode`
- `domain/port/market-data.port.ts` — `MARKET_DATA_PORT` Symbol, `MarketDataPort` 인터페이스
- `infrastructure/yahoo-finance.mapper.ts` — 라이브러리 응답 → 도메인 타입 변환·검증 (순수함수, 테스트 핵심)
- `infrastructure/yahoo-finance.market-data.client.ts` — 네트워크 호출 + mapper 위임
- `market-data.module.ts`

**신규 — 판정·출력** (`src/agent/stock/`)
- `domain/stock-anomaly.ts` — 판정 순수함수 + 임계값 상수
- `domain/stock-monitor.type.ts` — `HoldingSnapshot`, `StockAnomaly`
- `infrastructure/stock-monitor.formatter.ts` — Slack 문자열 조립
- `infrastructure/stock-monitor.repository.ts` — Prisma 접근
- `stock.module.ts`

**신규 — 스크립트**
- `scripts/register-holding.ts` — 심볼 검증 후 보유 종목 등록

**수정**
- `prisma/schema.prisma` — 모델 4종 추가
- `src/autopilot/infrastructure/tasks/stock-monitor.autopilot-task.ts` (신규)
- `src/autopilot/domain/autopilot.playbook-defaults.ts` — cron 기본값
- `src/autopilot/domain/autopilot.playbook.ts` — 플레이북 항목
- `src/autopilot/autopilot.module.ts` — task 등록
- `src/config/app.config.ts` — env 검증
- `.env.example`, `.env`, `README.md`

판정 로직(`domain/stock-anomaly.ts`)과 출력(`infrastructure/stock-monitor.formatter.ts`)을 분리하는 이유는 `src/autopilot/domain/run-retro.anomaly.ts`가 같은 패턴을 쓰기 때문이다. 순수 판정기는 도메인에, 포맷과 전달은 인프라에 둔다.

---

### Task 1: Prisma 스키마

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: 없음
- Produces: Prisma 모델 `Ticker`, `DailyPrice`, `Holding`, `StockAlert`. 이후 모든 태스크가 `@prisma/client`의 생성 타입을 사용한다.

- [ ] **Step 1: 스키마 추가**

`prisma/schema.prisma` 끝에 추가한다. 기존 모델과 같은 규칙을 따른다 — 필드는 camelCase, 컬럼은 `@map`으로 snake_case, 테이블은 `@@map`.

```prisma
// 보유 종목 모니터링 — 종목 마스터.
// 티커(yahooSymbol)는 상장 이전·티커 변경으로 바뀔 수 있어 PK 로 쓰지 않는다.
// 유니크는 (market, code) — 6자리 코드는 시장이 다르면 중복될 수 있다.
model Ticker {
  id          Int          @id @default(autoincrement())
  code        String
  market      String
  yahooSymbol String       @map("yahoo_symbol")
  name        String
  currency    String
  createdAt   DateTime     @default(now()) @map("created_at")
  updatedAt   DateTime     @updatedAt @map("updated_at")
  dailyPrices DailyPrice[]
  holdings    Holding[]
  alerts      StockAlert[]

  @@unique([market, code])
  @@map("ticker")
}

// 일별 시세. Yahoo 는 액면분할 시 과거 가격을 소급 재작성하므로
// raw close 와 조정가(adjClose)를 모두 보관하고 지표 계산은 adjClose 를 쓴다.
// 재시도·휴장일 재수집으로 같은 거래일이 다시 들어올 수 있어 (tickerId, tradeDate) 로 upsert 한다.
model DailyPrice {
  id             Int      @id @default(autoincrement())
  tickerId       Int      @map("ticker_id")
  ticker         Ticker   @relation(fields: [tickerId], references: [id], onDelete: Cascade)
  tradeDate      DateTime @map("trade_date") @db.Date
  close          Decimal  @db.Decimal(18, 4)
  adjClose       Decimal  @map("adj_close") @db.Decimal(18, 4)
  volume         BigInt
  fetchedAt      DateTime @default(now()) @map("fetched_at")
  lastResyncedAt DateTime? @map("last_resynced_at")

  @@unique([tickerId, tradeDate])
  @@index([tickerId, tradeDate])
  @@map("daily_price")
}

// 보유 상태. 가격 시계열과 달리 소급 복구가 불가능한 데이터라 이력을 남긴다.
// effectiveDate 로 시점을 구분하고, 최신 행이 현재 보유 상태다.
model Holding {
  id            Int      @id @default(autoincrement())
  tickerId      Int      @map("ticker_id")
  ticker        Ticker   @relation(fields: [tickerId], references: [id], onDelete: Cascade)
  quantity      Decimal  @db.Decimal(18, 4)
  avgPrice      Decimal  @map("avg_price") @db.Decimal(18, 4)
  currency      String
  effectiveDate DateTime @map("effective_date") @db.Date
  createdAt     DateTime @default(now()) @map("created_at")

  @@unique([tickerId, effectiveDate])
  @@map("holding")
}

// 알림 발화 이력. 임계값을 나중에 바꿔도 과거 알림의 발생 이유를 재현할 수 있도록
// 규칙 버전과 당시 입력값·임계값을 함께 남긴다.
model StockAlert {
  id             Int      @id @default(autoincrement())
  tickerId       Int      @map("ticker_id")
  ticker         Ticker   @relation(fields: [tickerId], references: [id], onDelete: Cascade)
  tradeDate      DateTime @map("trade_date") @db.Date
  ruleId         String   @map("rule_id")
  ruleVersion    Int      @map("rule_version")
  triggeredValue Decimal  @map("triggered_value") @db.Decimal(18, 4)
  threshold      Decimal  @db.Decimal(18, 4)
  firedAt        DateTime @default(now()) @map("fired_at")

  @@unique([tickerId, tradeDate, ruleId])
  @@index([tickerId, firedAt])
  @@map("stock_alert")
}
```

- [ ] **Step 2: 포맷과 스키마 반영**

```bash
pnpm prisma format
pnpm db:push
pnpm prisma:generate
```

기대: `db:push`가 4개 테이블 생성을 보고하고, `prisma:generate`가 성공한다.

- [ ] **Step 3: 타입 생성 확인**

```bash
pnpm build
```

기대: 성공. (아직 새 코드가 없으므로 스키마만 반영된 상태)

- [ ] **Step 4: 커밋**

```bash
git add prisma/schema.prisma
git commit -m "feat(stock): 보유 종목 모니터링 스키마 추가"
```

---

### Task 2: 도메인 타입과 포트

**Files:**
- Create: `src/market-data/domain/market-data.type.ts`
- Create: `src/market-data/domain/port/market-data.port.ts`

**Interfaces:**
- Consumes: Task 1의 Prisma 타입 (`Prisma.Decimal`)
- Produces: `MarketCode`, `ResolvedInstrument`, `DailyBar`, `MARKET_DATA_PORT`, `MarketDataPort`. Task 3이 구현하고 Task 7이 주입받는다.

- [ ] **Step 1: 도메인 타입 작성**

`src/market-data/domain/market-data.type.ts`:

```ts
import { Prisma } from '@prisma/client';

export type MarketCode = 'KOSPI' | 'KOSDAQ';

// Yahoo 심볼 접미사 ↔ 시장 코드. 접미사를 틀리면 조회가 실패하는 게 아니라
// 다른 종목의 가격이 돌아오므로(설계 §3.1) 매핑을 한 곳에서만 관리한다.
export const MARKET_SUFFIX: Record<MarketCode, string> = {
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

export interface DailyBar {
  tradeDate: Date;
  close: Prisma.Decimal;
  adjClose: Prisma.Decimal;
  volume: bigint;
  currency: string;
}
```

- [ ] **Step 2: 포트 작성**

`src/market-data/domain/port/market-data.port.ts`:

```ts
import { DailyBar, ResolvedInstrument } from '../market-data.type';

export const MARKET_DATA_PORT = Symbol('MARKET_DATA_PORT');

export interface MarketDataPort {
  // 심볼이 실재하고 응답이 오염되지 않았을 때만 종목 정보를 돌려준다.
  // 미존재·오염 응답은 예외가 아니라 null 이다(호출부가 등록을 중단하도록).
  resolveSymbol(yahooSymbol: string): Promise<ResolvedInstrument | null>;

  // 최근 거래일부터 역순으로 days 개의 일봉. 휴장일은 애초에 반환되지 않는다.
  fetchDailyBars(yahooSymbol: string, days: number): Promise<DailyBar[]>;
}
```

- [ ] **Step 3: 컴파일 확인**

```bash
pnpm build
```

기대: 성공.

- [ ] **Step 4: 커밋**

```bash
git add src/market-data/domain
git commit -m "feat(market-data): 시세 조회 포트와 도메인 타입 정의"
```

---

### Task 3: Yahoo 응답 변환·검증 (mapper)

이 태스크가 외부 API 형식 변경을 잡아내는 유일한 자동 방어선이다. 네트워크 호출과 분리해 순수함수로 만들고 실제 응답 모양으로 테스트한다.

**Files:**
- Create: `src/market-data/infrastructure/yahoo-finance.mapper.ts`
- Test: `src/market-data/infrastructure/yahoo-finance.mapper.spec.ts`

**Interfaces:**
- Consumes: Task 2의 `ResolvedInstrument`, `DailyBar`, `MarketCode`
- Produces: `mapQuoteToInstrument(raw, yahooSymbol)`, `mapChartQuoteToDailyBar(raw, currency)`. Task 4가 아니라 Task 5(클라이언트)에서 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/market-data/infrastructure/yahoo-finance.mapper.spec.ts`:

```ts
import {
  mapChartQuoteToDailyBar,
  mapQuoteToInstrument,
} from './yahoo-finance.mapper';

describe('mapQuoteToInstrument', () => {
  it('정상 응답을 종목 정보로 변환한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: 'SamsungElec',
        regularMarketPrice: 273500,
        currency: 'KRW',
        fullExchangeName: 'KSE',
      },
      '005930.KS',
    );

    expect(result).toEqual({
      yahooSymbol: '005930.KS',
      code: '005930',
      market: 'KOSPI',
      name: 'SamsungElec',
      currency: 'KRW',
    });
  });

  it('코스닥 접미사를 KOSDAQ 으로 매핑한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: 'ECOPROBM',
        regularMarketPrice: 111800,
        currency: 'KRW',
        fullExchangeName: 'KOSDAQ',
      },
      '247540.KQ',
    );

    expect(result?.market).toBe('KOSDAQ');
  });

  it('응답이 없으면 null 을 돌려준다', () => {
    expect(mapQuoteToInstrument(undefined, '005930')).toBeNull();
  });

  // 잘못된 접미사를 쓰면 Yahoo 는 예외 대신 shortName 이 심볼·ID 목록인
  // 오염된 응답을 준다. 실측: 005930.KQ → "005930.KQ,0P0000B2XZ,18569122"
  it('shortName 이 콤마 목록인 오염 응답을 거부한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: '005930.KQ,0P0000B2XZ,18569122',
        regularMarketPrice: 84400,
        currency: 'KRW',
        fullExchangeName: 'KOSDAQ',
      },
      '005930.KQ',
    );

    expect(result).toBeNull();
  });

  it('shortName 이 심볼 문자열과 같으면 거부한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: '005930.KQ',
        regularMarketPrice: 84400,
        currency: 'KRW',
        fullExchangeName: 'KOSDAQ',
      },
      '005930.KQ',
    );

    expect(result).toBeNull();
  });

  it('가격이 없으면 거부한다', () => {
    const result = mapQuoteToInstrument(
      { shortName: 'SamsungElec', currency: 'KRW', fullExchangeName: 'KSE' },
      '005930.KS',
    );

    expect(result).toBeNull();
  });

  it('알 수 없는 접미사는 거부한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: 'Apple',
        regularMarketPrice: 327,
        currency: 'USD',
        fullExchangeName: 'NasdaqGS',
      },
      'AAPL',
    );

    expect(result).toBeNull();
  });
});

describe('mapChartQuoteToDailyBar', () => {
  it('정상 봉을 변환한다', () => {
    const result = mapChartQuoteToDailyBar(
      {
        date: new Date('2026-07-21T00:00:00.000Z'),
        close: 273500,
        adjclose: 273500,
        volume: 20380000,
      },
      'KRW',
    );

    expect(result?.tradeDate).toEqual(new Date('2026-07-21T00:00:00.000Z'));
    expect(result?.close.toString()).toBe('273500');
    expect(result?.volume).toBe(20380000n);
    expect(result?.currency).toBe('KRW');
  });

  it('adjclose 가 없으면 close 로 대체한다', () => {
    const result = mapChartQuoteToDailyBar(
      {
        date: new Date('2026-07-21T00:00:00.000Z'),
        close: 100,
        volume: 10,
      },
      'KRW',
    );

    expect(result?.adjClose.toString()).toBe('100');
  });

  it('종가가 없는 봉은 null 이다', () => {
    const result = mapChartQuoteToDailyBar(
      { date: new Date('2026-07-21T00:00:00.000Z'), volume: 10 },
      'KRW',
    );

    expect(result).toBeNull();
  });

  it('날짜가 없는 봉은 null 이다', () => {
    expect(mapChartQuoteToDailyBar({ close: 100, volume: 10 }, 'KRW')).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm exec jest src/market-data/infrastructure/yahoo-finance.mapper.spec.ts
```

기대: FAIL — `Cannot find module './yahoo-finance.mapper'`

- [ ] **Step 3: mapper 구현**

`src/market-data/infrastructure/yahoo-finance.mapper.ts`:

```ts
import { Prisma } from '@prisma/client';

import {
  DailyBar,
  MarketCode,
  ResolvedInstrument,
} from '../domain/market-data.type';

// 라이브러리 응답은 런타임에 형식이 바뀔 수 있어 unknown 으로 받고 여기서만 좁힌다.
interface RawQuote {
  shortName?: string;
  regularMarketPrice?: number;
  currency?: string;
  fullExchangeName?: string;
}

interface RawChartQuote {
  date?: Date;
  close?: number;
  adjclose?: number;
  volume?: number;
}

const SUFFIX_TO_MARKET: Record<string, MarketCode> = {
  '.KS': 'KOSPI',
  '.KQ': 'KOSDAQ',
};

// 잘못된 접미사에 대해 Yahoo 는 예외 대신 shortName 이 "심볼,ID,ID" 형태이거나
// 심볼 문자열 자체인 응답을 준다. 이 두 가지가 오염의 신호다.
const isPollutedName = (name: string, yahooSymbol: string): boolean => {
  if (name === yahooSymbol) {
    return true;
  }
  return name.includes(',');
};

export const mapQuoteToInstrument = (
  raw: RawQuote | undefined | null,
  yahooSymbol: string,
): ResolvedInstrument | null => {
  if (!raw) {
    return null;
  }
  const { shortName, regularMarketPrice, currency } = raw;
  if (!shortName || regularMarketPrice == null || !currency) {
    return null;
  }
  if (isPollutedName(shortName, yahooSymbol)) {
    return null;
  }

  const suffix = yahooSymbol.slice(-3);
  const market = SUFFIX_TO_MARKET[suffix];
  if (!market) {
    return null;
  }

  return {
    yahooSymbol,
    code: yahooSymbol.slice(0, -3),
    market,
    name: shortName,
    currency,
  };
};

export const mapChartQuoteToDailyBar = (
  raw: RawChartQuote | undefined | null,
  currency: string,
): DailyBar | null => {
  if (!raw || !raw.date || raw.close == null) {
    return null;
  }
  const adjClose = raw.adjclose ?? raw.close;
  return {
    tradeDate: raw.date,
    close: new Prisma.Decimal(raw.close),
    adjClose: new Prisma.Decimal(adjClose),
    volume: BigInt(Math.trunc(raw.volume ?? 0)),
    currency,
  };
};
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/market-data/infrastructure/yahoo-finance.mapper.spec.ts
```

기대: PASS — 11개 테스트 모두 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/market-data/infrastructure/yahoo-finance.mapper.ts src/market-data/infrastructure/yahoo-finance.mapper.spec.ts
git commit -m "feat(market-data): Yahoo 응답 변환·검증 mapper — 오염 응답 차단"
```

---

### Task 4: 판정 순수함수

**Files:**
- Create: `src/agent/stock/domain/stock-monitor.type.ts`
- Create: `src/agent/stock/domain/stock-anomaly.ts`
- Test: `src/agent/stock/domain/stock-anomaly.spec.ts`

**Interfaces:**
- Consumes: Task 2의 `DailyBar`
- Produces: `StockAnomaly`, `HoldingSnapshot`, `STOCK_THRESHOLDS`, `detectDailyChange(...)`, `detectAvgPriceBreach(...)`. Task 5(포맷터)와 Task 7(태스크)이 사용한다.

- [ ] **Step 1: 타입 작성**

`src/agent/stock/domain/stock-monitor.type.ts`:

```ts
import { Prisma } from '@prisma/client';

export type StockAnomalyKind = 'DAILY_CHANGE' | 'AVG_PRICE_BREACH';

export interface StockAnomaly {
  tickerName: string;
  yahooSymbol: string;
  kind: StockAnomalyKind;
  ruleId: string;
  ruleVersion: number;
  // 발화를 유발한 실제 값(퍼센트).
  triggeredValue: number;
  // 넘어선 임계값(퍼센트).
  threshold: number;
  detail: string;
}

export interface HoldingSnapshot {
  tickerName: string;
  yahooSymbol: string;
  quantity: Prisma.Decimal;
  avgPrice: Prisma.Decimal;
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/agent/stock/domain/stock-anomaly.spec.ts`:

```ts
import { Prisma } from '@prisma/client';

import { detectAvgPriceBreach, detectDailyChange } from './stock-anomaly';
import { HoldingSnapshot } from './stock-monitor.type';

const bar = (adjClose: number) => ({
  tradeDate: new Date('2026-07-21T00:00:00.000Z'),
  close: new Prisma.Decimal(adjClose),
  adjClose: new Prisma.Decimal(adjClose),
  volume: 100n,
  currency: 'KRW',
});

const holding: HoldingSnapshot = {
  tickerName: 'SamsungElec',
  yahooSymbol: '005930.KS',
  quantity: new Prisma.Decimal(10),
  avgPrice: new Prisma.Decimal(100000),
};

describe('detectDailyChange', () => {
  it('임계값을 넘는 하락에 발화한다', () => {
    const result = detectDailyChange(holding, bar(91), bar(100));

    expect(result?.kind).toBe('DAILY_CHANGE');
    expect(result?.triggeredValue).toBeCloseTo(-9, 4);
  });

  it('임계값을 넘는 상승에 발화한다', () => {
    const result = detectDailyChange(holding, bar(109), bar(100));

    expect(result?.triggeredValue).toBeCloseTo(9, 4);
  });

  it('임계값 미만이면 발화하지 않는다', () => {
    expect(detectDailyChange(holding, bar(105), bar(100))).toBeNull();
  });

  it('경계값(정확히 8%)에서는 발화하지 않는다', () => {
    expect(detectDailyChange(holding, bar(108), bar(100))).toBeNull();
  });

  it('전일 봉이 없으면 판정하지 않는다', () => {
    expect(detectDailyChange(holding, bar(91), null)).toBeNull();
  });
});

describe('detectAvgPriceBreach', () => {
  // 평단 100,000 기준: -20% = 80,000 / +30% = 130,000
  it('하한 구간에 최초 진입하면 발화한다', () => {
    const result = detectAvgPriceBreach(holding, bar(79000), bar(85000));

    expect(result?.kind).toBe('AVG_PRICE_BREACH');
    expect(result?.triggeredValue).toBeCloseTo(-21, 4);
  });

  it('이미 하한 구간에 있었으면 발화하지 않는다', () => {
    expect(detectAvgPriceBreach(holding, bar(79000), bar(78000))).toBeNull();
  });

  it('상한 구간에 최초 진입하면 발화한다', () => {
    const result = detectAvgPriceBreach(holding, bar(131000), bar(125000));

    expect(result?.triggeredValue).toBeCloseTo(31, 4);
  });

  it('구간을 벗어났다가 재진입하면 다시 발화한다', () => {
    expect(detectAvgPriceBreach(holding, bar(79000), bar(81000))).not.toBeNull();
  });

  it('두 구간 모두 밖이면 발화하지 않는다', () => {
    expect(detectAvgPriceBreach(holding, bar(100000), bar(99000))).toBeNull();
  });

  it('전일 봉이 없으면 판정하지 않는다', () => {
    expect(detectAvgPriceBreach(holding, bar(79000), null)).toBeNull();
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
pnpm exec jest src/agent/stock/domain/stock-anomaly.spec.ts
```

기대: FAIL — `Cannot find module './stock-anomaly'`

- [ ] **Step 4: 판정 함수 구현**

`src/agent/stock/domain/stock-anomaly.ts`:

```ts
import { DailyBar } from '../../../market-data/domain/market-data.type';
import { HoldingSnapshot, StockAnomaly } from './stock-monitor.type';

// 임계값 근거는 설계 문서 §5.4 — 최근 250거래일 등락 분포 실측.
// ±5% 는 주 1회 이상 울려 소음이 되고, ±8% 는 월 1.5~2.7회 수준이다.
export const STOCK_THRESHOLDS = {
  dailyChangePercent: 8,
  avgPriceLowerPercent: -20,
  avgPriceUpperPercent: 30,
} as const;

export const DAILY_CHANGE_RULE_VERSION = 1;
export const AVG_PRICE_BREACH_RULE_VERSION = 1;

type Thresholds = typeof STOCK_THRESHOLDS;

const percentChange = (current: DailyBar, base: DailyBar): number => {
  const currentValue = current.adjClose.toNumber();
  const baseValue = base.adjClose.toNumber();
  if (baseValue === 0) {
    return 0;
  }
  return ((currentValue - baseValue) / baseValue) * 100;
};

const percentAgainstAvgPrice = (
  bar: DailyBar,
  holding: HoldingSnapshot,
): number => {
  const avgPrice = holding.avgPrice.toNumber();
  if (avgPrice === 0) {
    return 0;
  }
  return ((bar.adjClose.toNumber() - avgPrice) / avgPrice) * 100;
};

// 전일 대비는 그날 발생한 사건이므로 상태 비교 없이 당일 값만 본다.
export const detectDailyChange = (
  holding: HoldingSnapshot,
  today: DailyBar,
  yesterday: DailyBar | null,
  thresholds: Thresholds = STOCK_THRESHOLDS,
): StockAnomaly | null => {
  if (!yesterday) {
    return null;
  }
  const change = percentChange(today, yesterday);
  if (Math.abs(change) <= thresholds.dailyChangePercent) {
    return null;
  }
  const direction = change > 0 ? '급등' : '급락';
  return {
    tickerName: holding.tickerName,
    yahooSymbol: holding.yahooSymbol,
    kind: 'DAILY_CHANGE',
    ruleId: 'daily-change',
    ruleVersion: DAILY_CHANGE_RULE_VERSION,
    triggeredValue: change,
    threshold: thresholds.dailyChangePercent,
    detail: `전일 대비 ${change.toFixed(1)}% ${direction}`,
  };
};

// 평단 대비는 상태이지 사건이 아니다. 한 번 임계를 넘으면 회복할 때까지 계속
// 임계 밖이므로, 매일 비교하면 같은 사실이 매일 발송된다.
// 따라서 "어제는 구간 밖 → 오늘 구간 안" 인 최초 진입에만 발화한다.
const isBreached = (percent: number, thresholds: Thresholds): boolean => {
  if (percent <= thresholds.avgPriceLowerPercent) {
    return true;
  }
  return percent >= thresholds.avgPriceUpperPercent;
};

export const detectAvgPriceBreach = (
  holding: HoldingSnapshot,
  today: DailyBar,
  yesterday: DailyBar | null,
  thresholds: Thresholds = STOCK_THRESHOLDS,
): StockAnomaly | null => {
  if (!yesterday) {
    return null;
  }
  const todayPercent = percentAgainstAvgPrice(today, holding);
  const yesterdayPercent = percentAgainstAvgPrice(yesterday, holding);
  if (!isBreached(todayPercent, thresholds)) {
    return null;
  }
  if (isBreached(yesterdayPercent, thresholds)) {
    return null;
  }

  const isLower = todayPercent <= thresholds.avgPriceLowerPercent;
  const threshold = isLower
    ? thresholds.avgPriceLowerPercent
    : thresholds.avgPriceUpperPercent;
  const label = isLower ? '손실' : '수익';
  return {
    tickerName: holding.tickerName,
    yahooSymbol: holding.yahooSymbol,
    kind: 'AVG_PRICE_BREACH',
    ruleId: 'avg-price-breach',
    ruleVersion: AVG_PRICE_BREACH_RULE_VERSION,
    triggeredValue: todayPercent,
    threshold,
    detail: `평단 대비 ${todayPercent.toFixed(1)}% ${label} 구간 진입`,
  };
};
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm exec jest src/agent/stock/domain/stock-anomaly.spec.ts
```

기대: PASS — 12개 테스트 모두 통과.

- [ ] **Step 6: 커밋**

```bash
git add src/agent/stock/domain
git commit -m "feat(stock): 판정 순수함수 — 전일대비 급변 + 평단대비 최초 진입"
```

---

### Task 5: Yahoo 클라이언트

**Files:**
- Create: `src/market-data/infrastructure/yahoo-finance.market-data.client.ts`
- Create: `src/market-data/market-data.module.ts`

**Interfaces:**
- Consumes: Task 2의 `MarketDataPort`, Task 3의 mapper 함수
- Produces: `YahooFinanceMarketDataClient` (`MARKET_DATA_PORT`로 제공). Task 7이 주입받는다.

- [ ] **Step 1: 의존성 추가**

```bash
pnpm add yahoo-finance2@^3.15.4
```

기대: `package.json`에 `"yahoo-finance2": "^3.15.4"` 추가. v4는 Node 22를 요구하지만 v3.15.4가 성숙 라인이라 이쪽을 쓴다.

- [ ] **Step 2: 클라이언트 구현**

네트워크 호출만 담당하고 형식 판단은 전부 mapper에 위임한다. 라이브러리는 v3부터 인스턴스화가 필요하며 정적 호출은 실패한다.

`src/market-data/infrastructure/yahoo-finance.market-data.client.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';

import { DailyBar, ResolvedInstrument } from '../domain/market-data.type';
import { MarketDataPort } from '../domain/port/market-data.port';
import {
  mapChartQuoteToDailyBar,
  mapQuoteToInstrument,
} from './yahoo-finance.mapper';

// 일봉 조회 시 달력일 기준으로 여유를 둔다(주말·휴장일에는 봉이 없으므로).
const CALENDAR_DAY_MULTIPLIER = 2;
const CALENDAR_DAY_PADDING = 10;

@Injectable()
export class YahooFinanceMarketDataClient implements MarketDataPort {
  private readonly logger = new Logger(YahooFinanceMarketDataClient.name);
  // v3 부터 정적 호출은 "Call `new YahooFinance()` first" 로 실패한다. 1회 생성해 공유한다.
  private readonly client = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
  });

  async resolveSymbol(yahooSymbol: string): Promise<ResolvedInstrument | null> {
    try {
      const quote = await this.client.quote(yahooSymbol);
      return mapQuoteToInstrument(quote, yahooSymbol);
    } catch (error) {
      this.logger.warn(
        `심볼 조회 실패 — ${yahooSymbol}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async fetchDailyBars(
    yahooSymbol: string,
    days: number,
  ): Promise<DailyBar[]> {
    const period1 = new Date();
    period1.setDate(
      period1.getDate() - (days * CALENDAR_DAY_MULTIPLIER + CALENDAR_DAY_PADDING),
    );

    const chart = await this.client.chart(yahooSymbol, {
      period1,
      interval: '1d',
    });
    const currency = chart.meta?.currency ?? 'KRW';
    const bars = chart.quotes
      .map((quote) => mapChartQuoteToDailyBar(quote, currency))
      .filter((bar): bar is DailyBar => bar !== null);

    return bars.slice(-days);
  }
}
```

- [ ] **Step 3: 모듈 작성**

`src/market-data/market-data.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { MARKET_DATA_PORT } from './domain/port/market-data.port';
import { YahooFinanceMarketDataClient } from './infrastructure/yahoo-finance.market-data.client';

@Module({
  providers: [
    { provide: MARKET_DATA_PORT, useClass: YahooFinanceMarketDataClient },
  ],
  exports: [MARKET_DATA_PORT],
})
export class MarketDataModule {}
```

- [ ] **Step 4: 빌드 확인**

```bash
pnpm build
```

기대: 성공.

- [ ] **Step 5: 실제 조회 스모크 확인**

네트워크를 타므로 `pnpm test`에 넣지 않고 수동으로 한 번만 확인한다.

```bash
pnpm exec ts-node -e "
import { YahooFinanceMarketDataClient } from './src/market-data/infrastructure/yahoo-finance.market-data.client';
(async () => {
  const client = new YahooFinanceMarketDataClient();
  console.log(await client.resolveSymbol('005930.KS'));
  console.log(await client.resolveSymbol('005930.KQ'));
  const bars = await client.fetchDailyBars('005930.KS', 3);
  console.log(bars.map((b) => [b.tradeDate.toISOString().slice(0, 10), b.close.toString()]));
})();
"
```

기대: 첫 줄은 `SamsungElec` / `KOSPI` 객체, 둘째 줄은 `null`(오염 응답 차단 확인), 셋째 줄은 최근 3거래일.

- [ ] **Step 6: 커밋**

```bash
git add package.json pnpm-lock.yaml src/market-data
git commit -m "feat(market-data): Yahoo 시세 클라이언트와 모듈"
```

---

### Task 6: 종목 등록 스크립트

**Files:**
- Create: `scripts/register-holding.ts`

**Interfaces:**
- Consumes: Task 5의 `YahooFinanceMarketDataClient`, Task 1의 Prisma 모델
- Produces: 없음(운영 도구). Task 7이 읽을 `Ticker`/`Holding` 행을 만든다.

슬래시 커맨드를 만들지 않는 이유는 설계 §4에 있다 — 신규 슬래시는 체크리스트 14항목을 요구하는데 종목 서너 개 등록에는 과한 비용이다.

- [ ] **Step 1: 스크립트 작성**

```ts
import { PrismaClient } from '@prisma/client';

import { YahooFinanceMarketDataClient } from '../src/market-data/infrastructure/yahoo-finance.market-data.client';

// 사용법: pnpm exec ts-node scripts/register-holding.ts 005930.KS 68200 10
// 접미사(.KS/.KQ)를 반드시 붙인다. 없거나 틀리면 Yahoo 가 조용히 다른 값을 주므로
// 등록 전에 조회해 종목명을 사람이 확인한다.
const main = async (): Promise<void> => {
  const [yahooSymbol, avgPriceRaw, quantityRaw] = process.argv.slice(2);
  if (!yahooSymbol || !avgPriceRaw || !quantityRaw) {
    console.error(
      '사용법: ts-node scripts/register-holding.ts <심볼> <평단> <수량>\n예: ts-node scripts/register-holding.ts 005930.KS 68200 10',
    );
    process.exit(1);
  }

  const client = new YahooFinanceMarketDataClient();
  const instrument = await client.resolveSymbol(yahooSymbol);
  if (!instrument) {
    console.error(
      `[거부] ${yahooSymbol} 를 확인할 수 없습니다. 접미사(.KS/.KQ)가 맞는지 확인하세요.`,
    );
    process.exit(1);
  }

  console.log(
    `확인 — ${instrument.name} (${instrument.market}, ${instrument.currency})`,
  );

  const prisma = new PrismaClient();
  try {
    const ticker = await prisma.ticker.upsert({
      where: {
        market_code: { market: instrument.market, code: instrument.code },
      },
      create: {
        code: instrument.code,
        market: instrument.market,
        yahooSymbol: instrument.yahooSymbol,
        name: instrument.name,
        currency: instrument.currency,
      },
      update: {
        yahooSymbol: instrument.yahooSymbol,
        name: instrument.name,
      },
    });

    const effectiveDate = new Date();
    effectiveDate.setUTCHours(0, 0, 0, 0);
    await prisma.holding.upsert({
      where: {
        tickerId_effectiveDate: { tickerId: ticker.id, effectiveDate },
      },
      create: {
        tickerId: ticker.id,
        quantity: quantityRaw,
        avgPrice: avgPriceRaw,
        currency: instrument.currency,
        effectiveDate,
      },
      update: { quantity: quantityRaw, avgPrice: avgPriceRaw },
    });

    console.log(
      `등록 완료 — ${instrument.name} 평단 ${avgPriceRaw} × ${quantityRaw}주`,
    );
  } finally {
    await prisma.$disconnect();
  }
};

void main();
```

- [ ] **Step 2: 거부 경로 확인**

```bash
pnpm exec ts-node scripts/register-holding.ts 005930 68200 10
```

기대: `[거부] 005930 를 확인할 수 없습니다.` — 접미사 없는 입력이 저장되지 않는다.

- [ ] **Step 3: 정상 경로 확인**

```bash
pnpm exec ts-node scripts/register-holding.ts 005930.KS 68200 10
```

기대: `확인 — SamsungElec (KOSPI, KRW)` 후 `등록 완료`.

- [ ] **Step 4: 커밋**

```bash
git add scripts/register-holding.ts
git commit -m "feat(stock): 보유 종목 등록 스크립트 — 심볼 검증 게이트"
```

---

### Task 7: 포맷터

**Files:**
- Create: `src/agent/stock/infrastructure/stock-monitor.formatter.ts`
- Test: `src/agent/stock/infrastructure/stock-monitor.formatter.spec.ts`

**Interfaces:**
- Consumes: Task 4의 `StockAnomaly`
- Produces: `formatStockMonitorSummary(anomalies, context)`. Task 8이 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { StockAnomaly } from '../domain/stock-monitor.type';
import { formatStockMonitorSummary } from './stock-monitor.formatter';

const anomaly: StockAnomaly = {
  tickerName: 'SamsungElec',
  yahooSymbol: '005930.KS',
  kind: 'DAILY_CHANGE',
  ruleId: 'daily-change',
  ruleVersion: 1,
  triggeredValue: -9.2,
  threshold: 8,
  detail: '전일 대비 -9.2% 급락',
};

describe('formatStockMonitorSummary', () => {
  it('이상이 없으면 한 줄 하트비트를 만든다', () => {
    const result = formatStockMonitorSummary([], {
      checkedCount: 3,
      lastTradeDate: '2026-07-21',
      failures: [],
      marketClosed: false,
    });

    expect(result).toContain('3종목');
    expect(result).toContain('2026-07-21');
  });

  it('휴장 추정이면 판정 생략을 밝힌다', () => {
    const result = formatStockMonitorSummary([], {
      checkedCount: 3,
      lastTradeDate: '2026-07-21',
      failures: [],
      marketClosed: true,
    });

    expect(result).toContain('휴장');
  });

  it('발화한 종목의 규칙과 값을 담는다', () => {
    const result = formatStockMonitorSummary([anomaly], {
      checkedCount: 3,
      lastTradeDate: '2026-07-21',
      failures: [],
      marketClosed: false,
    });

    expect(result).toContain('SamsungElec');
    expect(result).toContain('-9.2%');
    expect(result).toContain('8%');
  });

  // 정상 침묵과 고장 침묵을 구분하는 것이 이 기능의 핵심 안전장치다.
  it('수집 실패가 있으면 반드시 드러낸다', () => {
    const result = formatStockMonitorSummary([], {
      checkedCount: 2,
      lastTradeDate: '2026-07-21',
      failures: ['247540.KQ: timeout'],
      marketClosed: false,
    });

    expect(result).toContain('수집 실패');
    expect(result).toContain('247540.KQ');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm exec jest src/agent/stock/infrastructure/stock-monitor.formatter.spec.ts
```

기대: FAIL — 모듈을 찾을 수 없음.

- [ ] **Step 3: 포맷터 구현**

```ts
import { StockAnomaly } from '../domain/stock-monitor.type';

export interface StockMonitorContext {
  checkedCount: number;
  lastTradeDate: string;
  failures: string[];
  marketClosed: boolean;
}

export const formatStockMonitorSummary = (
  anomalies: StockAnomaly[],
  context: StockMonitorContext,
): string => {
  const lines: string[] = [];

  if (context.failures.length > 0) {
    lines.push(`⚠️ *주식 모니터링 — 수집 실패 ${context.failures.length}건*`);
    for (const failure of context.failures) {
      lines.push(`• ${failure}`);
    }
  }

  if (context.marketClosed) {
    lines.push(
      `📉 *주식 모니터링* — 휴장(추정), 판정 생략 (마지막 거래일 ${context.lastTradeDate})`,
    );
    return lines.join('\n');
  }

  if (anomalies.length === 0) {
    lines.push(
      `📉 *주식 모니터링* — ${context.checkedCount}종목 이상 없음 (${context.lastTradeDate})`,
    );
    return lines.join('\n');
  }

  lines.push(
    `📉 *주식 모니터링* — ${anomalies.length}건 발화 (${context.lastTradeDate})`,
  );
  for (const anomaly of anomalies) {
    lines.push(
      `• *${anomaly.tickerName}* — ${anomaly.detail} (임계 ${anomaly.threshold}%)`,
    );
  }
  return lines.join('\n');
};
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm exec jest src/agent/stock/infrastructure/stock-monitor.formatter.spec.ts
```

기대: PASS — 4개 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/agent/stock/infrastructure/stock-monitor.formatter.ts src/agent/stock/infrastructure/stock-monitor.formatter.spec.ts
git commit -m "feat(stock): Slack 출력 포맷터 — 수집 실패를 침묵시키지 않음"
```

---

### Task 8: Autopilot task와 배선

**Files:**
- Create: `src/agent/stock/infrastructure/stock-monitor.repository.ts`
- Create: `src/agent/stock/stock.module.ts`
- Create: `src/autopilot/infrastructure/tasks/stock-monitor.autopilot-task.ts`
- Modify: `src/autopilot/domain/autopilot.playbook-defaults.ts`
- Modify: `src/autopilot/domain/autopilot.playbook.ts`
- Modify: `src/autopilot/autopilot.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/config/app.config.ts`, `.env.example`, `.env`, `README.md`

**Interfaces:**
- Consumes: Task 2 `MARKET_DATA_PORT`, Task 4 판정 함수, Task 7 포맷터
- Produces: `StockMonitorAutopilotTask` (id `stock-monitor`)

- [ ] **Step 1: 리포지토리 작성**

```ts
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { HoldingSnapshot } from '../domain/stock-monitor.type';

@Injectable()
export class StockMonitorRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 종목마다 가장 최근 effectiveDate 의 보유 행이 현재 상태다.
  async findCurrentHoldings(): Promise<
    (HoldingSnapshot & { tickerId: number })[]
  > {
    const holdings = await this.prisma.holding.findMany({
      orderBy: { effectiveDate: 'desc' },
      include: { ticker: true },
    });

    const seen = new Set<number>();
    const current: (HoldingSnapshot & { tickerId: number })[] = [];
    for (const holding of holdings) {
      if (seen.has(holding.tickerId)) {
        continue;
      }
      seen.add(holding.tickerId);
      current.push({
        tickerId: holding.tickerId,
        tickerName: holding.ticker.name,
        yahooSymbol: holding.ticker.yahooSymbol,
        quantity: holding.quantity,
        avgPrice: holding.avgPrice,
      });
    }
    return current;
  }

  async upsertDailyPrice(input: {
    tickerId: number;
    tradeDate: Date;
    close: string;
    adjClose: string;
    volume: bigint;
  }): Promise<void> {
    await this.prisma.dailyPrice.upsert({
      where: {
        tickerId_tradeDate: {
          tickerId: input.tickerId,
          tradeDate: input.tradeDate,
        },
      },
      create: input,
      update: {
        close: input.close,
        adjClose: input.adjClose,
        volume: input.volume,
        lastResyncedAt: new Date(),
      },
    });
  }

  async recordAlert(input: {
    tickerId: number;
    tradeDate: Date;
    ruleId: string;
    ruleVersion: number;
    triggeredValue: string;
    threshold: string;
  }): Promise<void> {
    await this.prisma.stockAlert.upsert({
      where: {
        tickerId_tradeDate_ruleId: {
          tickerId: input.tickerId,
          tradeDate: input.tradeDate,
          ruleId: input.ruleId,
        },
      },
      create: input,
      update: {},
    });
  }
}
```

- [ ] **Step 2: autopilot task 작성**

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { StockMonitorRepository } from '../../../agent/stock/infrastructure/stock-monitor.repository';
import { formatStockMonitorSummary } from '../../../agent/stock/infrastructure/stock-monitor.formatter';
import {
  detectAvgPriceBreach,
  detectDailyChange,
} from '../../../agent/stock/domain/stock-anomaly';
import { StockAnomaly } from '../../../agent/stock/domain/stock-monitor.type';
import { DailyBar } from '../../../market-data/domain/market-data.type';
import {
  MARKET_DATA_PORT,
  MarketDataPort,
} from '../../../market-data/domain/port/market-data.port';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 판정에 필요한 최소 봉 수(당일 + 전일). 여유를 두고 5거래일을 받는다.
const REQUIRED_BARS = 5;

@Injectable()
export class StockMonitorAutopilotTask implements AutopilotTask {
  readonly id = 'stock-monitor';
  private readonly logger = new Logger(StockMonitorAutopilotTask.name);

  constructor(
    @Inject(MARKET_DATA_PORT) private readonly marketData: MarketDataPort,
    private readonly repository: StockMonitorRepository,
    private readonly configService: ConfigService,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    const enabled = this.configService.get<string>('STOCK_MONITOR_ENABLED');
    if (enabled !== 'true') {
      return { skip: true };
    }

    const holdings = await this.repository.findCurrentHoldings();
    if (holdings.length === 0) {
      return { skip: true };
    }

    const anomalies: StockAnomaly[] = [];
    const failures: string[] = [];
    let lastTradeDate = '';

    for (const holding of holdings) {
      let bars: DailyBar[] = [];
      try {
        bars = await this.marketData.fetchDailyBars(
          holding.yahooSymbol,
          REQUIRED_BARS,
        );
      } catch (error) {
        failures.push(`${holding.yahooSymbol}: ${(error as Error).message}`);
        continue;
      }

      const today = bars.at(-1);
      const yesterday = bars.at(-2) ?? null;
      if (!today) {
        failures.push(`${holding.yahooSymbol}: 봉 없음`);
        continue;
      }

      const tradeDate = today.tradeDate.toISOString().slice(0, 10);
      if (tradeDate > lastTradeDate) {
        lastTradeDate = tradeDate;
      }

      await this.repository.upsertDailyPrice({
        tickerId: holding.tickerId,
        tradeDate: today.tradeDate,
        close: today.close.toString(),
        adjClose: today.adjClose.toString(),
        volume: today.volume,
      });

      for (const detect of [detectDailyChange, detectAvgPriceBreach]) {
        const anomaly = detect(holding, today, yesterday);
        if (!anomaly) {
          continue;
        }
        anomalies.push(anomaly);
        await this.repository.recordAlert({
          tickerId: holding.tickerId,
          tradeDate: today.tradeDate,
          ruleId: anomaly.ruleId,
          ruleVersion: anomaly.ruleVersion,
          triggeredValue: anomaly.triggeredValue.toFixed(4),
          threshold: anomaly.threshold.toFixed(4),
        });
      }
    }

    this.logger.log(
      `주식 모니터링 — ${holdings.length}종목, 발화 ${anomalies.length}건, 실패 ${failures.length}건`,
    );

    return {
      skip: false,
      summaryText: formatStockMonitorSummary(anomalies, {
        checkedCount: holdings.length - failures.length,
        lastTradeDate: lastTradeDate || '알 수 없음',
        failures,
        marketClosed: false,
      }),
    };
  }
}
```

- [ ] **Step 3: 플레이북 기본값 추가**

`src/autopilot/domain/autopilot.playbook-defaults.ts`에 추가한다. 17:10인 근거는 설계 §5.5 — 국내 시세가 20분 지연되고, 수능일에는 정규장이 16:30에 끝난다.

```ts
export const DEFAULT_STOCK_MONITOR_CRON = '10 17 * * 1-5';
export const DEFAULT_STOCK_MONITOR_TIMEZONE = 'Asia/Seoul';
```

- [ ] **Step 4: 플레이북 항목 등록**

`src/autopilot/domain/autopilot.playbook.ts`의 `AUTOPILOT_PLAYBOOK` 배열에 추가한다. `digestGroup`은 지정하지 않는다 — 같은 그룹은 스케줄·타임존 일치가 강제되는데 이 항목은 고유 시각을 쓴다.

```ts
  {
    id: 'stock-monitor',
    taskId: 'stock-monitor',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_STOCK_MONITOR_CRON,
      timezone: DEFAULT_STOCK_MONITOR_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
```

import 문에도 두 상수를 추가한다.

- [ ] **Step 5: 모듈 배선**

`src/agent/stock/stock.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { MarketDataModule } from '../../market-data/market-data.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { StockMonitorRepository } from './infrastructure/stock-monitor.repository';

@Module({
  imports: [PrismaModule, MarketDataModule],
  providers: [StockMonitorRepository],
  exports: [StockMonitorRepository],
})
export class StockModule {}
```

`src/autopilot/autopilot.module.ts`에서 `StockModule`과 `MarketDataModule`을 import하고, `StockMonitorAutopilotTask`를 providers와 `AUTOPILOT_TASKS` 배열에 추가한다. 기존 task 등록 방식을 그대로 따른다.

`src/app.module.ts`에 `StockModule`을 등록한다.

- [ ] **Step 6: env 4곳 동기화**

`.env.example`과 `.env`:

```
# 주식 모니터링 — 기본 비활성. 보유 종목 등록 후 true 로 켠다.
STOCK_MONITOR_ENABLED=false
```

`src/config/app.config.ts`에 class-validator 필드를 추가한다. 기존 optional boolean-like 필드와 같은 방식으로 `@IsOptional()` + `@IsIn(['true', 'false'])`를 쓴다.

README의 env 표에 한 행을 추가한다.

- [ ] **Step 7: 전체 게이트 확인**

```bash
pnpm check:env
pnpm lint:check
pnpm test
pnpm build
```

기대: 4개 모두 통과. `check:env`가 `STOCK_MONITOR_ENABLED`를 문서화된 것으로 인식해야 한다.

- [ ] **Step 8: 커밋**

```bash
git add src/agent/stock src/autopilot src/app.module.ts src/config/app.config.ts .env.example README.md
git commit -m "feat(stock): 보유 종목 모니터링 cron 태스크 등록"
```

---

### Task 9: 휴장일 판정

수집한 마지막 거래일이 직전 실행과 같으면 휴장으로 보고 판정을 건너뛴다. 이 처리가 없으면 휴장일에 전일 대비가 0%로 계산되어 "이상 없음"이 나가고, 사용자는 시스템이 정상 동작한 것으로 오인한다.

**Files:**
- Modify: `src/agent/stock/infrastructure/stock-monitor.repository.ts`
- Modify: `src/autopilot/infrastructure/tasks/stock-monitor.autopilot-task.ts`
- Test: `src/agent/stock/domain/stock-anomaly.spec.ts` (케이스 추가)

**Interfaces:**
- Consumes: Task 8의 리포지토리·태스크
- Produces: `isMarketClosed(latestBarDate, previousStoredDate)` 순수함수

- [ ] **Step 1: 실패하는 테스트 추가**

`src/agent/stock/domain/stock-anomaly.spec.ts` 끝에 추가한다.

```ts
describe('isMarketClosed', () => {
  it('마지막 봉 날짜가 직전 저장분과 같으면 휴장으로 본다', () => {
    expect(
      isMarketClosed(new Date('2026-07-21'), new Date('2026-07-21')),
    ).toBe(true);
  });

  it('새 거래일이면 휴장이 아니다', () => {
    expect(
      isMarketClosed(new Date('2026-07-22'), new Date('2026-07-21')),
    ).toBe(false);
  });

  it('직전 저장분이 없으면 휴장이 아니다(최초 실행)', () => {
    expect(isMarketClosed(new Date('2026-07-21'), null)).toBe(false);
  });
});
```

파일 상단 import에 `isMarketClosed`를 추가한다.

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm exec jest src/agent/stock/domain/stock-anomaly.spec.ts
```

기대: FAIL — `isMarketClosed is not a function`

- [ ] **Step 3: 구현**

`src/agent/stock/domain/stock-anomaly.ts`에 추가한다.

```ts
// 휴장일에는 새 봉이 생기지 않는다. 별도 휴장일 캘린더를 두지 않고
// "마지막 봉이 직전 실행 때와 같은 날짜인가" 로 판정한다.
// 임시공휴일처럼 사전에 알 수 없는 휴장도 이 방식이면 자동으로 처리된다.
export const isMarketClosed = (
  latestBarDate: Date,
  previousStoredDate: Date | null,
): boolean => {
  if (!previousStoredDate) {
    return false;
  }
  return (
    latestBarDate.toISOString().slice(0, 10) ===
    previousStoredDate.toISOString().slice(0, 10)
  );
};
```

- [ ] **Step 4: 리포지토리에 조회 추가**

```ts
  async findLatestStoredTradeDate(tickerId: number): Promise<Date | null> {
    const latest = await this.prisma.dailyPrice.findFirst({
      where: { tickerId },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    return latest?.tradeDate ?? null;
  }
```

- [ ] **Step 5: 태스크에 반영**

`stock-monitor.autopilot-task.ts`에서 종목별 루프에 들어가기 전 첫 종목의 직전 저장 거래일을 조회하고, `isMarketClosed`가 참이면 판정과 저장을 건너뛴 뒤 `marketClosed: true`로 포맷한다.

- [ ] **Step 6: 테스트 통과 확인**

```bash
pnpm exec jest src/agent/stock/domain/stock-anomaly.spec.ts
pnpm lint:check && pnpm test && pnpm build
```

기대: 전부 통과.

- [ ] **Step 7: 커밋**

```bash
git add src/agent/stock src/autopilot
git commit -m "feat(stock): 휴장일을 데이터로 판정 — 캘린더 없이 오탐 방지"
```

---

## 완료 후 수동 확인

구현이 끝나면 다음을 실제로 확인한다. 자동 테스트로는 증명되지 않는 것들이다.

1. 보유 종목을 등록하고 `STOCK_MONITOR_ENABLED=true`로 켠 뒤, 3거래일 연속 지정 시각에 DM이 오는지.
2. 알림에 실린 종가와 평단 대비 손익이 증권사 앱 화면과 일치하는지.
3. 일부러 잘못된 심볼(`005930.KQ`)로 등록을 시도했을 때 거부되는지.
4. 네트워크를 끊고 실행했을 때 침묵하지 않고 수집 실패 알림이 오는지.

설계 §8에 적힌 미확인 항목(시간외단일가 반영 여부, 휴장일 응답 형태)도 이 시점에 함께 관찰한다.
