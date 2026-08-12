# 3-A 지표 스크리너 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 유니버스 2,599종목의 저장된 일봉에서 지표를 계산해 장투 후보 25종·단타 후보 25종으로 압축하고, CLI로 눈으로 확인할 수 있게 한다.

**Architecture:** 지표 계산과 후보 선정은 `src/screener/domain/`의 순수 함수로 둔다 — 같은 시세에서 항상 같은 결과가 나오므로 저장하지 않고 호출할 때마다 계산한다. 시계열 조회는 2단계가 만든 `MarketDataRepository`에 메서드 하나를 더해 해결하고, `RankCandidatesUsecase`가 조회·계산·선정을 조합한다. LLM은 이 단계에 없다.

**Tech Stack:** NestJS 10, Prisma 6 (PostgreSQL @ 5434), Jest, TypeScript, pnpm 9.15.9

## Global Constraints

- 패키지 매니저는 `pnpm`. `npm`/`yarn` 금지.
- ORM은 Prisma만. raw SQL 금지.
- `process.env` 직접 참조 금지 — `ConfigService.get(...)`.
- 변수명 줄임말 금지: `err`→`error`, `repo`→`repository`, `existing`→`found`.
- `if` 단일 라인이라도 중괄호 필수.
- 인라인 반환 타입 금지 — 별도 `interface`/`type`으로 추출.
- 파일명은 kebab-case + 역할 접미사. 테스트는 `<파일명>.spec.ts`로 소스와 같은 디렉터리.
- **의존 방향은 `screener` → `market-data` 한 방향이다.** `market-data`가 `screener`를 import 하면 안 된다 — 시세 계층은 스크리너보다 아래에 있고, 주가 감시 등 다른 소비자도 쓴다.
- **지표는 `adjClose`(조정가)로 계산하고, 거래대금만 `close`(원본 종가)로 잰다.** `schema.prisma`의 `DailyPrice` 주석이 "지표 계산은 adjClose 를 쓴다"로 못박고 있다. 액면분할이 있으면 원본 종가는 하루 만에 절반으로 떨어져 실제로는 없었던 -50% 수익률이 지표에 박힌다. 반대로 거래대금은 "실제로 얼마어치가 거래됐나"를 묻는 유동성 판정이라 원본 종가라야 한다 — 조정가로 재면 분할 이력이 있는 종목의 과거 구간이 실제보다 작게 나온다.
- 테스트 실행은 `pnpm exec jest <경로>` — `pnpm test -- <경로>`는 jest를 2단계로 돌려서 필터가 먹지 않는다.
- 완료 기준은 `pnpm lint:check && pnpm test && pnpm build` 3중 통과.
- 커밋은 이 worktree(`/Users/juneseok/worktrees/idaeri-paper-recommend`, 브랜치 `feat/paper-trading-phase3`)에서만.
- 이 단계에서 스키마를 바꾸지 않는다. `db:push` 실행 금지.
- **PrismaClient는 이미 생성돼 있다** (`pnpm prisma:generate` 완료, 2026-08-12). baseline `pnpm test`가 exit 0이다. 만약 `Module '"@prisma/client"' has no exported member 'Prisma'` 류의 컴파일 오류로 baseline이 깨져 있으면 구현을 시작하지 말고 보고한다 — pnpm 구조상 생성물은 `node_modules/.pnpm/@prisma+client@*/node_modules/.prisma`에 있고 `node_modules/.prisma`에는 없다.
- **테스트가 `SIGSEGV`로 죽으면 `pnpm rebuild`를 먼저 돌린다.** 새 worktree가 자기 `node_modules`를 받으면 네이티브 모듈이 이 환경에 맞게 빌드돼 있지 않아, 변경과 무관한 suite가 세그폴트로 통째로 실패한다. 테스트 실패가 아니라 실행 자체가 안 된 것이므로 코드를 고치려 들면 안 된다. 2026-08-12에 `auto-flow.handler.spec.ts`와 `generate-test.usecase.spec.ts`에서 실제로 발생했고 `pnpm rebuild` 한 번으로 해소됐다.

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `src/market-data/domain/market-data.type.ts` (수정) | `DailySeriesPoint` 추가 — 계산용 숫자 시계열 점(원본 종가·조정가 둘 다) |
| `src/market-data/infrastructure/market-data.repository.ts` (수정) | `findDailySeries` 추가 |
| `src/screener/domain/indicator.type.ts` (신규) | 지표 출력 타입 |
| `src/screener/domain/indicator.ts` (신규) | 시계열 → 지표값. 순수 함수 |
| `src/screener/domain/candidate-selection.ts` (신규) | 지표 배열 → 전략별 후보. 순수 함수 |
| `src/screener/application/rank-candidates.usecase.ts` (신규) | 조회·계산·선정 조합 |
| `src/screener/infrastructure/candidate.formatter.ts` (신규) | CLI 출력 문자열 |
| `src/screener/screener.module.ts` (수정) | usecase 등록 |
| `scripts/screener.ts` (수정) | `rank` 하위 명령 |

**`DailySeriesPoint`가 왜 `market-data`에 있는가.** 이 타입은 저장된 일봉을 계산용 숫자로 편 것이고, 그 저장소를 소유한 쪽은 `market-data`다. `screener`에 두면 repository가 상위 모듈을 import 하게 되어 의존이 거꾸로 흐른다. 기존 `DailyBar`는 공급자 응답용(`DecimalValue`·`bigint`)이라 그대로 두고, 계산용을 따로 둔다.

---

### Task 1: 지표 계산 도메인

**Files:**
- Modify: `src/market-data/domain/market-data.type.ts` (파일 끝에 타입 추가)
- Create: `src/screener/domain/indicator.type.ts`
- Create: `src/screener/domain/indicator.ts`
- Test: `src/screener/domain/indicator.spec.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수, 외부 의존 없음)
- Produces:
  - `DailySeriesPoint { tradeDate: string; close: number; adjClose: number; volume: number }` — `market-data/domain/market-data.type.ts`
  - `IndicatorValues`, `StockIndicator` — `screener/domain/indicator.type.ts` (아래 Step 3)
  - `calculateIndicator(bars: DailySeriesPoint[]): IndicatorValues | null` — `screener/domain/indicator.ts`
  - `MINIMUM_BAR_COUNT = 121` — 같은 파일

**배경 — 왜 이 지표들인가.** 저장된 일봉에는 종가·조정가·거래량만 있고 시가·고가·저가가 없다. 그래서 모든 지표를 가격과 거래량만으로 만든다. "52주 고가"를 만들지 않고 `high200Position`(200일 최고가 대비 위치)으로 두는 이유는, 토스 캔들 API가 250봉을 요청해도 오류 없이 200봉만 돌려주기 때문이다. 52주는 약 250거래일이므로 52주라고 이름 붙이면 40주짜리 지표가 된다.

**어느 가격을 쓰는가.** 이동평균·수익률·이격도·고가 대비 위치·변동성은 전부 `adjClose`(조정가)로 계산한다. `turnover60`(거래대금)만 `close`(원본 종가)를 쓴다. 이유는 Global Constraints에 적었다 — 요약하면 추세 지표는 분할로 끊기면 안 되고, 유동성은 실제 거래된 금액이라야 한다. `lastClose`는 사람이 보는 값이므로 원본 종가를 싣는다.

**최소 봉 수가 121인 이유.** `ma120`은 120봉이면 계산되지만 `return120`(120거래일 전 대비 수익률)은 121봉이 있어야 한다. 둘 다 만들려면 121이 하한이다. 이 하한에 걸리는 종목은 대부분 신규 상장주다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/screener/domain/indicator.spec.ts`:

