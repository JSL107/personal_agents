# Toss Holdings Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 토스증권 Open API의 보유 종목을 정밀도 손실 없이 `Ticker`와 일별 `Holding`에 동기화한다.

**Architecture:** `market-data` 도메인에 broker holdings port를 두고 Toss 인프라 어댑터가 OAuth 토큰·계좌 선택·응답 검증을 담당한다. `SyncHoldingsUsecase`는 port와 stock repository만 조합하며, repository가 Prisma upsert와 기존 토스 보유분 조회를 격리한다.

**Tech Stack:** NestJS 10, TypeScript, Prisma 6, PostgreSQL Decimal, Jest 29, Node 22 global fetch

## Global Constraints

- `docs/superpowers/specs/2026-07-22-toss-holdings-sync-design.md`와 사용자의 확정 API 스펙을 source of truth로 삼는다.
- 모든 API 수치 문자열은 `Number`로 변환하지 않고 `Prisma.Decimal`에 문자열 그대로 전달한다.
- Domain Layer는 `@prisma/client`를 import하지 않는다.
- strict TDD 대상은 mapper와 `SyncHoldingsUsecase`이며, 각 테스트의 RED를 확인한 뒤 production code를 작성한다.
- 토큰은 메모리에 캐시하고 `expires_in` 만료 60초 전에 갱신한다.
- zeroing은 기존 `source='TOSS'` 보유분에만 적용하고 행을 삭제하지 않는다.
- 네트워크·DB 명령, `git add`, commit을 실행하지 않는다.
- `tasks/`와 `toss-openapi.json`을 변경하지 않는다.

---

### Task 1: Broker holdings domain contract와 Toss mapper

**Files:**
- Create: `src/market-data/domain/broker-holdings.type.ts`
- Create: `src/market-data/domain/port/broker-holdings.port.ts`
- Create: `src/market-data/infrastructure/toss/toss-holdings.mapper.spec.ts`
- Create: `src/market-data/infrastructure/toss/toss-holdings.mapper.ts`

**Interfaces:**
- Produces: `BrokerHolding`, `BROKER_HOLDINGS_PORT`, `BrokerHoldingsPort.fetchHoldings(): Promise<BrokerHolding[]>`, `mapTossHoldingsResponse(raw: unknown): BrokerHolding[] | null`

- [ ] 정상 KR fixture, 필수 필드 누락, 빈 items, 비객체 응답, US fixture 테스트를 먼저 작성한다.
- [ ] mapper spec을 실행해 module-not-found 또는 missing export RED를 확인한다.
- [ ] `DecimalValue`를 재사용하고 인프라 mapper에서만 `Prisma.Decimal`을 생성한다.
- [ ] mapper spec을 다시 실행해 GREEN을 확인한다.

### Task 2: Toss OAuth/holdings client

**Files:**
- Create: `src/market-data/infrastructure/toss/toss-invest.client.spec.ts`
- Create: `src/market-data/infrastructure/toss/toss-invest.client.ts`

**Interfaces:**
- Consumes: `BrokerHoldingsPort`, `mapTossHoldingsResponse`
- Produces: `TossInvestClient.fetchHoldings(): Promise<BrokerHolding[]>`

- [ ] global fetch mock과 fake timers로 만료 전 토큰 재사용, 60초 안전 구간 진입 후 재발급 테스트를 작성한다.
- [ ] 테스트 RED를 확인한다.
- [ ] form-urlencoded token 요청, optional env 계좌 키 우선, 첫 `BROKERAGE` 계좌 fallback, 명확한 HTTP/형식 오류를 구현한다.
- [ ] client spec GREEN을 확인한다.

### Task 3: Holding synchronization use case와 repository

**Files:**
- Create: `src/agent/stock/application/sync-holdings.usecase.spec.ts`
- Create: `src/agent/stock/application/sync-holdings.usecase.ts`
- Modify: `src/agent/stock/infrastructure/stock-monitor.repository.ts`

**Interfaces:**
- Produces: `SyncHoldingsUsecase.execute(): Promise<{ synced: number; zeroed: number }>`
- Repository: `upsertTickerFromBroker`, `upsertHolding`, `findCurrentBrokerHoldings`

- [ ] 신규/기존 응답 upsert와 응답에서 사라진 토스 종목 quantity zero upsert를 repository mock으로 테스트한다.
- [ ] 테스트 RED를 확인한다.
- [ ] UTC 자정 effectiveDate, `(marketCountry, symbol)` ticker upsert, 문자열 Decimal 저장, 기존 avgPrice/currency 보존 zeroing을 구현한다.
- [ ] use case spec GREEN을 확인한다.
- [ ] repository에 Prisma 쿼리만 추가하고 기존 Yahoo monitor에는 `yahooSymbol`이 있는 최신 보유분만 반환한다.

### Task 4: Wiring, manual script, env documentation

**Files:**
- Modify: `src/market-data/market-data.module.ts`
- Modify: `src/agent/stock/stock.module.ts`
- Create: `scripts/sync-toss-holdings.ts`
- Modify: `.env.example`
- Modify: `.env`
- Modify: `src/config/app.config.ts`
- Modify: `README.md`

**Interfaces:**
- `MarketDataModule` exports `BROKER_HOLDINGS_PORT` backed by `TossInvestClient`.
- `StockModule` provides and exports `SyncHoldingsUsecase`.

- [ ] 세 optional env를 네 위치에 같은 이름으로 추가하고 실제 `.env` 값은 빈 문자열로 둔다.
- [ ] 수동 script가 Nest application context에서 `SyncHoldingsUsecase`를 resolve해 결과를 출력하고 항상 close하도록 작성한다.
- [ ] 모듈 DI를 배선한다.

### Task 5: Verification and handoff

**Files:**
- Create: `.ai/implementation-summary.md`

- [ ] `source "$HOME/.nvm/nvm.sh" && nvm use 22 && pnpm lint:check`를 실행한다.
- [ ] `source "$HOME/.nvm/nvm.sh" && nvm use 22 && pnpm build`를 실행한다.
- [ ] `source "$HOME/.nvm/nvm.sh" && nvm use 22 && pnpm exec jest src/market-data src/agent/stock`를 실행한다.
- [ ] `source "$HOME/.nvm/nvm.sh" && nvm use 22 && pnpm check:env`를 실행한다.
- [ ] 최종 diff에서 사용자 소유 스키마 변경과 금지 파일이 보존됐는지 확인한다.
- [ ] 한국어 구현 요약에 파일, 테스트 수, 게이트 결과, 이탈, 실호출 검증 지점을 기록한다.
