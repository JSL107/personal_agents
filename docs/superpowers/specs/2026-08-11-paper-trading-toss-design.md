# 가상 시드 모의투자 — 토스증권 시세 기반 수익률 추적 설계

작성일: 2026-08-11
상태: 착수 전 확인 2건 대기 (§3)

---

## 1. 문제와 목표

### 하려는 것

가상의 시드로 주식을 사고팔았다고 가정하고, 토스증권 시세로 평가해 수익률을 추적한다. 최종적으로는 지표·공시를 분석해 **장기투자용과 단기매매용 종목을 분리 추천**받고, 그 추천이 실제로 맞았는지를 가상 계좌의 성적으로 검증한다.

### 성공 기준

1. 장 마감 후 Slack에서 종목별 손익, 총 수익률, 자산 곡선 그래프를 매일 받는다.
2. 이대리가 스스로 종목을 골라 가상 매매하고, 판단 근거와 판단 시점이 기록으로 남는다.
3. 장투 추천과 단타 추천 중 어느 쪽이 잘 맞는지 데이터로 답할 수 있다.

### 확정된 요구사항

| 항목 | 결정 |
|---|---|
| 매매 주체 | 이대리(LLM)가 자율 판단 |
| 종목 범위 | 제한 없음 (상장 전종목) |
| 판단 근거 | 시세 + 뉴스·공시 + 재무제표 |
| 체결 방식 | 자동 체결 후 사후 통보 (승인 게이트 없음) |
| 그래프 | Slack 이미지로 매일 발송 |
| 외부 데이터 | DART OpenAPI 키 발급해 공시·재무 모두 사용 |

---

## 2. 현재 코드베이스 상태

### 확인된 사실

**토스 API 실측 결과** — `docs/superpowers/specs/2026-08-06-toss-market-data-migration-design.md`

| 엔드포인트 | 확인된 내용 |
|---|---|
| `GET /api/v1/candles` | `interval`은 `1m`·`1d`만. 응답 필드에 `openPrice`·`highPrice`·`lowPrice`·`closePrice`·`volume`이 **모두 존재**하며 값은 전부 문자열. `before`(ISO 8601 상한) 파라미터와 `nextBefore` 커서로 과거 페이지네이션 가능 |
| `GET /api/v1/prices` | 파라미터가 `symbols`(복수). **여러 종목 현재가를 한 번에** 반환(`lastPrice`) |
| `GET /api/v1/holdings` | 실계좌 보유. `result`가 객체이고 그 안에 `items` |
| `GET /api/v1/accounts` | `result`가 배열 그 자체 (엔드포인트마다 응답 봉투가 다르다) |

시가·고가·저가는 **구현체가 의도적으로 버린 필드**다(`toss-market-data.mapper.ts:26-31`이 `closePrice`만 구조분해, `DailyBar`(`market-data.type.ts:30-36`)에도 없음). 조달 문제가 아니라 매퍼·타입 확장 문제다.

**심볼 규칙** — 국내 종목의 `Ticker.tossSymbol`은 6자리 KRX 종목코드와 같다. `sync-holdings.usecase.ts:41-45`가 `code`와 `tossSymbol`에 동일한 `holding.symbol`을 넣고, 실호출도 `symbol=483280`으로 성공했다.

### 재사용 자산

| 자산 | 위치 | 실제 재사용 범위 |
|---|---|---|
| 토스 일봉 조회 | `toss-market-data.client.ts:24` | 220ms 간격 강제(`:11`), 요청당 최대 200봉(`:13`). **단일 인스턴스 순차 호출 가정** — 주석(`:63-64`)이 병렬화 시 token bucket 교체를 예고 |
| 시세 포트 | `market-data.port.ts:5-11` | `MarketDataModule`이 `MARKET_DATA_PORT`를 export(`market-data.module.ts:18`)하므로 `src/agent/stock/`을 거치지 않고 주입 가능 — 결합 없음 |
| 종목 마스터 | `Ticker` | §3 정체성 문제 있음 |
| 스케줄 실행 골격 | `stock-monitor.autopilot-task.ts` | 원장 적재·게이트 env·실패 집계 패턴. **휴장 판정과 `DailyPrice` 적재는 재사용하지 않는다**(§5) |
| 브라우저 렌더 | `package.json:61` puppeteer `^24.40.0` | 크롤러는 호출마다 `launch` → `close`(`crawler.requester.ts:20-46`, `:106-121`). 공유 인스턴스가 없으므로 하루 1회 launch가 기존 패턴과 동일 |

`alert-outcome.ts`는 `scoreAlert(firedPrice, horizonPrice) → returnPct` 20줄과 `DEFAULT_HORIZON_DAYS = 5` 상수뿐이다. 채점 기계 본체는 `StockAlert`/`AlertOutcome` 표에 묶여 있어 포지션에 그대로 재사용되지 않는다. 3단계는 **개념만** 참조한다.

### 새로 만들어야 하는 것

- 가상 계좌·주문·원장·스냅샷 테이블 (§4)
- Slack 파일 업로드 경로 — `files.upload`/`uploadV2` 호출 0건, `SlackNotifierPort`에 파일 메서드 없음, `AutopilotTaskResult`에 파일 필드 없음 (§5)
- DART 클라이언트 (2·3단계)
- 지표 계산·스크리너 (2단계)
- 상장 전종목 마스터 적재 (2단계)

### 절대 건드리지 않을 것

실계좌 보유 스냅샷 `Holding`과 `sync-holdings.usecase.ts`. 가상 포지션이 섞이면 `stock-monitor.autopilot-task.ts:236`의 `findCurrentHoldings`가 실재하지 않는 보유를 근거로 경보를 낸다.

단, **`Ticker`는 수정 대상이다** — Prisma 관계는 양쪽 선언이 필요하므로 back-relation을 추가한다(§4).