```ts
import { DailySeriesPoint } from '../../market-data/domain/market-data.type';
import { calculateIndicator, MINIMUM_BAR_COUNT } from './indicator';

// 기본은 조정가와 원본 종가가 같다. 분할 이력을 재현할 때만 closes 를 따로 준다.
const buildBars = (
  adjCloses: number[],
  volumes?: number[],
  closes?: number[],
): DailySeriesPoint[] =>
  adjCloses.map((adjClose, index) => ({
    tradeDate: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    close: closes?.[index] ?? adjClose,
    adjClose,
    volume: volumes?.[index] ?? 1_000,
  }));

describe('calculateIndicator', () => {
  it('봉이 최소 개수보다 적으면 null을 돌려준다', () => {
    const bars = buildBars(
      Array.from({ length: MINIMUM_BAR_COUNT - 1 }, () => 100),
    );

    expect(calculateIndicator(bars)).toBeNull();
  });

  it('조정가가 0 이하인 봉이 섞이면 null을 돌려준다', () => {
    const adjCloses = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    adjCloses[10] = 0;

    expect(calculateIndicator(buildBars(adjCloses))).toBeNull();
  });

  it('지표는 조정가로 계산하고 거래대금과 표시 종가는 원본 종가로 둔다', () => {
    // 분할 이력이 있는 종목: 조정가는 100 으로 평평하고 원본 종가는 200 이다.
    const adjCloses = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 200);
    const volumes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 3_000);
    const indicator = calculateIndicator(buildBars(adjCloses, volumes, closes));

    // 조정가가 평평하므로 추세 지표는 왜곡이 없다.
    expect(indicator!.ma20).toBe(100);
    expect(indicator!.return120).toBeCloseTo(0, 10);
    expect(indicator!.disparity20).toBeCloseTo(1, 10);
    expect(indicator!.high200Position).toBeCloseTo(1, 10);
    // 거래대금은 실제 체결가 200 × 3,000
    expect(indicator!.turnover60).toBe(600_000);
    // 사람이 보는 값은 원본 종가
    expect(indicator!.lastClose).toBe(200);
  });

  it('이동평균과 정배열·추세를 계산한다', () => {
    // 1부터 121까지 단조 증가 — 최근값이 가장 크므로 모든 이동평균이 정배열이 된다.
    const closes = Array.from(
      { length: MINIMUM_BAR_COUNT },
      (_, index) => index + 1,
    );
    const indicator = calculateIndicator(buildBars(closes));

    expect(indicator).not.toBeNull();
    // 마지막 5봉은 117~121, 평균 119
    expect(indicator!.ma5).toBe(119);
    // 마지막 20봉은 102~121, 평균 111.5
    expect(indicator!.ma20).toBe(111.5);
    expect(indicator!.isAligned).toBe(true);
    expect(indicator!.isUptrend).toBe(true);
    expect(indicator!.lastClose).toBe(121);
    expect(indicator!.barCount).toBe(MINIMUM_BAR_COUNT);
  });

  it('하락 추세에서는 정배열과 중장기 상승이 모두 거짓이다', () => {
    const closes = Array.from(
      { length: MINIMUM_BAR_COUNT },
      (_, index) => MINIMUM_BAR_COUNT - index,
    );
    const indicator = calculateIndicator(buildBars(closes));

    expect(indicator!.isAligned).toBe(false);
    expect(indicator!.isUptrend).toBe(false);
  });

  it('기간 수익률을 계산한다', () => {
    // 121봉 전부 100이고 마지막만 120 → 20·60·120거래일 전 대비 모두 +20%
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    closes[closes.length - 1] = 120;
    const indicator = calculateIndicator(buildBars(closes));

    expect(indicator!.return20).toBeCloseTo(0.2, 10);
    expect(indicator!.return60).toBeCloseTo(0.2, 10);
    expect(indicator!.return120).toBeCloseTo(0.2, 10);
  });

  it('거래량 급증 배수는 최근 5일 평균을 60일 평균으로 나눈 값이다', () => {
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    const volumes = Array.from({ length: MINIMUM_BAR_COUNT }, (_, index) =>
      index >= MINIMUM_BAR_COUNT - 5 ? 1_100 : 100,
    );
    const indicator = calculateIndicator(buildBars(closes, volumes));

    // 최근 5일 평균 1,100 ÷ 최근 60일 평균 ((55×100 + 5×1,100) ÷ 60)
    expect(indicator!.volumeSurge).toBeCloseTo(
      1_100 / ((55 * 100 + 5 * 1_100) / 60),
      10,
    );
  });

  it('60일 평균 거래량이 0이면 급증 배수를 0으로 둔다', () => {
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    const volumes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 0);
    const indicator = calculateIndicator(buildBars(closes, volumes));

    expect(indicator!.volumeSurge).toBe(0);
  });

  it('200일 고가 대비 위치와 20일 이격도를 계산한다', () => {
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    closes[0] = 200;
    const indicator = calculateIndicator(buildBars(closes));

    // 최고 종가 200, 현재가 100
    expect(indicator!.high200Position).toBeCloseTo(0.5, 10);
    // 최근 20봉이 모두 100이라 20일선도 100
    expect(indicator!.disparity20).toBeCloseTo(1, 10);
  });

  it('종가가 일정하면 변동성은 0이다', () => {
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    const indicator = calculateIndicator(buildBars(closes));

    expect(indicator!.volatility20).toBeCloseTo(0, 10);
  });

  it('60일 평균 거래대금은 종가 × 거래량의 평균이다', () => {
    const closes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 100);
    const volumes = Array.from({ length: MINIMUM_BAR_COUNT }, () => 3_000);
    const indicator = calculateIndicator(buildBars(closes, volumes));

    expect(indicator!.turnover60).toBe(300_000);
  });

  it('마지막 봉의 거래일을 그대로 싣는다', () => {
    const bars = buildBars(
      Array.from({ length: MINIMUM_BAR_COUNT }, () => 100),
    );
    const indicator = calculateIndicator(bars);

    expect(indicator!.lastTradeDate).toBe(bars[bars.length - 1].tradeDate);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
cd /Users/juneseok/worktrees/idaeri-paper-recommend
pnpm exec jest src/screener/domain/indicator.spec.ts
```

