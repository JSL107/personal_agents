# 토스증권 연동 설계 (Spec 2 후보)

작성일: 2026-07-22
전제: [보유 종목 모니터링 Spec 1](./2026-07-22-stock-monitor-design.md) 구현 완료 상태

## 1. 배경

Spec 1은 보유 종목을 스크립트로 수동 등록하고, 시세를 `yahoo-finance2`(비공식 API)로 받는다. 두 가지 한계가 있다.

**수동 등록의 한계** — 추가 매수나 부분 매도로 평단이 바뀔 때마다 다시 등록해야 한다. 갱신을 잊으면 알림 숫자가 실제 계좌와 어긋나고, 그 순간 도구를 신뢰할 수 없게 된다.

**Yahoo의 한계** — 비공식 경로라 응답 형식 변경 시 깨지고, 국내 시세가 20분 지연되며, 잘못된 심볼에 예외 대신 엉뚱한 값을 반환한다(Spec 1에서 mapper로 방어 중).

사용자가 토스증권을 사용하며, 토스증권이 공식 Open API를 제공한다는 것을 확인했다. 이 API가 두 한계를 동시에 해소한다.

## 2. 확인된 API 스펙

`https://openapi.tossinvest.com/openapi-docs/latest/openapi.json`에서 확인한 사실이다. 실제 호출로는 아직 검증하지 못했다(앱키 미발급).

**서버**: `https://openapi.tossinvest.com`

**인증** — OAuth 2.0 Client Credentials

```
POST /oauth2/token
Content-Type: application/x-www-form-urlencoded
grant_type=client_credentials&client_id=...&client_secret=...

응답: { access_token, token_type: "Bearer", expires_in }
```

`expires_in`(초)만큼 유효하므로 만료 전 갱신이 필요하다.

**계좌 조회** — `GET /api/v1/accounts`

| 필드 | 설명 |
|---|---|
| `accountNo` | 계좌번호 |
| `accountSeq` | 계좌 식별 키. 이후 모든 호출의 `X-Tossinvest-Account` 헤더 값 |
| `accountType` | 현재 `BROKERAGE`만 지원 (국내·해외 통합 매매 계좌) |

**보유 종목 조회** — `GET /api/v1/holdings`

필수 헤더 `X-Tossinvest-Account: {accountSeq}`. `symbol` 쿼리를 생략하면 전체를 반환한다.

응답 `result.items[]`의 각 항목:

```json
{
  "symbol": "005930",
  "name": "삼성전자",
  "marketCountry": "KR",
  "currency": "KRW",
  "quantity": "100",
  "lastPrice": "72000",
  "averagePurchasePrice": "65000",
  "profitLoss": { "amount": "700000", "rate": "0.1077" },
  "dailyProfitLoss": { "amount": "100000", "rate": "0.0141" },
  "cost": { "commission": "14400", "tax": "135600" }
}
```

모든 수치가 문자열이다. 정밀도 손실을 막으려면 `Number`로 바꾸지 말고 문자열 그대로 `Decimal`에 넣어야 한다.

**그 외 쓸 만한 엔드포인트**

| 경로 | 용도 |
|---|---|
| `GET /api/v1/prices`, `/api/v1/candles` | 시세·일봉. 심볼만으로 국내·미국 통합 처리 |
| `GET /api/v1/market-calendar/KR`, `/US` | 휴장일 캘린더. Spec 1의 "데이터로 추정" 방식을 정식 캘린더로 대체 가능 |
| `GET /api/v1/exchange-rate` | 환율. 미국 종목 원화 환산에 필요 |
| `GET /api/v1/stocks` | 종목 정보 |

## 3. 이 연동이 해소하는 것

`/holdings` 응답 하나에 **Spec 1의 두 판정 규칙에 필요한 데이터가 전부 들어 있다.**

| Spec 1 규칙 | 필요한 값 | 토스 응답 필드 |
|---|---|---|
| `daily-change` (전일 대비) | 당일 등락률 | `dailyProfitLoss.rate` |
| `avg-price-breach` (평단 대비) | 평단 대비 손익률 | `profitLoss.rate` |

즉 시세를 따로 조회하지 않아도 판정이 성립한다. 부수적으로 심볼 오염 문제도 사라진다 — 내 계좌의 종목만 오므로 잘못된 심볼이 들어올 경로가 없다.

## 4. 설계 결정이 필요한 지점

단순 추가가 아니라 데이터 소스 전환이므로, 착수 전에 다음을 정해야 한다.

### 4.1 시장 구분 불일치

토스는 `marketCountry`로 `KR`/`US`만 준다. **코스피와 코스닥을 구분하지 않는다.** 반면 Spec 1의 `Ticker.market`은 `KOSPI`/`KOSDAQ`이고 `yahooSymbol`(`005930.KS`)을 필수로 갖는다.

세 가지 선택지가 있다.