---

## 3. 착수 전 해소해야 하는 것

### (1) Slack `files:write` 스코프 — 사용자 조치 필요

현재 Bot Token Scopes는 `commands`, `chat:write`, `app_mentions:read`, `im:history`다(`README.md:284`). `files:write`가 없어 이미지 업로드가 불가능하다.

**리스크**: 스코프 추가는 앱 재설치를 부르고, 재설치로 Bot Token이 갱신되면 `.env`를 갱신하기까지 이대리의 모든 Slack 발송이 멈춘다. 작업 시각을 정해 진행해야 한다.

### (2) `Ticker` 정체성 이원화 — 1단계 설계 결정

`Ticker`의 유니크 키는 `@@unique([market, code])`이고 `market`은 required다(`schema.prisma:329, 349`). 그런데 토스 경로는 `market='KR'`, Yahoo 경로는 `market='KOSPI'|'KOSDAQ'`를 넣는다(`schema.prisma:320-325` 주석이 이 이원화를 명문화).

같은 삼성전자가 `(KR, 005930)`과 `(KOSPI, 005930)` 두 행으로 존재할 수 있고, `PaperPosition.tickerId`가 어느 행을 가리키냐에 따라 평가 종목이 갈린다.

**결정**: 모의투자는 토스 시세로 평가하므로 `market='KR'` 계열만 사용한다. Ticker 조회·생성 시 `marketCountry='KR'`과 `tossSymbol IS NOT NULL`을 조건으로 걸고, `tossSymbol`이 없는 행은 조회 대상에서 제외한다(`stock-monitor.repository.ts:341-342`가 같은 판단을 한다 — `:197`의 `code` 폴백은 따르지 않는다).

`scripts/register-holding.ts`는 `yahooSymbol`만 채우므로 1단계 CLI는 `tossSymbol`을 채우는 자체 upsert 경로가 필요하다.

---

## 4. 데이터 모델

Prisma enum을 쓰지 않는 컨벤션(`grep '^enum'` 0건)에 따라 상태값은 `String`으로 두고, 값 검증은 도메인 가드가 맡는다.

전 모델에 `@@map` snake_case, 관계 양방향 선언, `createdAt`, 시계열 인덱스를 붙인다(스키마 23/23 모델의 관행).

