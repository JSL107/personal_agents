# 알림 사후 채점 설계 (Spec 3-A)

작성일: 2026-07-23
전제: [보유 종목 모니터링 Spec 1](./2026-07-22-stock-monitor-design.md) 구현 완료 (main 반영)

## 1. 배경과 목표

모니터링이 알림을 보내지만, 그 알림이 실제로 유의미했는지는 지금 알 수 없다. "-8% 급락" 알림 뒤 주가가 어떻게 됐는지 아무도 기록하지 않는다. 이게 없으면 임계값(±8%, -20%/+30%)이 좋은지 나쁜지 영원히 판단할 수 없다.

이 기능은 각 알림에 대해 **N거래일 뒤 실제 등락을 기록**한다. 통계적 우위 판정(event study, 다중검정 보정 등)은 이 범위가 아니다 — 개인 보유 종목 수로는 유의성이 안 나온다. 여기서는 **관측 가능한 사실만 남긴다**: 이 알림 뒤 주가가 얼마나 움직였나.

### 성공 기준

알림이 발생하고 N거래일이 지나면, 그 알림에 대한 사후 성과(발화 당시 가격 → N일 뒤 가격 → 등락률)가 DB에 기록되고 조회할 수 있다. 아직 N일이 안 지난 알림은 채점하지 않는다. 같은 알림을 두 번 채점하지 않는다.

## 2. 왜 지금 만드는가

`StockAlert`는 이미 알림을 기록 중이다(Spec 1). 채점 로직은 순수함수라 실제 데이터 없이 fixture로 검증된다. 기능을 켜서 알림이 쌓이기 시작하면 이 채점기가 곧바로 결과를 낸다. 즉 **지금 만들어도 낭비되지 않고, 실사용 시작과 동시에 값어치가 나온다.**

반대로 지금 만들지 않으면, 나중에 "그때 알림들이 어땠나"를 소급하려 해도 채점 인프라가 없어 다시 만들어야 한다. `StockAlert`에 발화 당시 값이 남아 있으므로 소급 채점 자체는 가능하지만, 그러려면 이 기능이 있어야 한다.

## 3. 설계

### 3.1 기록은 별도 테이블에 (덮어쓰지 않는다)

`StockAlert`에 컬럼을 추가해 결과를 덮어쓰지 않는다. 한 알림을 여러 시점(horizon)에 채점할 수 있고, 임계값·규칙이 바뀌어도 과거 채점을 재현할 수 있어야 하기 때문이다. 별도 테이블 `AlertOutcome`에 (alertId, horizon)마다 한 행을 남긴다.

```prisma
model AlertOutcome {
  id             Int        @id @default(autoincrement())
  alertId        Int        @map("alert_id")
  alert          StockAlert @relation(fields: [alertId], references: [id], onDelete: Cascade)
  horizonDays    Int        @map("horizon_days")      // 발화 후 거래일 수
  firedPrice     Decimal    @map("fired_price") @db.Decimal(18, 4)   // 발화 당시 종가
  horizonPrice   Decimal    @map("horizon_price") @db.Decimal(18, 4) // N거래일 뒤 종가
  returnPct      Decimal    @map("return_pct") @db.Decimal(18, 4)    // 등락률(%)
  evaluatedAt    DateTime   @default(now()) @map("evaluated_at")

  @@unique([alertId, horizonDays])   // 같은 알림·horizon 재채점 방지(멱등)
  @@map("alert_outcome")
}
```

`StockAlert`에 `outcomes AlertOutcome[]` 역참조를 추가한다.

### 3.2 채점은 순수함수

```ts
interface AlertOutcomeResult {
  returnPct: number;
}

// 발화 당시 종가와 N거래일 뒤 종가로 등락률을 계산한다. 부작용 없음.
scoreAlert(firedPrice: DecimalValue, horizonPrice: DecimalValue): AlertOutcomeResult | null
```

