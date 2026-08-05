# 투자 에이전트 설계 (Spec 4) — 잠든 파이프라인을 직원으로 깨우기

2026-08-05 기준. 선행 문서는 Spec 1 [보유 종목 모니터링](./2026-07-22-stock-monitor-design.md),
Spec 2 [토스증권 연동](./2026-07-22-toss-holdings-sync-design.md) ·
[미국 시장](./2026-07-23-stock-monitor-us-design.md), Spec 3-A [알림 사후 채점](./2026-07-23-stock-alert-outcome-design.md).

---

## 1. 한 줄 요약

주식 기능은 **이미 만들어져 있고 매일 정해진 시각에 실행되고 있지만, 다루는 데이터가 0건이라
아무 일도 일어나지 않는다.** 그리고 그 사실을 알아차릴 방법이 시스템 안에 없다. 이 문서는
데이터를 채워 파이프라인을 실제로 가동시키고, 그 일을 맡는 사람을 오피스에 세워
"돌고 있는지"가 눈에 보이게 만드는 설계다.

---

## 2. 배경 — 실측한 현재 상태

### 2.1 이미 만들어진 것

| 구성 | 위치 | 상태 |
|---|---|---|
| 토스증권 API 클라이언트 | `src/market-data/infrastructure/toss/toss-invest.client.ts` | 구현 완료 |
| Yahoo Finance 시세 | `src/market-data/infrastructure/yahoo-finance.market-data.client.ts` | 구현 완료 |
| 잔고 동기화 | `src/agent/stock/application/sync-holdings.usecase.ts` | 구현 완료 |
| 이상 탐지 판정 | `src/agent/stock/domain/stock-anomaly.ts` | 구현 완료 |
| 알림 사후 채점 | `src/agent/stock/domain/alert-outcome.ts` | 구현 완료 |
| DB 스키마 | `Ticker` · `DailyPrice` · `Holding` · `StockAlert` · `AlertOutcome` · `DailyFxRate` | 6개 모델 |
| 자동 실행 등록 | `src/autopilot/autopilot.module.ts` | cron 3개 |

자동 실행 스케줄은 `src/autopilot/domain/autopilot.playbook-defaults.ts`에 다음과 같이 잡혀 있다.

| 작업 | 시각 | 하는 일 |
|---|---|---|
| `stock-monitor` | 평일 17:10 (서울) | 국내 장 마감 후 보유 종목 점검 |
| `stock-monitor-us` | 평일 16:30 (뉴욕) | 미국 장 마감 후 점검 |
| `stock-alert-scoring` | 평일 18:00 (서울) | 지난 알림이 맞았는지 사후 채점 |

토스 클라이언트는 오늘 확인한 공식 스펙과 정확히 일치한다 — OAuth 2.0 Client Credentials,
`POST /oauth2/token`, `GET /api/v1/holdings`에 `X-Tossinvest-Account` 헤더. 사람이 앱에서
승인을 눌러야 하는 방식이 아니라서 **무인 자동 실행에 제약이 없다.**

### 2.2 비어 있는 것

로컬 PostgreSQL(5434, `idaeri` DB)을 직접 조회한 결과다.

```
ticker=0   holding=0   daily_price=0
stock_alert=0   alert_outcome=0   daily_fx=0
```

**모든 주식 테이블이 0건이다.** 종목이 한 종목도 등록되지 않았다.

`stock-monitor`는 "보유 종목을 순회하며 점검하는" 작업이다. 보유 종목이 없으면 순회할 대상이
없으므로, cron은 매일 정확히 실행되면서 매번 아무 일도 하지 않고 끝난다. 실패가 아니라
**정상적으로 0건 처리**다. 그래서 로그에도 이상이 남지 않는다.

### 2.3 꺼져 있을 수도 있다 — 스위치가 하나 더 있다

`stock-monitor.autopilot-task.ts`의 첫 줄은 환경변수 검사다.

```ts
const enabled = this.configService.get<string>('STOCK_MONITOR_ENABLED');
if (enabled !== 'true') { return { skip: true }; }
```

`.env.example`의 기본값은 `STOCK_MONITOR_ENABLED=false`다. 실제 `.env` 값은 파일 접근이
차단되어 확인하지 못했다. 즉 이 라인이 멈춰 있는 이유는 **둘 중 하나이거나 둘 다**다.