기대: `Cannot find module './indicator'`로 실패.

- [ ] **Step 3: 시세 도메인에 계산용 시계열 타입 추가**

`src/market-data/domain/market-data.type.ts` 파일 끝에 추가:

```ts
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
```

- [ ] **Step 4: 지표 타입 작성**

`src/screener/domain/indicator.type.ts`:

```ts
// 아래 지표는 turnover60 을 빼고 전부 조정가(adjClose) 기준이다.
export interface IndicatorValues {
  lastTradeDate: string;
  // 사람이 보는 값이라 원본 종가를 싣는다. 계산에는 쓰지 않는다.
  lastClose: number;
  barCount: number;
  ma5: number;
  ma20: number;
  ma60: number;
  ma120: number;
  // ma5 > ma20 > ma60 — 단기가 장기 위에 놓인 상승 배열
  isAligned: boolean;
  // ma60 > ma120 — 중장기 추세가 살아 있는가
  isUptrend: boolean;
  // 현재 조정가 ÷ 20일선. 1보다 크면 20일선 위
  disparity20: number;
  // 최근 5일 평균 거래량 ÷ 60일 평균 거래량
  volumeSurge: number;
  return20: number;
  return60: number;
  return120: number;
  // 현재 조정가 ÷ 200일 최고 조정가. 1에 가까울수록 고점 부근
  high200Position: number;
  // 최근 20일 일간수익률의 표준편차 (연율화하지 않는다)
  volatility20: number;
  // 최근 60일 평균 거래대금 (원본 종가 × 거래량). 유동성 판정이라 조정가를 쓰지 않는다
  turnover60: number;
}

export interface StockIndicator extends IndicatorValues {
  tickerId: number;
  code: string;
  name: string;
  krxMarket: string | null;
}
```

- [ ] **Step 5: 지표 계산 구현**

`src/screener/domain/indicator.ts`:

```ts
import { DailySeriesPoint } from '../../market-data/domain/market-data.type';
import { IndicatorValues } from './indicator.type';

// ma120 은 120봉이면 되지만 return120 은 120거래일 전 봉이 더 필요하다.
export const MINIMUM_BAR_COUNT = 121;

const RETURN_SPANS = [20, 60, 120] as const;
const VOLATILITY_SPAN = 20;
const SURGE_RECENT_SPAN = 5;
const SURGE_BASE_SPAN = 60;
const TURNOVER_SPAN = 60;

const average = (values: number[]): number => {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const movingAverage = (closes: number[], span: number): number => {
  return average(closes.slice(-span));
};

const periodReturn = (closes: number[], span: number): number => {
  const base = closes[closes.length - 1 - span];
  return closes[closes.length - 1] / base - 1;
};

const standardDeviation = (values: number[]): number => {
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
};

const dailyReturns = (closes: number[], span: number): number[] => {
  const window = closes.slice(-(span + 1));
  return window.slice(1).map((close, index) => close / window[index] - 1);
};

export const calculateIndicator = (
  bars: DailySeriesPoint[],
): IndicatorValues | null => {
  if (bars.length < MINIMUM_BAR_COUNT) {
    return null;
  }
  // 추세 지표는 조정가로 계산한다. 원본 종가로 계산하면 액면분할 당일에
  // 실제로는 없었던 급락이 수익률·이동평균에 그대로 박힌다.
  const adjCloses = bars.map((bar) => bar.adjClose);
  // 0 이하 가격은 공급자 오류다. 나눗셈이 Infinity 로 새는 것을 입구에서 막는다.
  if (adjCloses.some((adjClose) => adjClose <= 0)) {
    return null;
  }
  const volumes = bars.map((bar) => bar.volume);
  const lastBar = bars[bars.length - 1];
  const ma5 = movingAverage(adjCloses, 5);
  const ma20 = movingAverage(adjCloses, 20);
  const ma60 = movingAverage(adjCloses, 60);
  const ma120 = movingAverage(adjCloses, 120);
  const baseVolume = average(volumes.slice(-SURGE_BASE_SPAN));
  const [return20, return60, return120] = RETURN_SPANS.map((span) =>
    periodReturn(adjCloses, span),
  );

  return {
    lastTradeDate: lastBar.tradeDate,
    lastClose: lastBar.close,
    barCount: bars.length,
    ma5,
    ma20,
    ma60,
    ma120,
    isAligned: ma5 > ma20 && ma20 > ma60,
    isUptrend: ma60 > ma120,
    disparity20: lastBar.adjClose / ma20,
    volumeSurge:
      baseVolume === 0
        ? 0
        : average(volumes.slice(-SURGE_RECENT_SPAN)) / baseVolume,
    return20,
    return60,
    return120,
    high200Position: lastBar.adjClose / Math.max(...adjCloses),
    volatility20: standardDeviation(dailyReturns(adjCloses, VOLATILITY_SPAN)),
    // 유동성 판정은 실제로 거래된 금액을 물으므로 원본 종가로 잰다.
    turnover60: average(
      bars.slice(-TURNOVER_SPAN).map((bar) => bar.close * bar.volume),
    ),
  };
};
```

- [ ] **Step 6: 테스트를 돌려 통과를 확인한다**

```bash
pnpm exec jest src/screener/domain/indicator.spec.ts
```

기대: 12개 테스트 전부 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/market-data/domain/market-data.type.ts src/screener/domain/indicator.type.ts src/screener/domain/indicator.ts src/screener/domain/indicator.spec.ts
git commit -m "feat(screener): 종가·거래량 일봉에서 이동평균·모멘텀·거래량 지표를 계산한다"
```

---

### Task 2: 후보 선정 규칙

**Files:**
- Create: `src/screener/domain/candidate-selection.ts`
- Test: `src/screener/domain/candidate-selection.spec.ts`

**Interfaces:**
- Consumes: `StockIndicator` (Task 1의 `screener/domain/indicator.type.ts`)
- Produces:
  - `selectLongTermCandidates(indicators: StockIndicator[], limit: number): StockIndicator[]`
  - `selectSwingCandidates(indicators: StockIndicator[], limit: number): StockIndicator[]`
  - `MINIMUM_TURNOVER = 500_000_000`

**배경 — 왜 복합 점수를 만들지 않는가.** 여러 지표에 가중치를 매겨 하나의 점수로 합치면, 나중에 성적이 나빴을 때 지표 선택이 문제인지 가중치가 문제인지 분리할 수 없다. 두 단계 필터는 설명 가능하고 조정도 쉽다.

- 장투: 중장기 추세가 살아 있는 종목(`isUptrend`) 중 6개월 수익률 상위
- 단타: 거래량 급증 상위 100종 중 최근 한 달 수익률 상위

거래대금 하한 5억원은 두 전략 공통이다. 지표상 아무리 좋아도 거래가 거의 없는 종목은 실제로 원하는 수량을 살 수 없다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/screener/domain/candidate-selection.spec.ts`:

```ts
import {
  MINIMUM_TURNOVER,
  selectLongTermCandidates,
  selectSwingCandidates,
} from './candidate-selection';
import { StockIndicator } from './indicator.type';

const buildIndicator = (
  overrides: Partial<StockIndicator> & { code: string },
): StockIndicator => ({
  tickerId: Number(overrides.code),
  name: `종목${overrides.code}`,
  krxMarket: 'KOSPI',
  lastTradeDate: '2026-08-11',
  lastClose: 1_000,
  barCount: 200,
  ma5: 1_000,
  ma20: 1_000,
  ma60: 1_000,
  ma120: 1_000,
  isAligned: false,
  isUptrend: true,
  disparity20: 1,
  volumeSurge: 1,
  return20: 0,
  return60: 0,
  return120: 0,
  high200Position: 1,
  volatility20: 0.01,
  turnover60: MINIMUM_TURNOVER,
  ...overrides,
});

describe('selectLongTermCandidates', () => {
  it('중장기 상승 종목을 120일 수익률 내림차순으로 고른다', () => {
    const indicators = [
      buildIndicator({ code: '000001', return120: 0.1 }),
      buildIndicator({ code: '000002', return120: 0.5 }),
      buildIndicator({ code: '000003', return120: 0.3 }),
    ];

    const selected = selectLongTermCandidates(indicators, 2);

    expect(selected.map((candidate) => candidate.code)).toEqual([
      '000002',
      '000003',
    ]);
  });

  it('중장기 상승이 아닌 종목은 수익률이 높아도 제외한다', () => {
    const indicators = [
      buildIndicator({ code: '000001', return120: 0.9, isUptrend: false }),
      buildIndicator({ code: '000002', return120: 0.1 }),
    ];

    const selected = selectLongTermCandidates(indicators, 5);

    expect(selected.map((candidate) => candidate.code)).toEqual(['000002']);
  });

  it('거래대금 하한 미만은 제외한다', () => {
    const indicators = [
      buildIndicator({
        code: '000001',
        return120: 0.9,
        turnover60: MINIMUM_TURNOVER - 1,
      }),
      buildIndicator({ code: '000002', return120: 0.1 }),
    ];

    const selected = selectLongTermCandidates(indicators, 5);

    expect(selected.map((candidate) => candidate.code)).toEqual(['000002']);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const indicators = [
      buildIndicator({ code: '000001', return120: 0.1 }),
      buildIndicator({ code: '000002', return120: 0.5 }),
    ];

    selectLongTermCandidates(indicators, 2);

    expect(indicators.map((indicator) => indicator.code)).toEqual([
      '000001',
      '000002',
    ]);
  });
});

describe('selectSwingCandidates', () => {
  it('거래량 급증 상위 풀 안에서 20일 수익률 순으로 고른다', () => {
    // 급증 배수 순서와 수익률 순서를 어긋나게 두어 2차 정렬이 도는지 본다.
    const indicators = [
      buildIndicator({ code: '000001', volumeSurge: 5, return20: 0.1 }),
      buildIndicator({ code: '000002', volumeSurge: 4, return20: 0.3 }),
      buildIndicator({ code: '000003', volumeSurge: 3, return20: 0.2 }),
    ];

    const selected = selectSwingCandidates(indicators, 2);

    expect(selected.map((candidate) => candidate.code)).toEqual([
      '000002',
      '000003',
    ]);
  });

  it('급증 상위 100종 밖의 종목은 수익률이 높아도 뽑히지 않는다', () => {
    const pool = Array.from({ length: 100 }, (_, index) =>
      buildIndicator({
        code: String(index + 1).padStart(6, '0'),
        volumeSurge: 100 - index / 1_000,
        return20: 0.01,
      }),
    );
    const outsider = buildIndicator({
      code: '999999',
      volumeSurge: 1,
      return20: 0.9,
    });

    const selected = selectSwingCandidates([...pool, outsider], 5);

    expect(selected.map((candidate) => candidate.code)).not.toContain('999999');
  });

  it('중장기 하락이어도 단타 후보가 될 수 있다', () => {
    const indicators = [
      buildIndicator({
        code: '000001',
        isUptrend: false,
        volumeSurge: 5,
        return20: 0.3,
      }),
    ];

    const selected = selectSwingCandidates(indicators, 5);

    expect(selected.map((candidate) => candidate.code)).toEqual(['000001']);
  });

  it('거래대금 하한 미만은 제외한다', () => {
    const indicators = [
      buildIndicator({
        code: '000001',
        volumeSurge: 9,
        return20: 0.9,
        turnover60: MINIMUM_TURNOVER - 1,
      }),
      buildIndicator({ code: '000002', volumeSurge: 2, return20: 0.1 }),
    ];

    const selected = selectSwingCandidates(indicators, 5);

    expect(selected.map((candidate) => candidate.code)).toEqual(['000002']);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
pnpm exec jest src/screener/domain/candidate-selection.spec.ts
```

기대: `Cannot find module './candidate-selection'`로 실패.

- [ ] **Step 3: 후보 선정 구현**

`src/screener/domain/candidate-selection.ts`:

```ts
import { StockIndicator } from './indicator.type';

// 60일 평균 거래대금 5억원. 지표가 좋아도 이보다 얇으면 원하는 수량을 실제로 살 수 없다.
export const MINIMUM_TURNOVER = 500_000_000;
// 급증 상위에서 이만큼 추린 뒤 모멘텀으로 다시 자른다.
const SURGE_POOL_SIZE = 100;

const isLiquid = (indicator: StockIndicator): boolean => {
  return indicator.turnover60 >= MINIMUM_TURNOVER;
};

export const selectLongTermCandidates = (
  indicators: StockIndicator[],
  limit: number,
): StockIndicator[] => {
  return indicators
    .filter((indicator) => isLiquid(indicator) && indicator.isUptrend)
    .sort((left, right) => right.return120 - left.return120)
    .slice(0, limit);
};

export const selectSwingCandidates = (
  indicators: StockIndicator[],
  limit: number,
): StockIndicator[] => {
  return indicators
    .filter(isLiquid)
    .sort((left, right) => right.volumeSurge - left.volumeSurge)
    .slice(0, SURGE_POOL_SIZE)
    .sort((left, right) => right.return20 - left.return20)
    .slice(0, limit);
};
```

