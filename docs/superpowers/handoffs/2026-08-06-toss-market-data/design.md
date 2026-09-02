# 구현 계약 — 시세 소스 Yahoo Finance → 토스증권

Base: `origin/main` @ `eeadb70`. Branch: `feat/toss-market-data`.
선행 설계: `docs/superpowers/specs/2026-08-06-toss-market-data-migration-design.md`.

이 문서는 **source of truth** 다. 여기 적힌 API 응답 규격은 2026-08-06 직접 호출로 실측한 값이며
추측이 아니다. 규격을 유추·확장하지 말 것 — 실측에 없는 필드는 없다고 가정한다.

---

## 1. 왜

`ticker.yahoo_symbol` 이 6종목 전부 비어 있어 `stock-monitor.repository.ts:51` 이 감시 대상에서
전부 건너뛴다 → 감시 0건. 잔고 동기화는 `toss_symbol` 만 채운다. 시세를 토스로 옮겨 종목 식별을
단일 출처로 만든다.

## 2. 실측 API 규격 (2026-08-06 직접 호출, 전부 확인됨)

Base URL `https://openapi.tossinvest.com`. 인증은 기존 `TossInvestClient` 와 동일한
client_credentials → Bearer.

### 2.1 일봉 `GET /api/v1/candles?symbol={s}&interval=1d&count={n}`

국내·미국이 **같은 경로·같은 파라미터**로 동작한다. `symbol` 에 국내는 6자리 코드(`483280`),
미국은 티커(`PFE`, `SPYM`)를 그대로 넣는다. 접미사·시장 구분자 없음.

```json
{ "result": {
    "candles": [
      { "timestamp": "2026-08-06T00:00:00.000+09:00", "openPrice": "12290",
        "highPrice": "12370", "lowPrice": "12230", "closePrice": "12255",
        "volume": "70940", "currency": "KRW" }
    ],
    "nextBefore": "2026-08-03T00:00:00.000+09:00" } }
```

확정 사실:

- `interval` 허용값은 `["1m", "1d"]` 뿐
- **`count` 상한은 200** (`min:1, max:200` — 초과 시 HTTP 400 `invalid-request`)
- 모든 수치가 **문자열** → `Prisma.Decimal` 에 그대로 넘긴다
- **응답은 최신 → 과거 역순** (Yahoo 와 반대)
- `timestamp` 는 KST 오프셋 표기지만 **거래일 자정 기준**이다
  - 국내: `2026-08-06T00:00:00.000+09:00` (KST 자정)
  - 미국: `2026-08-06T13:00:00.000+09:00` (여름·EDT) / `...T14:00:00.000+09:00` (겨울·EST)
    → 둘 다 **ET 자정**이다. 즉 **문자열 앞 10자가 그 시장의 거래일**이다

### 2.2 현재가 `GET /api/v1/prices?symbols={a,b}`

파라미터가 `symbol` 이 아니라 **`symbols`**(복수). `result` 가 **배열 그 자체**.
이번 작업에서는 쓰지 않는다(일봉으로 충분).

### 2.3 종목정보 `GET /api/v1/stocks?symbols={s}`

`result` 가 **배열 그 자체**. `market` 은 `KOSPI` / `NYSE` / `AMEX` 등.
이번 작업에서는 쓰지 않는다(§4.4 참조).

### 2.4 응답 봉투가 엔드포인트마다 다르다 — 유추 금지

| 엔드포인트 | `result` 아래 |
|---|---|
| `/accounts`, `/prices`, `/stocks` | 배열 그 자체 |
| `/holdings` | 객체 → `items` 배열 |
| `/candles` | 객체 → `candles` 배열 |

### 2.5 레이트리밋 — 실측 확인

`MARKET_DATA_CHART` = **5회/초**. 무간격 연속 호출 시 **6번째부터 HTTP 429**:

```json
{"error":{"code":"rate-limit-exceeded","message":"요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."}}
```

250ms 간격 6회는 전부 200. 보유 6종목을 루프로 돌리면 반드시 걸린다 → **간격 확보 필수**.