1. 감시 스위치가 꺼져 있다 (`STOCK_MONITOR_ENABLED`)
2. 켜져 있어도 감시할 종목이 0건이다

두 원인은 겉으로 똑같이 "아무 일도 안 일어남"으로 보인다. 구분하려면 원장이 필요하다 —
그것이 4절의 결론으로 이어진다.

### 2.4 토스 앱키는 아직 없다 (실측)

`scripts/sync-toss-holdings.ts`를 실제로 실행해 확인했다.

```
토스증권 잔고 동기화 실패 — 토스증권 잔고 동기화가 비활성 상태입니다.
TOSS_CLIENT_ID와 TOSS_CLIENT_SECRET을 설정하세요.
```

클라이언트 코드는 완성되어 있으나 **자격증명이 없어 한 번도 호출된 적이 없다.** 토스증권
Open API는 2026년 5월 사전 신청을 받아 순차 개방 중이며(신청 5.5만 명), 차례가 오면
토스증권 PC웹의 설정 → Open API에서 `client_id`/`client_secret`을 직접 발급받는다.

부수 확인: 실행 중 `yahoo-finance2`가 Node 22 요구 경고를 냈다. 다만 저장소의 `.nvmrc`는
`22`이고 `package.json`의 `engines`도 `>=22`이므로 프로젝트 설정 자체는 정상이다. 실행 셸이
Node 20이었던 것이 원인이며, Node 22로 전환해 검증했다.

### 2.5 그리고 아무도 그걸 모른다

`agent_run` 원장에는 지금까지 409건의 실행 기록이 쌓여 있다. 그중 **주식 관련 기록은 0건이다.**

| 에이전트 | 트리거 | 실행 수 | 마지막 |
|---|---|---|---|
| WORK_REVIEWER | DAILY_EVAL_CRON | 85 | 2026-08-04 |
| PM | MORNING_BRIEFING_CRON | 78 | 2026-08-04 |
| PO_EVAL | DAILY_EVAL_CRON | 76 | 2026-08-04 |
| CODE_REVIEWER | PR_REVIEW_SWEEP | 46 | 2026-08-05 |
| … | | | |
| **(주식)** | **—** | **0** | **—** |

이유는 명확하다. `AgentType` enum에 주식에 해당하는 항목이 없다. 원장에 기록되는 작업은
`AgentRunService.execute`로 감싸인 것들이고, 그러려면 `AgentType`이 있어야 한다. 실제로
`PO_SHADOW | AUTOPILOT_PO_SHADOW_CRON`처럼 **AgentType이 있는 autopilot 작업은 기록이 남는다.**
주식만 없다.

원장에 없다는 것은 세 가지를 뜻한다.

- 실행 성공·실패 이력이 남지 않는다 → 조용히 죽어도 알 수 없다
- `/retry-run`으로 재실행할 수 없다
- 오피스 화면에 그 일을 하는 사람이 없다 → 시각적으로도 존재하지 않는다

### 2.6 로드맵에서도 빠져 있다

최신 로드맵 `docs/superpowers/plans/2026-08-04-roadmap-refresh.md`에 주식·투자 관련 항목이
하나도 없다. 7월 23일 이후 이 라인은 사실상 방치 상태다.

### 2.7 선행 문서가 남긴 숙제

Spec 2 §7 "그동안의 대안"은 이렇게 적고 있다.

> 앱키를 기다리는 동안에도 Spec 1은 수동 등록으로 동작한다. 종목 한두 개를 등록해 며칠
> 돌려보면 알림이 실제로 쓸모 있는지, 임계값이 보유 종목 성격에 맞는지 먼저 알 수 있다.

**이 확인이 수행되지 않았다.** 데이터 0건이 그 증거다. 그 결과 임계값(전일 ±8%, 평단
-20%/+30%)이 실제 보유 종목에 맞는지 아직 아무도 모른다.

---

## 3. 목표와 성공 기준

### 목표

1. 파이프라인을 실제로 가동시킨다 — 데이터가 흐르게 한다
2. 돌고 있다는 사실이 **원장과 화면 양쪽에서 확인 가능**하게 한다
3. 그 위에 포트폴리오 분석·종목 추천을 얹을 자리를 만든다