`filter`가 새 배열을 만들기 때문에 뒤따르는 `sort`가 호출자의 배열을 건드리지 않는다.

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
pnpm exec jest src/screener/domain/candidate-selection.spec.ts
```

기대: 8개 테스트 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/screener/domain/candidate-selection.ts src/screener/domain/candidate-selection.spec.ts
git commit -m "feat(screener): 장투는 추세·6개월 수익률로, 단타는 거래량 급증·1개월 수익률로 후보를 추린다"
```

---

### Task 3: 시계열 조회

**Files:**
- Modify: `src/market-data/infrastructure/market-data.repository.ts`
- Test: `src/market-data/infrastructure/market-data.repository.spec.ts` (기존 파일 끝에 describe 추가)

**Interfaces:**
- Consumes: `DailySeriesPoint` (Task 1이 `market-data/domain/market-data.type.ts`에 추가)
- Produces: `MarketDataRepository.findDailySeries(tickerIds: number[], barLimit: number): Promise<Map<number, DailySeriesPoint[]>>` — 종목별 날짜 오름차순 배열

**배경 — 왜 chunk로 나누는가.** 2,599종목 × 200봉이면 약 52만 행이다. 종목별 최근 N개만 뽑는 것을 한 쿼리로 하려면 window function이 필요한데 이 레포는 raw SQL을 쓰지 않는다. 대신 200종목씩 나눠 읽고 코드에서 자른다. 저장 자체가 200봉 상한이라 chunk 하나가 최대 4만 행이다.

- [ ] **Step 1: 실패하는 테스트 작성**

먼저 `src/market-data/infrastructure/market-data.repository.spec.ts` 상단 import를 확인한다. `Prisma`와 `PrismaService`가 없으면 추가한다:

```ts
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
```

파일 맨 아래에 추가:

```ts
describe('MarketDataRepository.findDailySeries', () => {
  it('종목별로 날짜 오름차순 시계열을 돌려준다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-10T00:00:00.000Z'),
        close: new Prisma.Decimal('1000.5'),
        adjClose: new Prisma.Decimal('500.25'),
        volume: BigInt(3_000),
      },
      {
        tickerId: 1,
        tradeDate: new Date('2026-08-11T00:00:00.000Z'),
        close: new Prisma.Decimal('1100'),
        adjClose: new Prisma.Decimal('1100'),
        volume: BigInt(4_000),
      },
      {
        tickerId: 2,
        tradeDate: new Date('2026-08-11T00:00:00.000Z'),
        close: new Prisma.Decimal('500'),
        adjClose: new Prisma.Decimal('500'),
        volume: BigInt(1_000),
      },
    ]);
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    const series = await repository.findDailySeries([1, 2], 200);

    // 조정가가 원본 종가와 다른 행이 섞여도 두 값이 각자 실린다.
    expect(series.get(1)).toEqual([
      {
        tradeDate: '2026-08-10',
        close: 1000.5,
        adjClose: 500.25,
        volume: 3_000,
      },
      { tradeDate: '2026-08-11', close: 1100, adjClose: 1100, volume: 4_000 },
    ]);
    expect(series.get(2)).toEqual([
      { tradeDate: '2026-08-11', close: 500, adjClose: 500, volume: 1_000 },
    ]);
  });

  it('종목별로 최근 barLimit 개만 남긴다', async () => {
    const findMany = jest.fn().mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        tickerId: 1,
        tradeDate: new Date(`2026-08-0${index + 1}T00:00:00.000Z`),
        close: new Prisma.Decimal(String(100 + index)),
        adjClose: new Prisma.Decimal(String(100 + index)),
        volume: BigInt(1_000),
      })),
    );
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    const series = await repository.findDailySeries([1], 2);

    expect(series.get(1)).toEqual([
      { tradeDate: '2026-08-04', close: 103, adjClose: 103, volume: 1_000 },
      { tradeDate: '2026-08-05', close: 104, adjClose: 104, volume: 1_000 },
    ]);
  });

  it('종목이 chunk 크기를 넘으면 나눠 조회한다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    await repository.findDailySeries(
      Array.from({ length: 401 }, (_, index) => index + 1),
      200,
    );

    expect(findMany).toHaveBeenCalledTimes(3);
  });

  it('종목이 없으면 조회하지 않는다', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { dailyPrice: { findMany } } as unknown as PrismaService;
    const repository = new MarketDataRepository(prisma);

    const series = await repository.findDailySeries([], 200);

    expect(series.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
pnpm exec jest src/market-data/infrastructure/market-data.repository.spec.ts
```

기대: `repository.findDailySeries is not a function`으로 새 4개만 실패하고 기존 테스트는 계속 통과.

- [ ] **Step 3: 메서드 구현**

`src/market-data/infrastructure/market-data.repository.ts`:

import 블록에 추가 (같은 디렉터리의 `intraday-guard` import 옆):

```ts
import { DailySeriesPoint } from '../domain/market-data.type';
```

파일 상단 상수 옆에 추가:

```ts
const SERIES_TICKER_CHUNK = 200;
```

`findStoredBarStats` 다음에 메서드 추가:

```ts
  async findDailySeries(
    tickerIds: number[],
    barLimit: number,
  ): Promise<Map<number, DailySeriesPoint[]>> {
    const series = new Map<number, DailySeriesPoint[]>();
    for (
      let offset = 0;
      offset < tickerIds.length;
      offset += SERIES_TICKER_CHUNK
    ) {
      const chunk = tickerIds.slice(offset, offset + SERIES_TICKER_CHUNK);
      const rows = await this.prisma.dailyPrice.findMany({
        where: { tickerId: { in: chunk } },
        orderBy: [{ tickerId: 'asc' }, { tradeDate: 'asc' }],
        select: {
          tickerId: true,
          tradeDate: true,
          close: true,
          adjClose: true,
          volume: true,
        },
      });
      for (const row of rows) {
        const bars = series.get(row.tickerId) ?? [];
        bars.push({
          tradeDate: row.tradeDate.toISOString().slice(0, 10),
          close: row.close.toNumber(),
          adjClose: row.adjClose.toNumber(),
          volume: Number(row.volume),
        });
        series.set(row.tickerId, bars);
      }
    }
    for (const [tickerId, bars] of series) {
      series.set(tickerId, bars.slice(-barLimit));
    }
    return series;
  }
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
pnpm exec jest src/market-data/infrastructure/market-data.repository.spec.ts
```