### 2.6 환율 API 는 없다 — 실측 확인

`/api/v1/exchange-rates` 404, `/api/v1/fx-rates` 404, `/api/v1/prices?symbols=USDKRW` → `result: []`.
→ `fetchUsdKrwRate()` 만 Yahoo 에 남긴다.

## 3. 확정된 결정 사항 (사용자 승인 완료)

### 3.1 수정주가 부재 → 판정 규칙은 **그대로 유지**

설계서 §3 은 "전일 대비 ±8% 를 버리자"고 했으나 **실측이 그 전제를 반박했다.**
보유 종목의 200거래일 조정 안 된 종가 실측:

| 종목 | 하루 최대 하락 | \|변동\| > 8% |
|---|---|---|
| KODEX 미국배당커버드콜액티브 | −2.17% | 0회 |
| TIGER 미국배당다우존스커버드콜2호 | −2.11% | 0회 |
| KODEX 미국AI테크커버드콜 | −4.48% | 0회 |
| KODEX 인버스 | −22.11% | 12회 (배당 무관, 실제 변동성) |

배당락 규모가 임계값의 1/4 수준이라 가짜 급락은 발생하지 않는다.

→ `STOCK_THRESHOLDS`, `detectDailyChange`, `detectAvgPriceBreach` **일절 변경하지 않는다.**
→ `DailyBar.adjClose` 에 `closePrice` 를 그대로 넣는다. 타입은 바꾸지 않는다.
→ **액면분할 한계만 주석으로 남긴다** — 분할 시 가짜 급락 1회가 뜬다. 드물고, 그 경우 평단 대비
   판정이 실제로 어긋나므로 알림이 뜨는 편이 낫다.

### 3.2 `yahooSymbol` → `symbol` 리네임

감시 경로의 도메인 필드명이 토스 코드를 담게 되므로 이름을 중립화한다.
**Yahoo 클라이언트·매퍼 내부와 `ResolvedInstrument.yahooSymbol` 은 그대로 둔다**(거기서는 진짜
Yahoo 심볼이다). DB 컬럼 `ticker.yahoo_symbol` 도 **건드리지 않는다**(Yahoo 클라이언트 보존).

## 4. 파일별 변경 계약

### 4.1 신설 `src/market-data/infrastructure/toss/toss-api.client.ts`

`TossInvestClient` 에서 인증·HTTP 공통부를 추출한다. 두 클라이언트가 **토큰 캐시를 공유**하게 되어
발급 호출이 하루 1회로 줄어든다.

```ts
@Injectable()
export class TossApiClient {
  // TossInvestClient 의 getAccessToken / parseTokenResponse / requestJson 을 그대로 옮긴다.
  // 옮기는 것이지 재설계하지 않는다 — 기존 에러 메시지·검증 조건을 보존한다.
  async requestJson(operation: string, path: string, init?: RequestInit): Promise<unknown>;
}
```

- `path` 는 `/api/v1/...` 형태(base URL 은 내부 상수)
- `Authorization: Bearer` 는 **내부에서 자동 부착**. 호출부는 추가 헤더만 `init.headers` 로 넘긴다
- 토큰 발급 요청 자체는 인증 헤더 없이 나가는 private 경로로 유지
- `TOSS_CLIENT_ID` / `TOSS_CLIENT_SECRET` 미설정 시 기존 에러 메시지 그대로

### 4.2 수정 `src/market-data/infrastructure/toss/toss-invest.client.ts`

`TossApiClient` 를 주입받아 토큰·HTTP 를 위임한다. **남기는 책임**: 계좌 시퀀스 결정
(`getAccountSequence`, `parseAccounts` — `/accounts` 봉투 주석 포함), holdings 조회·매핑.
`/accounts` 봉투에 관한 기존 주석(145~150행)은 **삭제하지 말 것** — #244 재발 방지 기록이다.

### 4.3 신설 `src/market-data/infrastructure/toss/toss-market-data.mapper.ts`