### 성공 기준

- [ ] `holding` 테이블에 실제 보유 종목이 들어 있다
- [ ] `daily_price`가 매 영업일 갱신된다
- [ ] `agent_run`에 투자 에이전트 실행 기록이 남는다 (성공·실패 모두)
- [ ] 오피스 화면에 담당 직원이 서 있고, 실행 중일 때 상태가 바뀐다
- [ ] 임계값이 실제 보유 종목에 맞는지 2주간 관찰한 판단이 기록된다

---

## 4. 핵심 결정: 직원을 하나 만든다

### 4.1 결론

**`AgentType.INVEST` 하나를 신설한다. 하나만 만든다.**

### 4.2 왜 만드는가

직원을 만든다는 것은 오피스에 캐릭터가 하나 늘어나는 것 이상의 의미가 있다. 이대리에서
`AgentType`은 **실행 원장에 등록될 자격**이다.

| 지금 (AgentType 없음) | 만든 뒤 |
|---|---|
| 실행 이력이 남지 않음 | `agent_run`에 성공·실패 기록 |
| 실패해도 조용함 | 실패가 원장에 남고 화면에 뜸 |
| `/retry-run` 불가 | 실패한 실행을 재실행 가능 |
| 오피스에 사람 없음 | 담당자가 자리에 앉아 있음 |
| 근거 추적 없음 | `EvidenceRecord`로 판정 근거 보존 |

2.3에서 본 문제 — "데이터가 0건인데 아무도 몰랐다" — 가 정확히 원장 부재에서 온다.
직원을 만드는 것은 장식이 아니라 **관측 가능성을 얻는 일**이다.

그리고 다음 단계인 포트폴리오 분석은 LLM 추론이 필요하다. 이대리에서 LLM을 부르는 경로는
`ModelRouterUsecase.route`이고, 그것은 `AgentType`을 인자로 받는다. 어차피 필요하다.

### 4.3 왜 하나만 만드는가

조회·분석·추천을 각각 직원으로 나누고 싶은 유혹이 있지만, 세 가지 이유로 하나로 둔다.

- **현재 27명이다.** 오피스는 이미 붐빈다. 역할이 잘게 쪼개질수록 화면에서 누가 무슨 일을
  하는지 읽기 어려워진다.
- **실제로 한 사람의 일이다.** 잔고를 보고 → 이상을 찾고 → 의견을 내는 것은 하나의 연속된
  업무다. 사람 회사에서도 이걸 세 명이 나눠 하지 않는다.
- **체크리스트 비용이 3배가 된다.** 새 에이전트 하나마다 `AGENTS.md §4`의 14개 항목을
  통과해야 한다.

### 4.4 이름

| 항목 | 값 | 근거 |
|---|---|---|
| `AgentType` | `INVEST` | `STOCK`은 이미 모듈·테이블 이름으로 쓰여 혼동. 미국 주식·환율까지 다루므로 "주식"보다 넓은 말이 맞다 |
| 오피스 직책 | `투자 관리` | `AgentRole.swift`는 6자 안팎 권장. 5자 |
| 부서 | 성장 | `CAREER_MATE`(커리어) · `BLOG`(블로그)와 같은 계열 — 개발 업무가 아닌 개인 자산 라인 |

---

## 5. 단계별 설계

### 5.1 1단계 — 파이프라인 점화 (코드 변경 최소)

**가장 먼저 할 일은 코드를 쓰는 게 아니라 데이터를 넣는 것이다.**

토스 앱키가 이미 발급된 경우:

```bash
pnpm exec ts-node scripts/sync-toss-holdings.ts
```

아직 발급 전인 경우 — 수동으로 2~3종목 등록해 먼저 굴려본다. Spec 2 §7이 권한 방식이고,
이걸 해야 임계값이 맞는지 알 수 있다.

```bash
pnpm exec ts-node scripts/register-holding.ts 005930.KS 68200 10
pnpm exec ts-node scripts/register-holding.ts AAPL 210.50 3
```

등록 뒤 다음 영업일 17:10에 `stock-monitor`가 처음으로 실제 작업을 한다. **이 단계에서
코드 변경은 없다.** 이미 다 만들어져 있다.