기대: 기존 테스트 + 새 4개 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/market-data/infrastructure/market-data.repository.ts src/market-data/infrastructure/market-data.repository.spec.ts
git commit -m "feat(market-data): 종목별 일봉 시계열을 chunk 로 나눠 읽는 조회를 더한다"
```

---

### Task 4: 후보 산출 usecase

**Files:**
- Create: `src/screener/application/rank-candidates.usecase.ts`
- Modify: `src/screener/screener.module.ts`
- Test: `src/screener/application/rank-candidates.usecase.spec.ts`

**Interfaces:**
- Consumes: `MarketDataRepository.findUniverseTickers()`(기존), `MarketDataRepository.findDailySeries()`(Task 3), `calculateIndicator`(Task 1), `selectLongTermCandidates`·`selectSwingCandidates`(Task 2)
- Produces:
  - `RankCandidatesOptions { limit?: number }`
  - `RankCandidatesResult { universeCount: number; evaluatedCount: number; skippedCount: number; longTerm: StockIndicator[]; swing: StockIndicator[] }`
  - `RankCandidatesUsecase.execute(options?: RankCandidatesOptions): Promise<RankCandidatesResult>`

**배경 — 왜 결과를 저장하지 않는가.** 지표는 저장된 종가에서 결정론적으로 나온다. 표를 하나 더 만들면 시세가 조정가로 소급 재작성될 때(2단계가 처리하는 경우다) 지표 표가 낡은 채 남는 문제가 생긴다. 매번 계산하면 그 불일치가 존재할 수 없다.

`skippedCount`를 결과에 넣는 이유는, 봉이 모자라 평가에서 빠진 종목 수가 조용히 사라지면 "2,599종목을 다 봤다"고 착각하게 되기 때문이다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/screener/application/rank-candidates.usecase.spec.ts`:

```ts
import { MarketDataRepository } from '../../market-data/infrastructure/market-data.repository';
import { DailySeriesPoint } from '../../market-data/domain/market-data.type';
import { MINIMUM_TURNOVER } from '../domain/candidate-selection';
import { MINIMUM_BAR_COUNT } from '../domain/indicator';
import { RankCandidatesUsecase } from './rank-candidates.usecase';

// 종가 1,000원대 × 이 거래량이면 거래대금 하한 5억을 넘는다.
const LIQUID_VOLUME = MINIMUM_TURNOVER / 1_000;

const buildSeries = (closes: number[]): DailySeriesPoint[] =>
  closes.map((close, index) => ({
    tradeDate: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    close,
    adjClose: close,
    volume: LIQUID_VOLUME,
  }));

// 우상향 — isUptrend 가 참이 된다.
const risingCloses = Array.from(
  { length: MINIMUM_BAR_COUNT },
  (_, index) => 1_000 + index,
);
// 우하향 — isUptrend 가 거짓이 된다.
const fallingCloses = Array.from(
  { length: MINIMUM_BAR_COUNT },
  (_, index) => 1_000 + MINIMUM_BAR_COUNT - index,
);

describe('RankCandidatesUsecase', () => {
  it('유니버스 지표를 계산해 전략별 후보를 돌려준다', async () => {
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '000001',
          name: '오름',
          tossSymbol: '000001',
          krxMarket: 'KOSPI',
        },
        {
          id: 2,
          code: '000002',
          name: '내림',
          tossSymbol: '000002',
          krxMarket: 'KOSDAQ',
        },
      ]),
      findDailySeries: jest.fn().mockResolvedValue(
        new Map([
          [1, buildSeries(risingCloses)],
          [2, buildSeries(fallingCloses)],
        ]),
      ),
    } as unknown as MarketDataRepository;
    const usecase = new RankCandidatesUsecase(repository);

    const result = await usecase.execute();

    expect(result.universeCount).toBe(2);
    expect(result.evaluatedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    // 하락 종목은 isUptrend 가 거짓이라 장투 후보에서 빠진다.
    expect(result.longTerm.map((candidate) => candidate.code)).toEqual([
      '000001',
    ]);
    expect(result.longTerm[0].name).toBe('오름');
    expect(result.longTerm[0].krxMarket).toBe('KOSPI');
  });

  it('봉이 모자란 종목은 평가에서 빼고 건수로 남긴다', async () => {
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '000001',
          name: '오름',
          tossSymbol: '000001',
          krxMarket: 'KOSPI',
        },
        {
          id: 2,
          code: '000002',
          name: '신규',
          tossSymbol: '000002',
          krxMarket: 'KOSDAQ',
        },
      ]),
      findDailySeries: jest.fn().mockResolvedValue(
        new Map([
          [1, buildSeries(risingCloses)],
          [2, buildSeries(risingCloses.slice(0, 10))],
        ]),
      ),
    } as unknown as MarketDataRepository;
    const usecase = new RankCandidatesUsecase(repository);

    const result = await usecase.execute();

    expect(result.evaluatedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it('시세가 아예 없는 종목도 건너뛴다', async () => {
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '000001',
          name: '없음',
          tossSymbol: '000001',
          krxMarket: 'KOSPI',
        },
      ]),
      findDailySeries: jest.fn().mockResolvedValue(new Map()),
    } as unknown as MarketDataRepository;
    const usecase = new RankCandidatesUsecase(repository);

    const result = await usecase.execute();

    expect(result.evaluatedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.longTerm).toEqual([]);
    expect(result.swing).toEqual([]);
  });

  it('limit 을 주면 전략별 후보 수를 제한한다', async () => {
    const tickers = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      code: String(index + 1).padStart(6, '0'),
      name: `종목${index}`,
      tossSymbol: String(index + 1).padStart(6, '0'),
      krxMarket: 'KOSPI',
    }));
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue(tickers),
      findDailySeries: jest
        .fn()
        .mockResolvedValue(
          new Map(
            tickers.map((ticker) => [ticker.id, buildSeries(risingCloses)]),
          ),
        ),
    } as unknown as MarketDataRepository;
    const usecase = new RankCandidatesUsecase(repository);

    const result = await usecase.execute({ limit: 2 });

    expect(result.longTerm).toHaveLength(2);
    expect(result.swing).toHaveLength(2);
  });

  it('유니버스 전체 id 로 시계열을 조회한다', async () => {
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 7,
          code: '000007',
          name: '칠',
          tossSymbol: '000007',
          krxMarket: 'KOSPI',
        },
      ]),
      findDailySeries: jest.fn().mockResolvedValue(new Map()),
    } as unknown as MarketDataRepository;
    const usecase = new RankCandidatesUsecase(repository);

    await usecase.execute();

    expect(repository.findDailySeries).toHaveBeenCalledWith([7], 200);
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
pnpm exec jest src/screener/application/rank-candidates.usecase.spec.ts
```

기대: `Cannot find module './rank-candidates.usecase'`로 실패.

- [ ] **Step 3: usecase 구현**