**(A) 토스를 잔고 소스로만 쓰고 시세는 Yahoo 유지** — `005930` → `.KS`인지 `.KQ`인지 알 수 없어, Yahoo에 둘 다 조회해 맞는 쪽을 찾아야 한다. 지저분하고 오조회 위험이 남는다. 권장하지 않는다.

**(B) 토스로 완전 전환** — `yahooSymbol`을 버리고 `market`을 `KR`/`US`로 바꾼다. Yahoo 어댑터와 mapper는 제거하거나 fallback으로만 남긴다. 판정 함수 시그니처도 `DailyBar` 기반에서 손익률 기반으로 조정한다. **가장 깔끔하지만 Spec 1 코드에 손이 많이 간다.**

**(C) 병행** — 잔고는 토스, 시세·일봉은 토스 `/candles`. `Ticker`에 `tossSymbol`과 `marketCountry`를 추가하고 `yahooSymbol`은 nullable로 강등. 점진 전환이 가능하다.

**권장: (C)로 시작해 (B)로 수렴.** Spec 1이 이미 동작 중이므로 한 번에 갈아엎기보다, 잔고 동기화를 먼저 붙여 효용을 확인하고 시세를 옮긴다. `MarketDataPort`를 둔 것이 이 전환을 가능하게 한다.

### 4.2 판정 입력을 무엇으로 할 것인가

`dailyProfitLoss.rate`가 "전일 종가 대비"인지 "당일 시가 대비"인지 문서에 명시되어 있지 않다. **실제 호출로 확인해야 한다.** 전자면 Spec 1의 `daily-change`를 그대로 대체할 수 있고, 후자면 `/candles`로 전일 종가를 따로 받아야 한다.

### 4.3 평단 대비 최초 진입 판정

Spec 1은 "어제는 구간 밖, 오늘은 구간 안"을 전일 봉으로 계산한다. 토스는 현재 상태만 주므로 **어제 상태를 DB에 남겨야 한다.** `DailyPrice`에 평단 대비 손익률을 함께 저장하거나, 별도 상태 테이블을 둔다.

### 4.4 동기화 시점과 방식

매수·매도를 실시간으로 알 수 없으므로 주기적 동기화가 필요하다. 모니터링 cron(평일 17:10) 직전에 잔고를 먼저 받아오면 항상 최신 상태로 판정한다. 별도 cron을 두는 것보다 같은 태스크 안에서 순차 실행하는 편이 단순하다.

**매도로 사라진 종목** 처리도 정해야 한다. `Holding`을 삭제할지, 수량 0으로 남길지. 알림 이력(`StockAlert`)과의 외래키를 고려하면 삭제보다 수량 0이 안전하다.

## 5. 구현 범위 (앱키 발급 후)

1. `TossInvestClient` — 토큰 발급·캐시·만료 전 갱신, `accounts`, `holdings` 조회
2. `toss-holdings.mapper.ts` — 응답 → 도메인 타입 변환·검증. OpenAPI 예시를 fixture로 써서 테스트한다(Yahoo mapper와 동일 패턴)
3. `SyncHoldingsUsecase` — `holdings` → `Ticker`/`Holding` upsert. 사라진 종목 처리 포함
4. 모니터링 태스크에 동기화 선행 단계 추가
5. env 4곳 동기: `TOSS_CLIENT_ID`, `TOSS_CLIENT_SECRET`, `TOSS_ACCOUNT_SEQ`(또는 `accounts`로 자동 조회)

시크릿이 늘어나므로 `.env`에만 두고 커밋하지 않는다. 기존 규칙 그대로다.

## 6. 선행 조건과 미확인 사항

**선행 조건**: 토스증권 Open API 앱키 발급. 신청은 https://corp.tossinvest.com/ko/open-api 에서 한다.

**미확인 — 실제 호출 전에는 알 수 없는 것들**:

- **개인 개발자에게 발급되는지, 심사가 있는지.** 공식 페이지가 JavaScript 렌더링이라 신청 자격을 확인하지 못했다. 이것이 이 설계 전체의 전제다.
- 요청 한도(rate limit). 스펙에 수치가 명시되어 있지 않다.
- `dailyProfitLoss.rate`의 기준 시점 (4.2)
- 응답 예시와 실제 응답의 일치 여부

**착수 판단**: 앱키가 발급되고 `/accounts`와 `/holdings`가 실제로 응답하는 것을 확인한 뒤에 구현을 시작한다. 그 전에는 검증할 수 없는 코드가 쌓일 뿐이다.

## 7. 그동안의 대안

앱키를 기다리는 동안에도 Spec 1은 수동 등록으로 동작한다. 종목 한두 개를 등록해 며칠 돌려보면 다음을 먼저 알 수 있다.

- 알림이 실제로 쓸모 있는지
- 임계값(전일 ±8%, 평단 -20%/+30%)이 보유 종목 성격에 맞는지
- 조용한 계기판 방식이 견딜 만한지

이 확인이 선행되면 토스 연동에 들일 노력의 가치도 함께 판단할 수 있다.