```ts
export const mapTossCandlesResponse = (raw: unknown): DailyBar[] | null;
```

- `raw.result.candles` 가 배열인지 검증. 아니면 `null`
- 캔들 하나라도 파싱 실패하면 **전체를 `null`** (기존 `toss-holdings.mapper.ts` 와 같은 정신 —
  부분 성공을 성공으로 위장하지 않는다)
- 필수 필드: `timestamp`, `closePrice`, `volume`, `currency` (전부 비어있지 않은 문자열).
  `openPrice`/`highPrice`/`lowPrice` 는 **쓰지 않는다**
- `tradeDate` = `new Date(timestamp.slice(0, 10) + 'T00:00:00.000Z')`
  — §2.1 근거로 앞 10자가 그 시장의 거래일이다. `new Date(timestamp)` 를 쓰면 국내 봉이
  UTC 로 전날이 되어 `resolveExpectedTradeDate` 비교가 전부 어긋난다
- `close` = `adjClose` = `new Prisma.Decimal(closePrice)`. 유한값 검증
- `volume` = 정수 문자열만 허용(`/^\d+$/`)하고 `BigInt(volume)`. 소수점이 오면 파싱 실패로 취급
- **반환 전 `tradeDate` 오름차순 정렬** — 응답이 역순이라는 실측에 의존하지 말고 명시적으로
  정렬한다. 호출부(`bars.at(-1)` = 당일)가 순서에 전적으로 의존하고, 순서가 틀리면
  **에러 없이 조용히 오판정**한다

### 4.4 신설 `src/market-data/infrastructure/toss/toss-market-data.client.ts`

```ts
@Injectable()
export class TossMarketDataClient implements MarketDataPort {
  constructor(
    private readonly tossApi: TossApiClient,
    // 토스에 환율 API 가 없다(§2.6 실측) — 이 하나만 Yahoo 에 남는다.
    private readonly yahooMarketData: YahooFinanceMarketDataClient,
  ) {}

  async fetchDailyBars(symbol: string, days: number): Promise<DailyBar[]>;
  async fetchUsdKrwRate(): Promise<string | null>;
}
```

`fetchDailyBars`:
- `count` = `Math.min(days, 200)` (§2.1 상한)
- `days <= 0` 이면 호출하지 않고 `[]`
- 매퍼가 `null` 을 주면 `throw new Error('토스증권 일봉 응답 형식이 올바르지 않습니다 — {symbol}')`
- 반환은 최근 `days` 개 (`bars.slice(-days)`) — Yahoo 클라이언트와 동일 규약
- **호출 간 최소 간격 220ms** 보장 (§2.5). 인스턴스 필드에 마지막 호출 시각을 두고 대기한다.
  `ponytail:` 주석으로 한계를 남긴다 — 고정 간격이며 동시 호출 시 경쟁이 있다. 현재 호출부는
  종목 순차 루프이고 KR/US task 는 다른 시각에 돌아 동시성이 없다. 종목이 수십으로 늘거나
  병렬화하면 엔드포인트별 토큰 버킷으로 교체

`fetchUsdKrwRate`: `this.yahooMarketData.fetchUsdKrwRate()` 위임. 위임 이유를 주석으로.

### 4.5 수정 `src/market-data/domain/port/market-data.port.ts`

`resolveSymbol` 을 **포트에서 제거**한다. 유일한 호출부 `scripts/register-holding.ts:17-18` 이
`new YahooFinanceMarketDataClient()` 로 클래스를 직접 쓰고 포트를 경유하지 않는다. 메서드는
Yahoo 클래스에 그대로 남기므로 그 스크립트는 무변경으로 계속 동작한다.
`ResolvedInstrument` 타입·Yahoo 매퍼도 그대로 둔다.

주석의 `yahooSymbol` 인자명·문구를 `symbol` 로 중립화한다.

### 4.6 수정 `src/agent/stock/infrastructure/stock-monitor.repository.ts`