```prisma
model PaperAccount {
  id          Int      @id @default(autoincrement())
  name        String   @unique                                  // DEFAULT | LONG_TERM | SWING
  currency    String   @default("KRW")
  seedAmount  Decimal  @map("seed_amount")  @db.Decimal(18, 4)
  cashBalance Decimal  @map("cash_balance") @db.Decimal(18, 4)
  openedAt    DateTime @map("opened_at")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  orders    PaperOrder[]
  positions PaperPosition[]
  trades    PaperTrade[]
  snapshots PaperEquitySnapshot[]

  @@map("paper_account")
}

// 판단과 체결을 분리해 기록한다. 이 표가 없으면 "전일 종가로 판단하고 다음날 시가에 체결했다"를
// 사후에 증명할 수 없다 — 다음날 시가를 본 뒤에 만든 거래와 구별되지 않기 때문이다.
model PaperOrder {
  id              Int       @id @default(autoincrement())
  accountId       Int       @map("account_id")
  account         PaperAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  tickerId        Int       @map("ticker_id")
  ticker          Ticker    @relation(fields: [tickerId], references: [id], onDelete: Cascade)
  side            String                                        // BUY | SELL
  quantity        Decimal   @db.Decimal(18, 4)
  strategy        String                                        // LONG_TERM | SWING | MANUAL
  reason          String?   @db.Text
  decidedAt       DateTime  @map("decided_at")                  // 결정 시각
  dataAsOf        DateTime  @map("data_as_of") @db.Date          // 판단에 사용한 마지막 거래일
  targetTradeDate DateTime? @map("target_trade_date") @db.Date   // 체결 목표 거래일
  status          String                                        // PENDING | FILLED | PARTIALLY_FILLED | EXPIRED | CANCELLED
  statusReason    String?   @map("status_reason")                // 미체결 사유 (거래정지·상한가·유동성 등)
  expiresAt       DateTime? @map("expires_at")
  agentRunId      Int?      @map("agent_run_id")
  agentRun        AgentRun? @relation(fields: [agentRunId], references: [id])
  createdAt       DateTime  @default(now()) @map("created_at")

  trades PaperTrade[]

  @@index([accountId, status])
  @@index([targetTradeDate])
  @@map("paper_order")
}

model PaperPosition {
  id        Int      @id @default(autoincrement())
  accountId Int      @map("account_id")
  account   PaperAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  tickerId  Int      @map("ticker_id")
  ticker    Ticker   @relation(fields: [tickerId], references: [id], onDelete: Cascade)
  quantity  Decimal  @db.Decimal(18, 4)
  // 매수 수수료를 포함한 장부 원가 기준 평균단가 (§5 원가 규칙)
  avgPrice  Decimal  @map("avg_price") @db.Decimal(18, 4)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([accountId, tickerId])
  @@map("paper_position")
}

model PaperTrade {
  id          Int      @id @default(autoincrement())
  accountId   Int      @map("account_id")
  account     PaperAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  orderId     Int?     @map("order_id")
  order       PaperOrder? @relation(fields: [orderId], references: [id])
  tickerId    Int      @map("ticker_id")
  ticker      Ticker   @relation(fields: [tickerId], references: [id], onDelete: Cascade)
  side        String                                            // BUY | SELL
  quantity    Decimal  @db.Decimal(18, 4)
  price       Decimal  @db.Decimal(18, 4)                        // 미조정 실제 체결가
  fee         Decimal  @db.Decimal(18, 4)
  tax         Decimal  @db.Decimal(18, 4)
  realizedPnl Decimal? @map("realized_pnl") @db.Decimal(18, 4)   // 매도 시에만
  tradeDate   DateTime @map("trade_date") @db.Date               // 체결 거래일
  // 재시도·stalled 재실행이 같은 체결을 두 번 넣는 것을 DB 층에서 막는다.
  // HoldingChange 가 같은 문제를 fingerprint @unique 로 푼 선례를 따른다(schema.prisma:406).
  fingerprint String   @unique
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([accountId, tradeDate])
  @@index([tickerId, tradeDate])
  @@map("paper_trade")
}

// 종목별 평가 근거. 총액만 남기면 어느 종목을 어떤 날짜의 어떤 가격으로 평가했는지
// 사후 검증이 불가능하고, 거래정지 종목의 며칠 전 종가가 정상 평가로 위장된다.
model PaperPositionSnapshot {
  id           Int      @id @default(autoincrement())
  snapshotId   Int      @map("snapshot_id")
  snapshot     PaperEquitySnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  tickerId     Int      @map("ticker_id")
  ticker       Ticker   @relation(fields: [tickerId], references: [id], onDelete: Cascade)
  quantity     Decimal  @db.Decimal(18, 4)
  avgPrice     Decimal  @map("avg_price") @db.Decimal(18, 4)
  price        Decimal  @db.Decimal(18, 4)
  priceDate    DateTime @map("price_date") @db.Date              // 평가에 쓴 봉의 거래일
  isStale      Boolean  @default(false) @map("is_stale")         // priceDate != snapshot.tradeDate
  createdAt    DateTime @default(now()) @map("created_at")

  @@unique([snapshotId, tickerId])
  @@map("paper_position_snapshot")
}

model PaperEquitySnapshot {
  id                Int      @id @default(autoincrement())
  accountId         Int      @map("account_id")
  account           PaperAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  // 실행일(KST) 이다. 포지션들이 받은 봉의 거래일을 다수결로 정하지 않는다 — 그러면 다수 그룹이
  // 정의상 stale 이 아니게 되어 "전 종목 stale" 판정(§5-(6))에 도달할 수 없다.
  // 실행일을 기준으로 두면 휴장일 실행은 모든 봉이 전 거래일이라 전부 stale 로 잡혀 미적재된다.
  // 적재되는 스냅샷의 tradeDate 는 결국 실제 거래일과 같다(전부 stale 이면 적재하지 않으므로).
  tradeDate         DateTime @map("trade_date") @db.Date
  cashBalance       Decimal  @map("cash_balance")   @db.Decimal(18, 4)
  positionValue     Decimal  @map("position_value") @db.Decimal(18, 4)
  totalValue        Decimal  @map("total_value")    @db.Decimal(18, 4)
  returnRate        Decimal  @map("return_rate")    @db.Decimal(9, 4)
  staleTickerCount  Int      @default(0) @map("stale_ticker_count")
  // 벤치마크 없이는 "시드 대비 +8%" 가 시장 대비 초과인지 미달인지 해석되지 않는다.
  // 지나간 구간은 소급 적재가 불가능하므로 1단계부터 함께 적는다.
  benchmarkClose    Decimal? @map("benchmark_close") @db.Decimal(18, 4)
  // 렌더러 검증용 백필 구간 표식. 실제 보유 이력이 아니므로 성적 집계에서 제외한다.
  isBackfilled      Boolean  @default(false) @map("is_backfilled")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  positionSnapshots PaperPositionSnapshot[]

  @@unique([accountId, tradeDate])
  @@index([accountId, tradeDate])
  @@map("paper_equity_snapshot")
}
```

`Ticker`와 `AgentRun`에 back-relation 필드를 추가한다(`paperOrders`, `paperPositions`, `paperTrades`, `paperPositionSnapshots`).

### 설계 판단의 근거

**주문과 거래를 분리한다.** 거래만 기록하면 "언제 판단했고 어떤 데이터를 봤는가"가 남지 않는다. 그러면 다음 거래일 시가를 확인한 뒤 만든 거래와 전날 판단한 거래를 구별할 수 없고, §5의 정직성 규칙이 검증 불가능한 선언에 그친다. `dataAsOf`와 `decidedAt`을 주문에 박아 시점을 고정한다.

**포지션과 거래를 둘 다 둔다.** 거래 원장만으로는 현재 상태를 매번 전체 이력에서 재계산해야 하고, 포지션만으로는 이력이 사라진다.

**일별 스냅샷을 저장한다.** 과거 자산 곡선을 매번 재계산하면 비용이 크고, 상장폐지·종목 변경이 있으면 복원 자체가 불가능하다.

**종목별 스냅샷을 따로 둔다.** 총액만 남기면 stale price를 정상 평가로 착각하고, 리포트 숫자를 사후 검증할 수 없다.

**계좌를 여러 개 허용한다.** 장투와 단타 성적을 분리해 재려면 현금이 섞이지 않아야 한다. 현금을 공유하면 "장투가 현금을 다 써서 단타를 못 한 날"이 단타 성적으로 잡힌다. 더 근본적으로는 같은 종목을 두 전략이 사면 `PaperPosition.avgPrice`가 하나로 합쳐져 전략별 실현손익 귀속이 불가능해진다 — 장투 1주@100, 단타 1주@200을 보유한 상태에서 1주@150을 팔면 통합 평균가로는 손익 0이지만 실제로는 어느 전략 물량을 팔았느냐에 따라 +50 또는 -50이다. 1단계는 `DEFAULT` 하나로 시작하고 3단계에서 전략별로 나눈다.

**수량은 `Decimal`로 두고 정수 제약은 도메인에서 검증한다.** 국내 주식은 정수 주 단위이므로 `1.5주` 매수는 불가능한 체결이다. 타입을 `Int`로 바꾸지 않는 이유는 해외 소수점 주식 확장 여지를 남기는 것이고, 대신 `assertWholeShares()`를 매매 경로 입구에 두어 통과를 막는다.