`src/screener/application/rank-candidates.usecase.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { MarketDataRepository } from '../../market-data/infrastructure/market-data.repository';
import {
  selectLongTermCandidates,
  selectSwingCandidates,
} from '../domain/candidate-selection';
import { calculateIndicator } from '../domain/indicator';
import { StockIndicator } from '../domain/indicator.type';

const DEFAULT_CANDIDATE_LIMIT = 25;
// 토스가 한 번에 주는 상한과 같다. 더 요청해도 저장된 것이 200봉이다.
const SERIES_BAR_LIMIT = 200;

export interface RankCandidatesOptions {
  limit?: number;
}

export interface RankCandidatesResult {
  universeCount: number;
  evaluatedCount: number;
  // 봉이 모자라 평가하지 못한 종목 수. 조용히 사라지면 전종목을 본 것으로 오해한다.
  skippedCount: number;
  longTerm: StockIndicator[];
  swing: StockIndicator[];
}

@Injectable()
export class RankCandidatesUsecase {
  constructor(private readonly repository: MarketDataRepository) {}

  async execute(
    options: RankCandidatesOptions = {},
  ): Promise<RankCandidatesResult> {
    const limit = options.limit ?? DEFAULT_CANDIDATE_LIMIT;
    const universe = await this.repository.findUniverseTickers();
    const series = await this.repository.findDailySeries(
      universe.map((ticker) => ticker.id),
      SERIES_BAR_LIMIT,
    );
    const indicators: StockIndicator[] = [];
    for (const ticker of universe) {
      const values = calculateIndicator(series.get(ticker.id) ?? []);
      if (values === null) {
        continue;
      }
      indicators.push({
        ...values,
        tickerId: ticker.id,
        code: ticker.code,
        name: ticker.name,
        krxMarket: ticker.krxMarket,
      });
    }

    return {
      universeCount: universe.length,
      evaluatedCount: indicators.length,
      skippedCount: universe.length - indicators.length,
      longTerm: selectLongTermCandidates(indicators, limit),
      swing: selectSwingCandidates(indicators, limit),
    };
  }
}
```

- [ ] **Step 4: 모듈에 등록**

`src/screener/screener.module.ts`를 아래로 바꾼다:

```ts
import { Module } from '@nestjs/common';

import { MarketDataModule } from '../market-data/market-data.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CollectUniversePricesUsecase } from './application/collect-universe-prices.usecase';
import { RankCandidatesUsecase } from './application/rank-candidates.usecase';
import { SyncUniverseUsecase } from './application/sync-universe.usecase';

@Module({
  imports: [PrismaModule, MarketDataModule],
  providers: [
    SyncUniverseUsecase,
    CollectUniversePricesUsecase,
    RankCandidatesUsecase,
  ],
  exports: [
    SyncUniverseUsecase,
    CollectUniversePricesUsecase,
    RankCandidatesUsecase,
  ],
})
export class ScreenerModule {}
```

`MarketDataRepository`는 `MarketDataModule`이 이미 export 하고 있다. export 목록에 없다면 추가한다.

- [ ] **Step 5: 테스트를 돌려 통과를 확인한다**

```bash
pnpm exec jest src/screener
```

기대: 신규 5개 포함 `src/screener` 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/screener/application/rank-candidates.usecase.ts src/screener/application/rank-candidates.usecase.spec.ts src/screener/screener.module.ts
git commit -m "feat(screener): 유니버스 지표를 계산해 장투·단타 후보를 산출한다"
```

---

### Task 5: CLI 출력

**Files:**
- Create: `src/screener/infrastructure/candidate.formatter.ts`
- Test: `src/screener/infrastructure/candidate.formatter.spec.ts`
- Modify: `scripts/screener.ts`

**Interfaces:**
- Consumes: `RankCandidatesResult`, `RankCandidatesOptions`, `RankCandidatesUsecase` (Task 4)
- Produces: `formatCandidates(result: RankCandidatesResult): string`

**배경 — 왜 CLI 입구가 필요한가.** cron으로만 도는 기능은 실증 검증 입구가 없어서 결과를 보려면 스케줄 시각까지 기다려야 한다. 1단계가 `scripts/paper-trade.ts evaluate`로 같은 문제를 풀었다. 중요한 것은 CLI가 나중에 autopilot이 부를 것과 **같은 usecase**를 부르는 것이다 — 그래야 검증 경로와 운영 경로가 같다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/screener/infrastructure/candidate.formatter.spec.ts`:

```ts
import { RankCandidatesResult } from '../application/rank-candidates.usecase';
import { StockIndicator } from '../domain/indicator.type';
import { formatCandidates } from './candidate.formatter';

const buildCandidate = (code: string, name: string): StockIndicator => ({
  tickerId: 1,
  code,
  name,
  krxMarket: 'KOSPI',
  lastTradeDate: '2026-08-11',
  lastClose: 239_000,
  barCount: 200,
  ma5: 238_000,
  ma20: 230_000,
  ma60: 220_000,
  ma120: 210_000,
  isAligned: true,
  isUptrend: true,
  disparity20: 1.039,
  volumeSurge: 2.15,
  return20: 0.081,
  return60: 0.152,
  return120: 0.243,
  high200Position: 0.98,
  volatility20: 0.0182,
  turnover60: 812_000_000_000,
});

describe('formatCandidates', () => {
  it('집계와 전략별 후보를 한국어로 출력한다', () => {
    const result: RankCandidatesResult = {
      universeCount: 2_599,
      evaluatedCount: 2_400,
      skippedCount: 199,
      longTerm: [buildCandidate('005930', '삼성전자')],
      swing: [buildCandidate('000660', 'SK하이닉스')],
    };

    const output = formatCandidates(result);

    expect(output).toContain('유니버스 2599종목');
    expect(output).toContain('평가 2400');
    expect(output).toContain('제외 199');
    expect(output).toContain('장투 후보');
    expect(output).toContain('단타 후보');
    expect(output).toContain('005930');
    expect(output).toContain('삼성전자');
    expect(output).toContain('000660');
  });

  it('후보가 없으면 없음을 표시한다', () => {
    const result: RankCandidatesResult = {
      universeCount: 0,
      evaluatedCount: 0,
      skippedCount: 0,
      longTerm: [],
      swing: [],
    };

    const output = formatCandidates(result);

    expect(output).toContain('장투 후보: 없음');
    expect(output).toContain('단타 후보: 없음');
  });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

```bash
pnpm exec jest src/screener/infrastructure/candidate.formatter.spec.ts
```

기대: `Cannot find module './candidate.formatter'`로 실패.

- [ ] **Step 3: formatter 구현**

`src/screener/infrastructure/candidate.formatter.ts`:

```ts
import { RankCandidatesResult } from '../application/rank-candidates.usecase';
import { StockIndicator } from '../domain/indicator.type';

const percent = (ratio: number): string => {
  return `${(ratio * 100).toFixed(1)}%`;
};

const billion = (amount: number): string => {
  return `${(amount / 100_000_000).toFixed(0)}억`;
};