관찰 기간은 2주로 잡는다. 관찰 항목:

- 알림이 몇 번 울리는가 (설계 예측: 월 1.5~2.7회)
- 울린 알림이 볼 가치가 있었는가
- 임계값을 조정해야 하는가

### 5.2 2단계 — 직원 신설과 원장 편입 ✅ 구현 완료

**순서를 바꾼 이유 (이 문서의 초안과 다르다)**

초안은 "1단계에서 쓸모가 확인된 뒤에 2단계"라고 적었다. 실제로는 2단계를 먼저 했고, 그
판단이 초안보다 낫다고 본다. 근거는 둘이다.

- **1단계가 사람 손에 막혀 있다.** 앱키가 없고(2.4), 수동 등록에는 실제 보유 종목·평단·수량이
  필요하다. 코드로 넘길 수 있는 일이 아니다.
- **관측 설비가 없으면 1단계 관찰 자체가 불가능하다.** 초안의 순서는 "쓸모없는 기능에 설비를
  붙이지 말자"는 원칙에서 나왔는데, 정작 *쓸모를 판정할 근거*가 원장에 남는 실행 기록이다.
  설비 없이 2주를 굴리면 끝난 뒤에도 "며칠 돌았고 몇 번 울렸나"를 되짚을 수 없다.

즉 원장은 1단계의 **결과물이 아니라 계측기**다. 계측기를 먼저 단다.

**하는 일**

기존 `StockMonitorAutopilotTask`를 `AgentRunService.execute`로 감싸 원장에 남긴다.
판정 로직·스키마·cron은 **손대지 않는다.** 껍데기만 바뀐다.

```
현재:  autopilot cron → StockMonitorAutopilotTask → (기록 없음)
변경:  autopilot cron → AgentRunService.execute(INVEST) → StockMonitorAutopilotTask
                            └→ agent_run 기록 + EvidenceRecord + 오피스 표시
```

**AGENTS.md §4 체크리스트 적용 범위**

이 에이전트는 내부 autopilot 작업이므로 슬래시 커맨드 계열 항목이 빠진다.
`SUBCONSCIOUS_GATE` · `EVENING_RETRO`가 같은 선례다.

| # | 항목 | 대상 여부 |
|---|---|---|
| 1 | domain 타입·에러코드 | ✅ 기존 `stock/domain` 재사용 |
| 2 | usecase가 `AgentRunService.execute` 경유 | ✅ **이번 작업의 핵심** |
| 5 | AppModule 등록 | ✅ 이미 등록됨 |
| 7 | `TriggerType`에 `AUTOPILOT_INVEST_CRON` 추가 | ✅ |
| 8 | `AgentType` + `AGENT_TO_PROVIDER` | ✅ 3단계 전까지는 sentinel |
| 10 | 단위 테스트 | ✅ 기존 spec 유지 + 원장 기록 검증 추가 |
| 4·6·9·11·13 | 슬래시·ResponseCode·retry-run·README·manifest | ❌ 내부 작업 |
| 14 | 자연어 멘션 dispatcher | ⏸ 3단계에서 판단 |

**추가로 필요한 두 곳** (백엔드 체크리스트 밖이라 놓치기 쉽다)

- `src/agent-registry/agent-registry.ts` — `agent-registry.spec.ts`가 enum 집합 일치를
  강제하므로 등록하지 않으면 테스트가 깨진다
- `clients/idaeri-console/Sources/ConsoleCore/AgentRole.swift` — `case "INVEST": return "투자 관리"`.
  **빠뜨리면 조용히 어긋난다.** 백엔드 영문 식별명으로 폴백되어 이름표만 이상해지고 에러는 없다

**잔고 동기화도 이때 cron에 올린다.** 현재 `SyncHoldingsUsecase`는 수동 스크립트로만
호출된다. 매수·매도를 해도 이대리는 모른다. 국내 장 시작 전(평일 08:30 서울)에 한 번
돌려 그날의 보유 상태를 맞춘다.

### 5.3 3단계 — 분석과 추천

여기서 처음으로 LLM이 들어온다. 2단계까지는 전부 결정론적 계산이다.

**설계상 반드시 지킬 분리**