---

## 5. 정직성 장치

성적이 부풀려지면 이 프로젝트 전체가 무의미해진다. 아래는 설계 제약이며 구현에서 선택 사항이 아니다.

### (1) 미조정 실제 가격으로 장부를 쓴다

**이것이 가장 중요한 제약이다.** 현재 클라이언트는 `adjusted: 'true'`를 하드코딩하고(`toss-market-data.client.ts:43`), 매퍼는 `close`와 `adjClose`에 **같은 조정가를 넣는다**(`:62-68`). 즉 이 레포는 실제 거래된 가격을 보관하지 않는다.

조정가는 배당·분할 효과를 과거 가격에서 걷어낸 값이다. 주가 감시에는 이것이 맞다 — 배당락을 가짜 급락으로 오인하지 않기 위해서이고, 코드 주석에 실측 근거가 있다(같은 파일 `:33-38`, 월배당 종목 441640은 200봉 중 183봉이 조정 여부에 따라 달라진다).

그러나 모의투자 장부에는 정반대로 실제 가격이 필요하다. 조정가로 평가하면 다음이 일어난다.

- **액면분할**: 10만원 1주 보유 중 10:1 분할 → 실제로는 1만원 10주(가치 동일). 수량을 1주로 붙잡은 채 최신가 1만원으로 평가하면 **-90%**가 기록된다. `avgPrice=100,000`도 그대로 남아 종목 손익까지 틀린다.
- **배당**: 배당락으로 주가가 내리는데 배당금이 현금으로 들어오지 않으면 그냥 손실로 기록된다.

**조치**
1. `MarketDataPort.fetchDailyBars`에 조정 여부 옵션을 추가하고, 모의투자 경로는 미조정 가격을 요청한다. 주가 감시 경로는 현행(조정가)을 유지한다.
2. 매퍼와 `DailyBar`를 확장해 `open`·`high`·`low`와 조정·미조정을 구분해 담는다. 매퍼는 캔들 하나만 파싱 실패해도 응답 전체를 `null`로 버리므로(`:84-89`), 새 필드는 **optional로 올려** 거래정지 종목 등에서 종목 전체가 실패하지 않게 한다.
3. 1단계에서는 분할·배당을 완전 처리하지 않는다. 대신 **감지 가드**를 둔다 — 전일 종가 대비 비정상 점프(정수배 근처의 급락 등)를 만나면 스냅샷을 적재하지 않고 실행을 실패로 끊고 Slack에 사유를 보고한다. 조용히 틀린 숫자를 남기는 것만은 금지한다.
4. 2단계에서 DART 공시로 분할·배당 이벤트를 받아 `PaperCorporateAction`과 현금 원장으로 정식 처리한다(분할 시 `quantity × ratio`, `avgPrice ÷ ratio`, 배당은 지급일 기준 세후 현금 적립).

### (2) 체결가는 다음 거래일 시가

장 마감 후 종가를 전부 보고 판단하면서 그 종가에 체결하면 현실에서 불가능한 거래다. 판단은 거래일 `t`의 확정 데이터로(`PaperOrder.dataAsOf`), 체결은 다음 **실제 거래일** 시가로 기록한다.

`t+1`이 거래일이 아닐 수 있으므로 주문은 다음 거래일까지 `PENDING`으로 대기한다. 다음 조건에서는 체결하지 않고 `statusReason`을 남긴다.

- 대상 거래일의 봉이 없음 (휴장·거래정지·상장폐지)
- 상한가 매수 또는 하한가 매도 — 반대 주문이 없어 시장가로도 체결되지 않는 상황
- 주문 수량이 직전 평균거래량의 보수적 비율을 초과 — 시가 단일가에 전량 체결이 불가능한 규모

가상 계좌는 시장을 움직이지 않으므로 시장 충격은 무시하되, **참가율 가드는 명시적으로 둔다.** 없으면 소형주에서 성적이 부풀려진다.

### (3) 비용은 매수·매도 양쪽에 적용한다

- 위탁수수료와 유관기관 제비용은 매수·매도 양쪽에 발생한다.
- 증권거래세는 매도에만 적용되며 시장(KOSPI/KOSDAQ/KONEX)에 따라 요율과 구성이 다르다.
- 단일 전역 상수는 부정확하다. `trade-cost.ts`에 시장별·방향별·적용일자별 요율표를 두고 조회한다.
- 원화 비용은 계산 후 원 단위로 절사·반올림한다. `Decimal(18,4)`를 그대로 누적하면 현실에 없는 소수 원이 남는다.
- 시뮬레이션 세제 전제(일반 개인·비대주주)를 스펙에 명시하고 양도소득세는 다루지 않는다.

### (4) 원가 규칙

`avgPrice`는 **매수 수수료를 포함한 장부 원가** 기준으로 계산한다.

```
avgPrice = (기존 장부원가 + 신규 매수대금 + 매수 비용) / 총 수량
realizedPnl = (매도대금 - 매도 비용) - 매도수량 × avgPrice
```

매도 후 남은 `avgPrice`는 변경하지 않는다(평균원가법). 매수 비용을 원가에 넣지 않으면 총손익이 실제보다 좋게 나온다 — 10주@100에 수수료 10이면 `avgPrice=100`으로는 총손익 200이 나오지만 실제는 190이다.

### (5) 불변식 검증을 스냅샷 앞에 둔다

거래·현금·포지션 갱신은 **단일 DB 트랜잭션**으로 처리한다. 그래도 원장과 잔액은 어긋날 수 있으므로, 스냅샷 적재 직전에 다음을 검증하고 불일치 시 적재를 중단하고 보고한다.

