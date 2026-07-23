# 미국 시장 모니터링 설계 (Spec 2)

작성일: 2026-07-23
전제: [보유 종목 모니터링 Spec 1](./2026-07-22-stock-monitor-design.md) 머지 완료

## 1. 배경과 목표

Spec 1은 국내 종목만 모니터링한다(`.KS`/`.KQ`). 사용자가 미국 주식도 보유하므로 미국 시장을 확장한다.

목표: 보유한 미국 주식을 미국 장 마감 후 자동 점검해, 국내와 동일한 규칙(전일 ±8%, 평단 -20%/+30%)으로 Slack DM 알림을 보낸다. 손익은 현지 통화(USD)와 원화 환산을 함께 표시한다.

**데이터 소스는 Yahoo를 유지한다.** `yahoo-finance2`가 미국 종목(`AAPL`)과 환율(`KRW=X`)을 이미 제공하는 것을 실측했다. 토스증권 앱키가 발급되면 시세 소스를 토스로 교체할 수 있으나(포트 구조라 어댑터만 교체), 그때까지 미국 모니터링을 미루지 않는다.

## 2. 핵심: 판정과 스키마는 재사용한다

미국 확장이 작은 이유다.

**판정 함수는 그대로 작동한다.** `detectDailyChange`·`detectAvgPriceBreach`는 통화 무관한 백분율 기반이다. 당일 대 전일, 현재가 대 평단을 같은 통화끼리 비교하므로 USD 종목도 손대지 않고 판정된다.

**스키마도 이미 준비됐다.** `Ticker.marketCountry`·`currency`는 토스 작업(#154)에서 추가됐다. 미국 종목은 `marketCountry='US'`, `currency='USD'`로 들어간다.

즉 실제 신규 작업은 다음으로 한정된다.

## 3. 확장 항목

### 3.1 미국 심볼 인식 (mapper)

현재 `yahoo-finance.mapper.ts`는 접미사(`.KS`/`.KQ`)로만 시장을 판별하고, 접미사가 없으면 거부한다. 미국 심볼은 접미사가 없다(`AAPL`, `MSFT`).

- `MarketCode`에 `'NASDAQ' | 'NYSE'` 추가.
- 심볼에 `.`이 없으면 미국으로 보고, `quote`의 `fullExchangeName`으로 거래소를 판별한다(실측: `NasdaqGS` → NASDAQ, `NYSE` → NYSE). 예상 밖 거래소면 거부한다.
- 국내 종목의 오염 응답 차단(Spec 1 §3.1)은 접미사 기반이라 미국에는 다른 검증이 필요하다. 미국은 `currency`가 `USD`인지, `fullExchangeName`이 알려진 미국 거래소인지로 검증한다.

### 3.2 환율 — 표시 전용, 판정과 분리

미국 종목 손익을 원화로도 보여준다. **환율은 표시에만 쓰고 판정에는 쓰지 않는다.** 판정은 USD 기준(평단 USD 대 현재가 USD)으로 하므로 환율 조회가 실패해도 판정은 정상 동작하고 원화 병기만 생략된다(graceful).

- 신규 모델 `DailyFxRate(date, pair, rate)`. `pair`는 `'USDKRW'`. `@@unique([pair, date])`로 upsert.
- 미국 cron 실행 시 `KRW=X`를 조회해 저장한다.
- 금액은 `Decimal @db.Decimal(18,4)`. 환율은 소수점이 크므로 `@db.Decimal(18,6)`.

### 3.3 미국 cron

미국 정규장 마감은 16:00 ET다. 서머타임으로 KST 기준 시각이 이동한다(EDT 05:00 / EST 06:00 KST).

- 신규 플레이북 항목 `stock-monitor-us`. `timezone: 'America/New_York'`, `schedule: '30 16 * * 1-5'`(마감 30분 후). 스케줄러가 타임존을 지원하므로 서머타임이 자동 반영된다.
- 기존 `stock-monitor`(국내, `Asia/Seoul` 17:10)는 그대로 둔다.
- `digestGroup`은 지정하지 않는다(고유 시각).

### 3.4 시장별 판정

한 태스크가 전체 보유 종목을 조회하면 국내·미국 마감 시각이 달라 한쪽이 낡은 데이터로 판정된다. 그래서 태스크를 `marketCountry`로 필터한다.

- `StockMonitorAutopilotTask`에 대상 시장(`KR`/`US`)을 주입한다. 기존 국내 태스크는 `KR`, 신규는 `US`.
- 리포지토리 `findCurrentHoldings`에 `marketCountry` 필터를 추가한다.

토스로 등록된 국내 종목(`marketCountry='KR'`, `yahooSymbol` null)이 Yahoo 조회로 유입되지 않도록 하는 기존 가드(#154)는 유지한다.

### 3.5 포맷터 — 통화·원화 병기

미국 종목 알림에 현지 통화와 원화 환산을 함께 싣는다.

```
🇺🇸 AAPL -9.2% 급락 (USD 327.74, ₩485,000 상당)
```

원화 환산은 `DailyFxRate`가 있을 때만. 없으면 USD만 표시한다.

### 3.6 등록 스크립트

`register-holding.ts`가 접미사를 강제한다. 미국 심볼은 접미사가 없으므로 안내문과 검증을 조정한다. `resolveSymbol`이 미국 심볼(3.1)을 받으면 통과시킨다.

## 4. 휴장일

미국 휴장일은 국내와 겹치지 않고 조기 폐장(추수감사절 다음날 등 13:00 ET)도 있다. Spec 1의 "데이터로 판정" 방식을 그대로 쓴다 — 마지막 봉 날짜가 직전 저장분과 같으면 휴장으로 보고 판정을 건너뛴다. 별도 캘린더를 두지 않는다.

## 5. 구현 범위

1. `MarketCode` 확장 + mapper 미국 인식 + 검증. **TDD** (미국 정상/거소 판별/오염 차단).
2. `DailyFxRate` 모델 + 리포지토리 upsert/조회.
3. 미국 cron 항목 + 태스크 시장 파라미터화 + 리포지토리 `marketCountry` 필터.
4. 포맷터 통화·원화 병기. **TDD** (원화 있음/없음).
5. 등록 스크립트 미국 심볼.
6. env: 미국 cron 스케줄 override는 기존 패턴 따라 optional.

## 6. 검증

- `pnpm lint:check && pnpm test && pnpm build` 3중 green + `check:env` + `docs:check`.
- 실측 스모크: `AAPL` 조회·판정, `KRW=X` 환율 저장, 미국 종목 등록, 포맷터 원화 병기.
- Yahoo 미국 시세는 지연 0으로 실측됐다(국내 20분과 달리). 마감 후 배치라 무관.

## 7. 미확인 / 후속

- 미국 종목의 `fullExchangeName` 값이 `NasdaqGS`/`NYSE` 외에 어떤 변형이 있는지(예: `NasdaqGM`, `NYSEArca`) 실측으로 넓혀야 한다. 초기엔 알려진 값만 통과시키고 거부 로그로 관측한다.
- 토스 앱키 발급 시 시세·환율 소스를 토스로 교체(`/prices`, `/exchange-rate`). 판정·스키마·포맷터는 재사용.
- 원화 환산에 쓸 환율 시점(장 마감 시각 환율 vs 조회 시각 환율)은 표시용이라 조회 시각으로 충분하다. 정밀 손익이 필요해지면 매수 시점 환율까지 저장해야 하나 이번 범위 밖이다.