| 층 | 성격 | 출처 | 틀릴 수 있는가 |
|---|---|---|---|
| 숫자 | 사실 | 토스 API · Yahoo 시세 | 아니오 |
| 판정 | 규칙 | `stock-anomaly.ts` 임계값 | 규칙이 부적절할 수는 있음 |
| 의견 | 추론 | LLM | **예** |

세 층을 출력에서 시각적으로 갈라 놓는다. 수익률 숫자와 "지금 팔아야 한다"는 의견이 같은
문단에 섞이면, 틀릴 수 있는 것과 틀릴 수 없는 것이 같은 무게로 읽힌다.

이대리의 다른 에이전트는 틀려도 PR 리뷰가 좀 이상한 정도지만, 여기는 돈이 걸린다.
`humanize` 후처리를 태우더라도 **의견 층에만** 적용한다 — 숫자를 문장으로 풀어 쓰다
값이 바뀌면 안 된다.

**추천의 근거는 반드시 원장에 남긴다.** `EvidenceRecord`에 판정 시점의 가격·보유 상태를
기록해, 나중에 "그때 왜 그렇게 판단했나"를 되짚을 수 있어야 한다. Spec 3-A의 알림 사후
채점이 이미 같은 사상으로 만들어져 있으므로 그 구조를 그대로 쓴다.

---

## 6. 안전 — 주문은 구현하지 않는다

토스증권 Open API는 주문 생성·정정·취소, 그리고 조건주문까지 제공한다. 발급받은 열쇠에는
그 권한이 포함되어 있고, **공식 문서에 조회 전용으로 권한을 잘라내는 스코프가 없다.**

따라서 권한이 아니라 코드로 막는다.

현재 `TossInvestClient`는 `fetchHoldings()` 하나만 가지고 있다. `BrokerHoldingsPort`
인터페이스도 조회만 정의한다. **이 상태를 유지한다.**

> 없는 함수는 아무도 부를 수 없다. 승인 게이트는 사람이 잘못 눌러 통과시킬 수 있지만,
> 존재하지 않는 코드는 버그로도 사고가 나지 않는다.

실제 매매를 붙일 때가 오면 그때 `PreviewGate`(외부 부작용 ✅ 승인 게이트)와 함께 별도
설계로 다룬다. 이 문서의 범위 밖이다.

---

## 7. 검증

| 단계 | 무엇을 | 어떻게 | 결과 |
|---|---|---|---|
| 1 | 데이터가 들어갔나 | `select count(*) from holding where quantity > 0` | 미실행 (종목 등록 대기) |
| 1 | 시세가 갱신되나 | `daily_price`의 `max(trade_date)`가 직전 영업일인가 | 미실행 |
| 1 | 알림이 쓸모 있나 | 2주 관찰 — 발화 횟수와 체감 유용성 기록 | 미실행 |
| 2 | 원장에 남나 | 실제 DB 에 `INVEST` 행이 생기는가 | ✅ 아래 실측 |
| 2 | 게이트가 지켜지나 | 감시 off 실행이 원장을 늘리지 않는가 | ✅ 아래 실측 |
| 2 | 직책 가드가 도나 | `AgentRole.swift` 에서 INVEST 를 빼면 실패하는가 | ✅ 실패 확인 후 복구 |
| 2 | 실패가 보이나 | 강제 실패를 넣어 FAILED 가 기록되는지 | ❌ **미확인** |
| 2 | 화면에 나오나 | 실행 중인 앱에서 "투자 관리" 이름표 확인 | ❌ **미확인** (백엔드 미실행) |
| 3 | 숫자가 안 변하나 | LLM 출력의 수치를 원본 `holding` 값과 대조 | 해당 없음 (미착수) |

**2단계 실측 (2026-08-05)** — 보유 종목 0건 상태에서 국내 태스크를 직접 실행.

```
[사전] agent_run(INVEST)=0건, holding=0건
[실행] taskResult.skip=true
[사후] agent_run(INVEST)=1건 (증가 1)
[행]   status=SUCCEEDED  trigger=AUTOPILOT_INVEST_CRON  model=deterministic
[output] {"holdingCount":0,"checkedCount":0,"anomalyCount":0,"failureCount":0,
          "marketClosed":false,"lastTradeDate":null,"marketCountry":"KR"}
[대조군] 감시 off 로 재실행 → 1건 그대로 (증가 0)
```