```
cashBalance = seedAmount
            + Σ(SELL 대금 - fee - tax)
            - Σ(BUY 대금 + fee + tax)

position.quantity = Σ BUY 수량 - Σ SELL 수량

totalValue = cashBalance + Σ(수량 × 평가가격)
returnRate = (totalValue - seedAmount) / seedAmount × 100
```

1단계 전제: 입출금·배당·분할이 없다. 이 중 하나라도 도입되면 위 첫 식은 재구성 불가가 되므로, 그때 `PaperCashLedger`(append-only)를 추가하고 수익률 기준도 시간가중수익률로 전환한다. `returnRate`는 파생값이므로 스냅샷 생성 시 같은 계산에서 함께 만들고 불변식 검사 대상에 넣는다.

### (6) 봉을 못 받은 종목은 조용히 0으로 계산하지 않는다

포지션 중 하나라도 대상 거래일 봉을 받지 못하면 마지막 알려진 종가로 평가하고 `PaperPositionSnapshot.isStale`과 `staleTickerCount`에 기록하며, 리포트에 명시한다. `staleTickerCount`가 포지션 수와 같으면 스냅샷을 적재하지 않는다.

이유: 빠진 종목이 합계에서 누락되면 그날 총평가액이 그만큼 줄고, 스냅샷은 사후 재계산하지 않는 설계이므로 **그 잘못된 값이 곡선에 영구 고정된다.** 다음 날 회복되므로 V자 가짜 급락이 남고 시장 움직임으로 오독된다. 참조 구현도 실패가 있으면 부분 계산 대신 생략을 택한다(`stock-monitor.autopilot-task.ts:683-690`).

---

## 6. 1단계 구현 범위

### 모듈 구조

```
src/paper-trading/
  domain/
    paper-account.type.ts          // 계좌·주문·포지션·평가 타입, side/strategy union + 파싱 가드
    paper-valuation.ts             // 평가액·수익률 순수 계산
    trade-cost.ts                  // 시장별·방향별 비용 계산, 원 단위 절사
    position-cost.ts               // 평균원가 갱신, realizedPnl
    paper-invariant.ts             // §5-(5) 불변식 검증
    corporate-action-guard.ts      // §5-(1) 비정상 가격 점프 감지
  application/
    record-paper-trade.usecase.ts     // 주문 → 체결 → 포지션·현금 갱신 (단일 트랜잭션)
    evaluate-paper-account.usecase.ts // 포지션 + 봉 → 스냅샷
  infrastructure/
    paper-trading.repository.ts    // stock-monitor.repository.ts 선례(PrismaService 직접 주입)를 따른다
    paper-trading.formatter.ts     // Slack 텍스트
    equity-chart.renderer.ts       // HTML → PNG (page.setContent, 호출마다 launch/close)
  paper-trading.module.ts
```

`CODE_RULES.md:119-122`는 인프라 Prisma 구현을 `{domain}.prisma.repository.ts` + 도메인 포트로 규정하지만, 같은 성격의 `stock-monitor.repository.ts`가 포트 없이 `PrismaService`를 직접 주입하는 선례를 따른다. 포트 추상화의 대상이 없기 때문이다.

### 일일 흐름

**실행 시각: 평일 17:40 KST** (`40 17 * * 1-5`)

15:40이 아닌 이유가 두 가지다.

1. 이 레포는 이미 같은 문제를 겪고 주가 감시를 17:10으로 밀어놨다 — "국내 장 마감·지연 시세 반영 후"(`autopilot.playbook-defaults.ts:55-56`). 마감 직후에는 당일 종가가 확정되지 않아 `fetchDailyBars(symbol, 1)`이 전 거래일 봉을 돌려주고, 그러면 스냅샷이 전일 날짜로 적혀 유니크 제약에 걸리며 **에러 없이 하루 밀린 곡선**이 만들어진다.
2. 주가 감시(17:10)와 사후 채점(18:00) 사이에 배치해 시세 소비가 겹치지 않게 한다.

```
1. PAPER_TRADING_ENABLED 게이트 확인 (원장 밖에서 판정, stock-monitor 선례)
2. PENDING 주문 중 대상 거래일이 도래한 것을 체결 시도 (§5-(2))
3. DEFAULT 계좌 포지션 조회 (tossSymbol 있는 KR 종목만)
4. 종목별 미조정 일봉 조회 — 봉의 거래일이 당일인지 자체 확인
5. corporate action 감지 가드 (§5-(1))
6. 불변식 검증 (§5-(5))
7. PaperEquitySnapshot + PaperPositionSnapshot 적재 (같은 tradeDate 재실행은 overwrite)
8. Slack 발송: 종목별 손익 표 + 총 수익률 + 벤치마크 대비 + 자산 곡선 PNG
```

포지션이 0건이어도 실행 원장에는 기록을 남긴다.

### `DailyPrice`에 쓰지 않는다 — 제약

**모의투자는 `DailyPrice`에 어떤 행도 적재하지 않는다.** 휴장 판정도 재사용하지 않는다.

이유: 휴장 판정은 달력이 아니라 "저장된 마지막 시세 날짜 == 방금 받은 시세 날짜" 비교다(`stock-anomaly.ts:147-158`, `previousStoredDate`는 `DailyPrice`에서 온다). 즉 **17:10 이전에 누가 `DailyPrice(tickerId, 오늘)`을 쓰면 그날 그 종목의 감시 판정이 통째로 건너뛰어진다** — 저장된 알림 복구 경로로 빠져 급변 판정이 아예 돌지 않는데 원장에는 성공으로 남는다.

이것은 가설이 아니라 실제 사고다. `docs/superpowers/plans/2026-08-06-invest-line-roadmap.md` §E에 기록돼 있다("2026-08-06 오전 11:30에 수동으로 시세를 적재한 뒤, 그날 17:10 감시가 재판정 없이 저장된 알림 복구 경로로 빠졌다… 에러도 로그도 남지 않는다").