`findCurrentHoldings` 에서 `holding.ticker.yahooSymbol` → `holding.ticker.tossSymbol` 로 바꾸고
반환 필드도 `symbol`. **이 한 줄이 감시 0건의 직접 원인이다.**

### 4.7 리네임 — `yahooSymbol` → `symbol`

대상: `stock-monitor.type.ts`(`HoldingSnapshot`, `StockAnomaly`), `stock-anomaly.ts`,
`stock-monitor.formatter.ts`(`StockPriceDisplay` 포함), `stock-monitor.autopilot-task.ts`,
그리고 해당 spec 파일들.

**제외**: `yahoo-finance.market-data.client.ts`, `yahoo-finance.mapper.ts`(+spec),
`market-data.type.ts` 의 `ResolvedInstrument.yahooSymbol`, `scripts/register-holding.ts`,
`prisma/schema.prisma`.

검증: 작업 후 `grep -rn "yahooSymbol" src scripts` 결과가 위 제외 목록 파일만 남아야 한다.

### 4.8 수정 `src/market-data/market-data.module.ts`

```ts
providers: [
  TossApiClient,
  YahooFinanceMarketDataClient,          // 환율 위임 대상 — provider 등록 필요
  { provide: MARKET_DATA_PORT, useClass: TossMarketDataClient },
  { provide: BROKER_HOLDINGS_PORT, useClass: TossInvestClient },
],
exports: [MARKET_DATA_PORT, BROKER_HOLDINGS_PORT],
```

Yahoo 클라이언트는 **삭제하지 않는다** — 롤백 경로로 보존한다(설계서 §6).

## 5. 테스트 요구

신규 spec 2개. 픽스처는 **§2 의 실측 응답을 그대로** 쓴다(합성 값으로 구조를 바꾸지 말 것).

`toss-market-data.mapper.spec.ts`:
1. 실측 국내 응답 → 3개 봉, `tradeDate` 가 `2026-08-04/05/06` **오름차순**
2. 실측 미국 응답(`T13:00:00.000+09:00`) → `tradeDate` 가 `2026-08-06T00:00:00.000Z` (ET 날짜 유지)
3. 겨울 오프셋(`T14:00:00.000+09:00`) 도 같은 규칙으로 날짜가 밀리지 않음
4. `result.candles` 가 없거나(`/holdings` 처럼 `items` 인 경우 포함) 배열이 아니면 `null`
5. 필수 필드 누락·비수치 문자열 → `null`
6. `volume` 에 소수점 문자열 → `null`
7. `close` 와 `adjClose` 가 같은 값

`toss-market-data.client.spec.ts` (fetch 를 mock):
1. `count` 가 200 으로 clamp 되는지 (`days=500` 요청)
2. HTTP 429 → 예외 (조용히 빈 배열 반환하지 않음)
3. 매퍼 `null` → 예외
4. 연속 2회 호출 사이에 220ms 이상 간격 (타이머 mock 또는 주입된 시각 함수)
5. `fetchUsdKrwRate` 가 Yahoo 클라이언트에 위임되는지

기존 spec 은 리네임만 반영한다. **판정 로직 테스트의 기대값은 바꾸지 않는다**(§3.1).

## 6. 검증 게이트

```bash
pnpm lint:check && pnpm test && pnpm build && pnpm docs:check
```

4개 전부 exit 0. `pnpm test` 는 2단계 실행이라 경로 필터가 안 먹는다 — 부분 확인은
`pnpm exec jest src/market-data src/agent/stock src/autopilot`.

Node 22 필수(`.nvmrc`). base 가 바뀌었으면 `pnpm prisma:generate` 먼저.

## 7. 하지 않는 것

- `STOCK_THRESHOLDS` 및 판정 함수 변경 (§3.1)
- Yahoo 클라이언트·매퍼 삭제
- `prisma/schema.prisma` 변경 (DB 마이그레이션 없음)
- `/prices`·`/stocks` 활용, 1분봉, 주문 기능
- `sync-holdings.usecase.ts` 변경 (잔고 동기화는 이미 동작)
- `scripts/register-holding.ts` 변경