const formatRow = (candidate: StockIndicator, rank: number): string => {
  return [
    String(rank).padStart(2, ' '),
    candidate.code,
    candidate.name.slice(0, 12).padEnd(12, ' '),
    `종가 ${candidate.lastClose.toLocaleString('ko-KR')}`,
    `20일 ${percent(candidate.return20)}`,
    `120일 ${percent(candidate.return120)}`,
    `급증 ${candidate.volumeSurge.toFixed(2)}배`,
    `고가대비 ${percent(candidate.high200Position)}`,
    `거래대금 ${billion(candidate.turnover60)}`,
  ].join('  ');
};

const formatSection = (
  title: string,
  candidates: StockIndicator[],
): string[] => {
  if (candidates.length === 0) {
    return [`${title}: 없음`, ''];
  }
  return [
    `${title} ${candidates.length}종`,
    ...candidates.map((candidate, index) => formatRow(candidate, index + 1)),
    '',
  ];
};

export const formatCandidates = (result: RankCandidatesResult): string => {
  return [
    `유니버스 ${result.universeCount}종목 — 평가 ${result.evaluatedCount}, 제외 ${result.skippedCount}(봉 부족)`,
    '',
    ...formatSection('장투 후보', result.longTerm),
    ...formatSection('단타 후보', result.swing),
  ].join('\n');
};
```

- [ ] **Step 4: 테스트를 돌려 통과를 확인한다**

```bash
pnpm exec jest src/screener/infrastructure/candidate.formatter.spec.ts
```

기대: 2개 테스트 PASS.

- [ ] **Step 5: CLI에 `rank` 명령 추가**

`scripts/screener.ts`를 다섯 곳 고친다. 기존 파일은 `USAGE` 상수 → `Subcommand` 타입 → `parseArguments` → `main` 순서로 되어 있다.

(1) import 블록에 추가:

```ts
import {
  RankCandidatesOptions,
  RankCandidatesUsecase,
} from '../src/screener/application/rank-candidates.usecase';
import { formatCandidates } from '../src/screener/infrastructure/candidate.formatter';
```

(2) `USAGE`에 한 줄 추가:

```ts
const USAGE =
  '사용법:\n' +
  '  pnpm exec ts-node scripts/screener.ts sync-universe\n' +
  '  pnpm exec ts-node scripts/screener.ts collect-prices [--days <봉수>] [--limit <종목수>]\n' +
  '  pnpm exec ts-node scripts/screener.ts rank [--limit <후보수>]';
```

(3) 타입 두 개를 넓힌다:

```ts
type Subcommand = 'sync-universe' | 'collect-prices' | 'rank';

interface ParsedArguments {
  subcommand: Subcommand;
  options: CollectPricesOptions & RankCandidatesOptions;
}
```

`CollectPricesOptions`에 이미 `limit`이 있으므로 교집합 타입에서 충돌하지 않는다.

(4) `parseArguments` 안을 고친다. 현재 하위 명령 검증은 다음 형태다:

```ts
  if (
    subcommandValue !== 'sync-universe' &&
    subcommandValue !== 'collect-prices'
  ) {
    throw new Error(USAGE);
  }
```

이것을 아래로 바꾼다:

```ts
  if (
    subcommandValue !== 'sync-universe' &&
    subcommandValue !== 'collect-prices' &&
    subcommandValue !== 'rank'
  ) {
    throw new Error(USAGE);
  }
```

그리고 `sync-universe` 갈래(옵션을 받지 않고 바로 반환하는 블록) 바로 다음에 `rank` 갈래를 넣는다:

```ts
  if (subcommandValue === 'rank') {
    if (optionValues.length === 0) {
      return { subcommand: subcommandValue, options: {} };
    }
    if (optionValues.length !== 2 || optionValues[0] !== '--limit') {
      throw new Error(USAGE);
    }
    return {
      subcommand: subcommandValue,
      options: { limit: parsePositiveInteger(optionValues[1], 'limit') },
    };
  }
```

(5) `main` 안, `sync-universe` 분기(`return;`으로 끝나는 블록) 다음에 `rank` 분기를 넣는다. 기존 `collect-prices`는 분기 없이 마지막에 실행되므로 그 위에 놓아야 한다:

```ts
    if (parsed.subcommand === 'rank') {
      const result = await application
        .get(RankCandidatesUsecase)
        .execute(parsed.options);
      console.log(formatCandidates(result));
      return;
    }
```

`application.close()`는 기존 `finally` 블록이 처리하므로 따로 부르지 않는다.

- [ ] **Step 6: 실제 데이터로 굴려본다**

```bash
pnpm exec ts-node scripts/screener.ts rank --limit 10
```

기대: 유니버스 집계 한 줄과 장투·단타 각 10종이 출력된다.

**확인할 것:**
- 출력된 종목 코드·이름이 실재하는 종목인가
- 장투 후보의 `120일` 수익률이 내림차순인가
- 단타 후보의 `급증` 배수가 1배를 뚜렷이 넘는가
- `제외` 건수가 `평가` 건수보다 크면 시세 수집이 덜 된 것이다. `pnpm exec ts-node scripts/screener.ts collect-prices`를 먼저 돌린다

하나라도 어긋나면 지표 계산이나 정렬이 틀린 것이다. 넘어가지 말고 원인을 찾는다.

- [ ] **Step 7: 3중 게이트**

```bash
pnpm lint:check && pnpm test && pnpm build
```

기대: 셋 다 exit 0. `pnpm test`는 전체를 돌린다 — 타입 확장이 다른 모듈의 mock을 깨뜨리는 일이 있어 부분 실행으로는 잡히지 않는다.

- [ ] **Step 8: 커밋**

```bash
git add src/screener/infrastructure/candidate.formatter.ts src/screener/infrastructure/candidate.formatter.spec.ts scripts/screener.ts
git commit -m "feat(screener): rank 명령으로 전략별 후보를 눈으로 확인한다"
```

---

## 완료 기준

- `pnpm lint:check && pnpm test && pnpm build` 3중 통과
- `pnpm exec ts-node scripts/screener.ts rank --limit 10`이 실제 데이터로 장투·단타 후보를 출력
- 후보에 든 종목의 지표가 정렬 기준과 일치 (장투는 120일 수익률 내림차순, 단타는 20일 수익률 내림차순)
- `market-data`가 `screener`를 import 하지 않는다 — `grep -rn "screener" src/market-data/`가 빈 결과

## 이 계획에서 하지 않는 것

- autopilot 등록 — 3-B에서 추천과 함께 붙인다. 지표만 매일 계산해봐야 쓰는 곳이 없다
- 지표 결과 저장 — 매번 계산한다
- Slack 발송 — 3-C 리포트 몫
- 스키마 변경 — `PaperOrder.indicatorSnapshot`은 3-B에서 추가한다