17:40 실행이면 감시(17:10)보다 뒤라 직접 충돌은 없지만, 재시도·수동 실행이 앞당겨질 여지가 있어 아예 쓰지 않는 것으로 못박는다. 휴장 여부는 받은 봉의 거래일이 실행일과 같은지로 직접 판정한다.

이 제약의 대가는 2단계에서 청구된다 — 스크리너는 2,800종목 × 200봉을 매번 재조회할 수 없어 `DailyPrice`를 읽어야 한다(§7).

### Slack 이미지 전달 경로 — 포트 확장을 택한다

현재 통로는 텍스트 전용이다.

```
AutopilotTaskResult (autopilot-task.port.ts:17-29)  → summaryText / detailText / preview  (파일 필드 없음)
SlackNotifierPort  (slack-notifier.port.ts)         → postMessage({target,text,threadTs}) (파일 없음)
orchestrator (autopilot.orchestrator.ts:130-134, 227) → summaryText 만 읽어 postMessage
```

**결정: `SlackNotifierPort`와 `AutopilotTaskResult`를 확장한다.** task가 `SlackService`를 직접 부르면 hexagonal 경계가 깨지고 다이제스트와 별개 메시지가 하나 더 나가 "표 + 그래프"가 분리된다.

영향 파일을 미리 열거한다(포트 확장은 mock을 깨고 전체 `pnpm test`로만 잡힌다).

- `src/morning-briefing/domain/port/slack-notifier.port.ts` — `postMessage`에 `files?: { filename: string; buffer: Buffer }[]`
- `SlackService` 어댑터 (`slack.service.ts:224-240` `postMessage` 옆) — `app.client.files.uploadV2`
- `src/autopilot/domain/autopilot-task.port.ts` — `AutopilotTaskResult.attachments?`
- `src/autopilot/application/autopilot.orchestrator.ts` + `autopilot.orchestrator.spec.ts` mock
- `SlackNotifierPort`를 mock하는 morning-briefing 계열 spec 전수

### 등록 작업

**AgentType — 1단계에서 결정한다.** `AgentRunService.execute`가 `agentType`을 필수로 받으므로(`agent-run.service.ts:54`) 원장을 남기려면 지금 정해야 한다. `INVEST` 재사용은 등록 비용이 0이지만 원장에서 주가 감시와 모의투자가 섞여 성적 집계가 흐려지고 `agent-contract.ts:242`의 `INVEST` 계약 검수가 다른 output 형태에 걸린다. **성적 분리가 이 프로젝트의 목적이므로 신규 `PAPER_TRADE`를 추가한다.**

따라오는 등록 지점:

| 항목 | 파일 |
|---|---|
| AgentType | `src/model-router/domain/model-router.type.ts` |
| 모델 매핑 (Record exhaustive — 누락 시 컴파일 실패) | `src/model-router/domain/agent-provider.map.ts` |
| 에이전트 레지스트리 (spec이 양방향 집합 일치 강제) | `src/agent-registry/agent-registry.ts` |
| 에이전트 계약 (`Record<AgentType, AgentContract>`) | `src/agent-registry/agent-contract.ts` |
| TriggerType (`AUTOPILOT_INVEST_CRON` 선례) | `src/agent-run/domain/agent-run.type.ts` |
| 문서 카탈로그 | `pnpm docs:sync && pnpm docs:check` → `git add -f docs/agent-catalog.md` |

**autopilot task 등록 — standalone으로 넣는다.** 기존 그룹(`evening`/`noon`)의 맨 앞에 넣으면 그룹 스케줄 키가 바뀌어 기존 override가 조용히 무시된다. standalone이면 자기 자신이 그룹 첫 항목이라 안전하고, 대가로 Slack 메시지가 다이제스트에 합쳐지지 않고 독립 1건으로 나간다.

| 파일 | 변경 |
|---|---|
| `src/autopilot/domain/autopilot.playbook-defaults.ts` | `DEFAULT_PAPER_TRADING_CRON = '40 17 * * 1-5'` + `_TIMEZONE` |
| `src/autopilot/domain/autopilot.playbook.ts` | `PlaybookEntry` 1개 (standalone) |
| `src/autopilot/infrastructure/tasks/paper-trading.autopilot-task.ts` | `AutopilotTask` 구현 |
| `src/autopilot/autopilot.module.ts` | `imports` + `providers` + `AUTOPILOT_TASKS` useFactory의 **인자 목록과 `inject` 배열 양쪽**(`:175-242` — 순서 어긋나면 다른 task가 조용히 주입된다) |
| `src/app.module.ts` | `PaperTradingModule` 등록 |

**신규 env 3개** — `PAPER_TRADING_ENABLED`, `AUTOPILOT_PAPER_TRADING_SCHEDULE`, `AUTOPILOT_PAPER_TRADING_TIMEZONE`. 각각 4곳 동기(`.env.example` + `.env` + `src/config/app.config.ts` class-validator + README 표) 후 `pnpm check:env` green. 스케줄 키를 `app.config.ts`에 선언하지 않으면 orphan 검사에 걸린다.

**스키마 적용** — `pnpm db:push` 후 `pnpm prisma:generate` 하고 빌드한다. push 전에 다른 worktree의 스키마 상태를 확인한다(synchronize 방식이라 구 스키마 push가 새 테이블을 지운다).

### 수동 매매 입력

`scripts/paper-trade.ts` CLI. 단, 아래 제약을 지킨다.