화면에는 아무것도 보내지 않으면서(`skip=true`) 원장에는 `holdingCount: 0`이 남는다 —
이번 변경이 노린 것이 정확히 이 한 줄이다. 대조군이 함께 통과했으므로 "무조건 남기는" 것이
아니라 게이트가 실제로 갈림길로 작동한다.

공통 게이트: `pnpm lint:check` · `pnpm test`(2219+40) · `pnpm build` · `pnpm docs:check` 전부 통과.
콘솔은 `swift run ConsoleCoreTests` 1014건 통과(표본에 INVEST 편입으로 1012 → 1014).

---

## 8. 하지 않는 것

- **매매 주문** — 6절
- **종목 스크리닝** — 전종목 유니버스 수집과 DART 연동이 필요하다. Spec 1 §7이 이미
  "별도 프로젝트 규모"로 판정했고 그 판단은 유효하다
- **실시간 시세** — 현재 데이터는 20분 지연이다. 매매 타이밍 신호를 내려면 데이터 소스부터
  바꿔야 한다
- **다중 증권사** — `BrokerHoldingsPort`로 추상화는 되어 있으나 두 번째 구현체를 만들 이유가
  아직 없다

---

## 9. 확인하지 못한 것

- **토스 앱키의 실제 발급 여부.** `.env` 파일 읽기가 차단되어 `TOSS_CLIENT_ID`에 값이
  들어 있는지 직접 읽지는 못했다. 다만 동기화 스크립트를 실제로 실행해 **미설정임을 확인**
  했다(2.4) — 값 자체는 못 봤지만 결과는 확정이다
- **`STOCK_MONITOR_ENABLED`의 실제 값.** 같은 이유로 파일을 읽지 못했고, 이쪽은 실행으로도
  확인하지 못했다. 종목이 0건이라 켜져 있든 꺼져 있든 결과가 같기 때문이다. 종목을 등록한
  다음 원장에 `INVEST` 행이 생기는지로 판별된다 — 행이 없으면 스위치가 꺼진 것이다
- **토스 API의 실제 응답.** 클라이언트 코드는 스펙과 일치하나, 실호출 기록이 없어
  `/holdings` 응답이 매퍼 기대와 맞는지 확인되지 않았다. 첫 동기화가 곧 첫 검증이다
- **요청 한도.** Spec 2에서도 미확인이었고 지금도 공식 수치를 찾지 못했다. 보유 종목 수가
  적어 당분간 문제되지 않을 가능성이 높다
- **임계값의 적정성.** 데이터 0건이라 실측 근거가 없다. 1단계 2주 관찰의 목적이 이것이다
- **왜 종목을 등록하지 않았는가.** 앱키 대기였는지, 우선순위에서 밀렸는지, 의도적 보류였는지
  기록이 없다. 만약 의도적으로 접은 것이라면 이 문서의 전제부터 다시 봐야 한다

---

## 10. 착수 순서

```
완료       2단계 — INVEST 직원 신설 · 원장 편입 (계측기 설치)
 ↓
다음       1단계 — 종목 등록          ← 사람이 해야 하는 일
 ↓         · 앱키 있음 → sync-toss-holdings.ts 한 줄
 ↓         · 앱키 없음 → register-holding.ts 로 2~3종목 수동 등록
 ↓
 ↓         2주 관찰 — 이제 원장에 남으므로 되짚을 수 있다
판단       쓸모없다 → 임계값 조정 또는 라인 종료
 ↓         쓸모있다 → 계속
보류       잔고 동기화 cron (앱키 발급 후 — 키 없이 걸면 매일 실패만 쌓인다)
 ↓
3단계      포트폴리오 분석 → 종목 추천
```

남은 것 중 가장 값싼 한 걸음은 **명령어 한 줄**이다. 종목을 등록하고 2주 기다리는 것이 이
설계 전체에서 가장 적은 노력으로 가장 많은 것을 알려주는 단계다. 그리고 이제 그 2주 동안
무슨 일이 있었는지가 원장에 남는다.

```sql
-- 2주 뒤 이 쿼리 하나로 판정할 수 있다
select started_at::date, status, output
from agent_run where agent_type = 'INVEST' order by started_at desc;
```
