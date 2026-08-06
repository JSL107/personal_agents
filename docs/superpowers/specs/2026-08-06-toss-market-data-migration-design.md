# 시세 소스 전환 설계 (Spec 5) — Yahoo Finance → 토스증권

2026-08-06. 선행: [투자 에이전트](./2026-08-05-invest-agent-design.md),
[토스증권 연동](./2026-07-22-toss-holdings-sync-design.md), [보유 종목 모니터링](./2026-07-22-stock-monitor-design.md).

---

## 1. 왜 바꾸는가

앱키 발급 후 첫 실호출로 잔고 동기화는 성공했다(`synced=6`). 그런데 **감시 대상은 여전히 0건**이다.

동기화는 `ticker.toss_symbol`만 채우고 `yahoo_symbol`은 비워 둔다. 감시 쪽은
`yahoo_symbol`이 없는 종목을 조용히 건너뛴다(`stock-monitor.repository.ts:51`).

```
ticker=6  holding=6  yahoo_symbol 채워진 것=0  →  감시 대상 0
```

해법은 둘이었다. (1) 토스 심볼 → Yahoo 심볼 변환기를 붙이거나, (2) 시세도 토스에서 받거나.
**(2)를 택했다.** 근거:

- 종목 코드를 두 곳(`toss_symbol` / `yahoo_symbol`)에 이중으로 들고 갈 필요가 없어진다
- Yahoo 는 비공식 경로다. 오늘도 그 매퍼의 오탐으로 `Pfizer, Inc.` 가 거부됐다(#244)
- `yahoo-finance2` 가 Node 22 를 요구해 실행 환경 경고를 낸다
- 잔고와 시세가 같은 출처가 되면 종목 식별이 어긋날 여지가 사라진다

## 2. 실측한 API (2026-08-06 직접 호출)

### 2.1 일봉 — `GET /api/v1/candles`

```
/api/v1/candles?symbol=483280&interval=1d&count=5
```

`interval` 허용값은 **`["1m", "1d"]`** 뿐이다(잘못된 값을 보내면 서버가 목록을 알려준다).
주봉·월봉은 없다. 일봉이 있으므로 현재 판정 로직을 그대로 옮길 수 있다.

```json
{ "result": {
    "candles": [
      { "timestamp": "...", "openPrice": "12360", "highPrice": "12360",
        "lowPrice": "12355", "closePrice": "12360", "volume": "955", "currency": "KRW" }
    ],
    "nextBefore": "..." } }
```

값은 **전부 문자열**이다(`Prisma.Decimal` 로 바로 넘길 수 있다). `nextBefore` 로 과거를 더 받는다.

### 2.2 현재가 — `GET /api/v1/prices`

파라미터가 `symbol` 이 아니라 **`symbols`**(복수)다. 여러 종목을 한 번에 받는다.

```json
{ "result": [ { "symbol": "483280", "timestamp": "...", "lastPrice": "12360", "currency": "KRW" } ] }
```

### 2.3 응답 봉투가 엔드포인트마다 다르다

이번 사고(#244)의 원인이므로 표로 못박아 둔다. **한쪽 규약을 다른 쪽에 유추하지 말 것.**

| 엔드포인트 | `result` 아래 |
|---|---|
| `/accounts` | 배열 그 자체 |
| `/prices` | 배열 그 자체 |
| `/holdings` | 객체 → `items` 배열 |
| `/candles` | 객체 → `candles` 배열 |

### 2.4 호출 한도

`MARKET_DATA` 10회/초, `MARKET_DATA_CHART` 5회/초, `ASSET` 5회/초, `ACCOUNT` 1회/초.
보유 종목 수가 한 자리라 현재 규모에서는 제약이 아니다.

## 3. 가장 큰 트레이드오프 — 수정주가가 없다

> ⚠️ **이 절의 전제는 사실이 아니다.** 토스 `/candles` 에는 `adjusted` 파라미터가 있고 기본값이
> `true` 이며, 실측 결과 현금배당까지 조정한다. 아래 선택지 4종과 "2주 관찰" 보류는 모두 철회됐다.
> → [전제 정정 (2026-08-06)](../plans/2026-08-06-toss-market-data-premise-correction.md)

현재 판정은 `DailyBar.adjClose`(수정주가)를 쓴다. **토스 캔들에는 `closePrice` 만 있고
배당·액면분할을 반영한 조정가가 없다.**

영향:

- 배당락일에 종가가 배당만큼 떨어진다 → "전일 대비 ±8%" 규칙이 **가짜 급락**을 잡을 수 있다
- 보유 종목 6개 중 4개가 **월배당 커버드콜 ETF** 다. 배당락이 잦아 이 문제에 정면으로 노출된다
- 액면분할은 드물지만 발생하면 평단 대비 판정이 통째로 어긋난다

대응 선택지 — 구현 전에 정해야 한다.

1. **그대로 쓰고 임계값을 조정한다.** 가장 단순하지만 배당락 오탐을 감수한다
2. **배당락일을 알아내 그날만 판정을 건너뛴다.** 토스 API 에 배당 정보가 있는지 미확인
3. **평단 대비 판정만 남기고 전일 대비는 버린다.** 평단은 매수가 기준이라 배당락 영향이 작다
4. **Yahoo 를 수정주가 전용으로 남긴다.** 이중화가 되살아나 전환 취지가 흐려진다

현재 기울기는 3 → 1 순이다. 2주 관찰 데이터가 쌓이면 실측으로 정할 수 있다.

## 4. 변경 범위

```
MarketDataPort (인터페이스 유지)
  ├─ YahooFinanceMarketDataClient   ← 제거 대상(당장은 보존)
  └─ TossMarketDataClient           ← 신설
```

- `market-data.module.ts` 의 `MARKET_DATA_PORT` 바인딩을 교체
- `DailyBar.adjClose` 는 `closePrice` 로 채운다(수정주가 부재를 타입에 드러낼지는 3절 결정에 달림)
- `fetchUsdKrwRate()` — 토스에 환율 API 가 있는지 **미확인**. 없으면 이 하나만 Yahoo 에 남긴다
- `resolveSymbol()` — 토스는 `/stocks` 로 종목 기본정보를 준다. 심볼 검증도 여기로 옮긴다
- `ticker.yahoo_symbol` 은 남겨두되 신규 적재는 하지 않는다(`source='TOSS'` 로 구분)
- 토큰 발급·계좌 헤더 로직은 `TossInvestClient` 에 이미 있다. 공통 부분을 뽑아 재사용한다

## 5. 검증

- 6종목 일봉을 실제로 받아 `daily_price` 에 적재되는지
- 감시 대상이 0 → 6 으로 바뀌는지(`agent_run` 의 `holdingCount`)
- 미국 종목(PFE·SPYM)이 국내와 같은 경로로 처리되는지 — 토스는 `marketCountry` 로 구분한다
- 배당락일 전후 판정 결과를 눈으로 확인(3절 결정의 근거)

## 6. 하지 않는 것

- 1분봉 활용(실시간 감시). 현재 감시는 장 마감 후 1회로 충분하다
- 주문·조건주문 — [투자 에이전트 설계 §6](./2026-08-05-invest-agent-design.md) 의 원칙 유지
- Yahoo 클라이언트 삭제. 전환이 안정화될 때까지 코드는 남긴다

## 7. 확인하지 못한 것

- 토스에 **환율(USD/KRW) API** 가 있는지
- `/candles` 가 과거 몇 거래일까지 주는지(`count` 상한)
- 미국 종목의 일봉 타임존 기준(ET 마감 기준인지)
- 배당·액면분할 정보 제공 여부 — 3절 선택지 2 의 전제