- **CLI는 얇은 인자 파서로만 둔다.** 상태 변경은 전부 `application/` usecase를 호출한다. jest는 `rootDir: "src"`이고 `nest build`도 `src`만 컴파일하므로 `scripts/`는 3중 게이트 중 `lint:check`만 통과한다(lint glob은 `{src,test,scripts}`). 로직이 CLI에 있으면 검증 대상 밖에 놓인다.
- **`AppModule`을 부팅하지 않는다.** autopilot 스케줄러가 부팅 시 플레이북 CRON을 재등록하므로(`autopilot.scheduler.ts:43-44, 75, 91`) 돌고 있는 이대리의 예약 작업을 건드린다. `PaperTradingModule` + `PrismaModule`만 담은 전용 module로 `NestFactory.createApplicationContext`한다.
- Nest DI 밖이 아니므로 `ConfigService` 규칙이 그대로 적용된다(`register-holding.ts`의 `new PrismaClient()` 방식은 따르지 않는다).

### 1단계 범위 밖

- 미국 주식 — 환율 환산과 새벽 장시간이 붙어 복잡도가 두 배다. `currency` 컬럼만 열어두고 로직은 KRW·한국 시장만
- 배당·분할·상장폐지의 정식 처리 (감지 가드만 — §5-(1))
- 지정가 주문, 부분 체결의 잔량 이월
- 입출금

### 검증 방법

1. `pnpm exec jest src/paper-trading` — 순수 계산 전수(`pnpm test`는 jest를 2단계로 돌려 경로 필터가 먹지 않는다)
   - 평가액·수익률, 비용(매수·매도·시장별·원 단위 절사), 평균원가 갱신, `realizedPnl`, 불변식, 정수 수량 가드, 현금 초과 매수 거부, 보유 초과 매도 거부
2. **매수 → 다음 거래일 매도까지** CLI로 넣어 수수료·세금·`realizedPnl` 경로를 실제로 통과시킨다. 매수 1건만으로는 §5의 절반이 한 번도 실행되지 않는다.
3. **2종목 이상** 보유 상태에서 합산을 확인한다.
4. **휴장일을 하나 끼워** 주문 대기·스냅샷 미적재 경로를 통과시킨다.
5. 마감 리포트의 평가액을 토스 앱 실제 종가와 직접 대조한다.
6. 같은 거래일에 두 번 실행해 overwrite가 의도대로 동작하는지 확인한다.
7. **차트는 과거 60거래일 백필로 검증한다.** 스냅샷 1점으로 그린 그래프는 렌더러가 죽지 않았다는 것 외에 아무것도 증명하지 않는다. 백필 구간은 `isBackfilled=true`로 표시하고 성적 집계에서 제외한다 — 그 시점에 실제로 그 포지션을 보유하지 않았으므로 실적이 아니다.
8. 이미지 업로드는 `files:write` 스코프 확보 후 실제 발송으로 확인한다.

---

## 7. 2~4단계 개요

각 단계는 별도 스펙으로 나눈다. 여기서는 1단계 결정에 영향을 주는 것만 적는다.

### 2단계 — 종목 마스터와 지표 스크리너

"종목 제한 없음"은 그대로 구현 불가다. 상장 종목 약 2,800개의 시세·지표를 프롬프트에 담을 수 없다. LLM 앞단의 결정론적 압축 계층이 필수다.

```
2,800종목 → [지표 계산·정렬] → 상위 20~50종 → LLM 판단
```

**선행 과제 (1단계에서 결론만 정해둔다)**

- **`DailyPrice` 소유권 승격.** 현재 유일한 소비자가 `stock-monitor.repository.ts`다. 스크리너가 이를 읽으려면 `paper-trading`이 주식 감시 모듈에 의존하게 되는데, 그것은 피어 기능 모듈 간 역의존이다. `Ticker`/`DailyPrice` 접근을 `src/market-data/infrastructure/` 아래 공유 repository로 올리고 `StockMonitorRepository`가 그것을 쓰게 바꾼다.
- **장중 시세 구분 장치.** 스크리너가 `DailyPrice`에 쓰기 시작하면 §6의 회피가 무효가 되므로, 로드맵 §E가 남긴 "이 시세가 장 마감 후 것인가" 판별을 2단계 선행으로 편입한다.

**해결해야 하는 제약**

- **200봉 조용한 절단.** `count = Math.min(days, 200)` 후 `bars.slice(-days)`(`toss-market-data.client.ts:13, 30, 55`) — `fetchDailyBars(symbol, 250)`은 에러 없이 200봉을 돌려준다. 52주(약 250거래일) 지표를 그대로 구현하면 **40주 고가를 52주 고가라 부르는 지표**가 조용히 만들어진다. MA120도 여유가 거의 없다.
- **페이지네이션 미구현.** `/candles`에 `before` 상한과 `nextBefore` 커서가 있는데 클라이언트는 `symbol/interval/count/adjusted`만 보낸다. 250봉 이상은 클라이언트 확장이 전제다.
- **`/prices` 배치 활용.** 현재가를 종목별로 두드릴 필요가 없다. 복수 종목 일괄 조회로 전종목 스윕 비용이 크게 준다.
- **레이트 리미터 교체.** 220ms 간격은 단일 인스턴스 순차 가정이고 주석이 직접 경고한다(`:63-64`). 전종목 스윕은 다른 시세 소비자와 겹치는 것이 확정적이므로 엔드포인트별 token bucket이 필요하다.
- **`Ticker.market` 조달.** `market`은 required이고 유니크 키의 일부인데, 종목코드만으로는 KOSPI/KOSDAQ를 채울 수 없다. DART 고유번호 파일에 시장 구분이 있는지 확인이 필요하고, 없으면 조달 경로를 정해야 한다. §3의 `market='KR'` 결정과 충돌하지 않게 통일한다.

### 3단계 — 추천과 자동 가상 매매