발화 당시 종가는 `StockAlert`에 직접 없다 — `triggeredValue`는 퍼센트다. 발화된 `tradeDate`의 `DailyPrice.adjClose`를 발화 당시 종가로 쓴다. horizon 종가는 그 이후 N번째 거래일의 `DailyPrice.adjClose`다.

`daily-change`(전일 대비)와 `avg-price-breach`(평단 대비)는 방향이 다르지만, 여기서는 **방향 판정을 하지 않고 실제 등락률만 기록한다.** "급락 알림 뒤 올랐다/내렸다"의 해석은 데이터가 쌓인 뒤 사람이 본다. 방향 없는 규칙에 수익 승패를 억지로 매기지 않는다(codex 리뷰 반영).

### 3.3 지연 채점 cron

매일(평일) 도는 autopilot task를 추가한다.

1. `AlertOutcome`이 아직 없는 `StockAlert`를 조회한다.
2. 각 알림에 대해, 발화 `tradeDate` 이후 `horizonDays`(기본 5거래일)만큼의 `DailyPrice`가 쌓였는지 확인한다.
3. 쌓였으면 발화 당시 종가와 horizon 종가로 채점하고 `AlertOutcome`을 upsert한다.
4. 아직 안 쌓였으면(N거래일 미경과) 건너뛴다 — 다음 날 다시 시도한다.

`DailyPrice`는 모니터링 cron이 매 평일 저장하므로, 알림 후 거래일이 지날수록 자연히 채워진다. horizon 종가 조회는 "발화일 이후 tradeDate 오름차순 N번째 행"이다. N개 미만이면 미경과다.

**시장 구분**: 국내·미국 종목의 거래일이 다르므로, horizon은 그 종목의 `DailyPrice` 거래일 수로 센다(달력일이 아니라). 이러면 시장별 휴장 차이가 자동 처리된다.

### 3.4 조회

이번 범위는 **기록까지**다. 별도 리포트 화면이나 주간 요약 통합은 만들지 않는다 — 데이터가 없는 상태에서 리포트를 설계하면 헛되다. 수동 조회 스크립트(`scripts/show-alert-outcomes.ts`) 하나만 두어, 지금까지 채점된 알림을 표로 출력한다. 데이터가 쌓여 패턴이 보이면 그때 리포트를 설계한다.

## 4. 범위

**만드는 것**: `AlertOutcome` 테이블, `scoreAlert` 순수함수, 지연 채점 cron(autopilot task), 조회 스크립트.

**만들지 않는 것**:
- 통계적 유의성 판정(event study, 벤치마크 대비 abnormal return, 다중검정 보정) — 표본이 안 나온다
- 임계값 자동 조정 — 사람이 데이터 보고 판단
- 슬래시 커맨드·리포트 화면 — 데이터 쌓인 뒤
- 여러 horizon 동시 채점 — 기본 5거래일 하나로 시작(스키마는 horizon을 지원하므로 나중에 1/20 추가 가능)

## 5. 검증

- 순수함수 `scoreAlert`: fixture로 발화가·horizon가 → 등락률. 상승/하락/0/전일가 0(분모) 케이스.
- 채점 cron: repository를 mock해서 "N거래일 경과 → 채점 / 미경과 → skip / 이미 채점됨 → skip" 검증.
- 3중 게이트 + check:env(env 추가 시) + docs:check(cron 추가로 AgentType 변화 시).
- 실제 채점 end-to-end는 알림 데이터가 없어 스모크 불가 — 가상 `StockAlert` + `DailyPrice`를 DB에 넣어 cron을 한 번 돌려 `AlertOutcome`이 생기는지 확인한다.

## 6. 미확인 / 후속

- 실사용에서 알림이 실제로 쌓이기 전까지 채점 결과의 유용성은 알 수 없다.
- horizon 5거래일이 적절한지는 데이터를 보고 조정한다. 스키마가 horizon을 지원하므로 1일·20일을 나중에 추가할 수 있다.
- 벤치마크(지수) 대비 초과수익은 이번 범위 밖. 지수 시세를 함께 저장하면 나중에 계산 가능(`^KS11`/`^GSPC`는 Yahoo로 조회됨).