- 스크리너 후보 + DART 공시·재무 + 뉴스를 근거로 장투·단타를 분리 추천, 전략별 계좌에 자동 체결.
- **추천 품질 측정은 계좌 수익률로 하지 않는다.** 계좌 수익률은 자본 투입률에 좌우된다 — 장투가 자금 100%를 넣어 +10%면 계좌 +10%, 단타가 10%만 넣어 +50%면 계좌 +5%다. 계좌 수익률은 장투 우위라고 말하지만 추천 자체의 수익성은 단타가 높다. 보유 기간이 다른 것도 같은 문제다(30일 +5% vs 3일 +3%).

  따라서 두 층으로 측정한다.
  - **추천 단위**: 고정된 진입·청산 규칙 아래 기간별 순수익률, 같은 기간 벤치마크 초과수익, 적중률, 최대 미실현 손실·이익
  - **포트폴리오 단위**: 같은 초기자본·포지션 사이징 아래 시간가중수익률, 변동성, 최대 낙폭, 회전율과 순비용
- **as-of 데이터 보존.** 나중에 수집한 정정공시·수정 재무제표를 과거 판단 입력으로 쓰면 당시 알 수 없던 정보가 섞인다. 공시의 실제 공개 시각, 원본 버전, 수집 시각, 판단 입력 스냅샷을 보존하고, 사후 재계산 시 입력을 최신 데이터로 교체하지 않는다. 유니버스도 날짜별 상장 상태를 쓴다(현재 상장 종목만으로 과거를 재평가하면 상장폐지 종목이 빠져 성적이 부풀려진다).
- 전략별 horizon이 필요하다. `DEFAULT_HORIZON_DAYS = 5`를 장투에 그대로 쓰면 장투가 구조적으로 불리해진다.
- 프롬프트·지표 변경 시점을 기록해 성적 구간을 나눠 읽을 수 있게 한다. 성적을 보며 규칙을 계속 손대면 지나간 구간에만 맞는 규칙으로 수렴한다.

### 4단계 — 그래프 확대

종목별 캔들 차트, 지표 오버레이, 전략별 성적 비교.

---

## 8. 선행 로드맵과의 관계

`docs/superpowers/plans/2026-08-06-invest-line-roadmap.md`(2026-08-06)와 이 스펙의 접점을 정리한다.

| 로드맵 항목 | 이 스펙과의 관계 |
|---|---|
| §D 판정 규칙 추가 (보류 — 과거 시세 수집 선행, 52주는 200봉으로 부족) | 이 스펙 2단계 스크리너가 같은 데이터를 요구한다. 페이지네이션 정정 문서(`2026-08-06-toss-market-data-premise-correction.md`)로 차단 사유가 해소됐으므로, 2단계 지표 계산과 §D 판정 규칙은 **같은 수집 기반을 공유**한다. 중복 구현하지 않는다 |
| §E 장중 시세 적재가 판정을 막는 문제 (판단 필요) | 이 스펙 §6이 `DailyPrice` 미기록으로 회피한다. 2단계에서 회피가 불가능해지므로 §E를 2단계 선행 과제로 승격한다 |
| §B 알림 성적표 (2순위, 데이터 대기 중) | 3단계 추천 채점과 목적이 겹친다. 경보 채점은 `StockAlert`에 묶여 있어 코드 재사용은 안 되지만, **성적 지표 정의는 통일**한다 |
| §A 매매 자동 감지 (1순위) | 실계좌 대상이라 이 스펙과 독립 |

---

## 9. 미검증 사항

착수 전 또는 구현 착수 시점에 확인해야 한다.

| 항목 | 확인 방법 | 미확인 시 영향 |
|---|---|---|
| Slack `files:write` 스코프 | 앱 설정에서 추가 후 재설치 | 이미지 발송 불가. 재설치 시 토큰 갱신으로 전체 발송이 일시 중단될 수 있다 |
| `adjusted=false` 응답 형태 | 실호출 1건 | §5-(1)의 미조정 가격 조달 경로가 막힌다 |
| 증권거래세·수수료 현행 요율 | 공식 자료 확인 | 성적 정확도에 직접 영향 |
| KOSPI 지수 시세 조달 | 토스 심볼 확인, 없으면 Yahoo `^KS11` | 벤치마크 컬럼이 빈다 |
| DART 고유번호 파일의 시장 구분 포함 여부 | 파일 1건 확인 | 2단계 `Ticker.market` 조달 경로 미정 |
| DART 호출 한도 | 문서 확인 | 2,800종목 재무 수집 순서를 후보군 한정으로 바꿔야 할 수 있다 |
| 캔들 fixture가 실측인지 | 실호출 1건으로 OHLC 확인 | 이 레포에 "존재하지 않는 형태의 mock이 6주간 통과" 전례가 있다 |

### 1단계에 남는 알려진 한계

**세부 시장(KOSPI/KOSDAQ/KONEX)이 종목에 저장되지 않는다.** `Ticker.market` 은 토스 경로의 identity 인 `'KR'` 이라 세부 시장을 담을 자리가 없고, 세율 계산용 시장은 매매 명령 인자로만 전달된다. 그래서 같은 종목의 매수와 매도에 다른 시장을 입력해도 시스템이 막지 못한다.

지금 실질 영향은 작다 — KOSPI 와 KOSDAQ 의 총 세율이 같아(둘 다 0.20%) 값이 갈리는 것은 KONEX(0.10%)뿐이다. 2단계에서 종목 마스터에 시장 구분을 채울 때(§7 `Ticker.market` 조달) 해소한다. 그때 `PaperTrade` 에 적용 시장을 함께 기록하면 "이 거래의 세금이 왜 이 값인가"를 사후 재구성할 수 있다.

### 구조적 리스크

**LLM 추천의 품질은 이 설계가 보장하지 못한다.** 이 설계가 보장하는 것은 추천이 얼마나 맞았는지를 정직하게 측정하는 장치까지다. 성적이 나쁘면 그 사실이 드러나는 것이 정상 동작이다.
