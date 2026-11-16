# 투자 파라미터 자동 조정 루프 (목표 12 · PR ③) 설계

작성일: 2026-11-16 · 상태: 교차 검토 반영(2판), 승인 대기

## 1. 한 줄 요약

매주 토요일 새벽, 별도 프로세스가 파라미터 축 하나를 walk-forward 로 잰다. 엄격한 기준을 넘는 값이
나오면 모의투자 활성값으로 **자동 반영**한다. 반영한 값은 20거래일 동안 시험 기간을 거친다.
같은 기간을 이전 값으로 재생한 결과보다 분명히 나쁘면 **자동으로 되돌리고** 투자 채널에 알린다.
과거 데이터로 하는 새 판정은 6개월 창이 새로 완결될 때(반기 1회꼴)와 다른 축 값이 바뀔 때만 나온다.

## 2. 확정된 결정

1. 승인 카드 없이 자동 반영한다.
2. 채택 기준은 엄격하게 잡는다. 시험 창의 2/3 이상에서 이겨야 하고, 슬리피지를 넣어도 이겨야 한다.
3. 시험 기간 뒤 자동으로 롤백하고 Slack 으로 알린다.
4. 이번 PR 의 조정 대상은 DB 에 있는 네 축(익절·손절·거래대금 하한·비중)이다. 거래량 급증 문턱과
   순위 가중치는 아직 코드 상수라 DB 로 옮기는 별도 PR 로 나눈다.
5. 축은 한 주에 하나씩 돌아가며 잰다.
6. 탐색은 앱 프로세스 밖에서 돈다.
7. 롤백 판정은 같은 기간을 두 값으로 재생해 비교한다. 기준은 코스피 대비 초과수익이다.
8. 시험 중인 전략에는 새 값을 반영하지 않는다. 롤백된 값은 8주 동안 후보에서 뺀다.
9. 동작 모드는 `PARAM_AUTO_TUNE_MODE=off|observe|apply` 이고 기본값은 `observe` 다. 첫 `apply`
   전환은 11-20 재측정(#952)이 끝난 뒤에 한다.
10. 과거 데이터 판정은 완결된 6개월 창만 쓴다. 판정 재료가 같으면 지난 판정을 재사용한다.
    매주 같은 시험지로 다시 채점하면 효과 없는 값도 언젠가 우연히 통과하기 때문이다.

자동 반영을 허용하는 근거: 파라미터를 읽는 곳은 `screen-universe`, `paper-recommend`,
`apply-exit-band`, `apply-intraday-stop` 네 곳이고 전부 모의투자다. 실계좌 감시 `stock-monitor` 는
이 값을 읽지 않는다.

## 3. 흐름

```
토 02:00 KST  param-tune (autopilot, AgentType.INVEST, line: 'invest')
  1. 이번 주 회차 선점: (weekStart, strategy) 행을 RUNNING 으로, attemptToken 발급
  2. 자식 프로세스 기동 후 종료까지 대기 (타임아웃 60분)
       자식(scripts/parameter-tune.ts)이 전략마다:
       a. 4축 활성 행을 엄격하게 읽어 스냅샷 (실패하면 FAILED)
       b. 시험 중인 반영 건 평가 → KEEP / ROLLBACK / INCONCLUSIVE / 계속
       c. 시험 중이면 SKIPPED_PROBATION 으로 끝냄
       d. 이번 주 축의 판정 캐시 조회 → 없으면 walk-forward 탐색
       e. 채택 기준 판정 → APPLIED / WOULD_APPLY / NO_CHANGE
       f. 결과를 attemptToken 이 맞을 때만 기록
  3. notifiedAt 이 빈 행을 모아 한 장으로 발송 → onDelivered 에서 notifiedAt 기록

월 09:00      체결·장중 손절이 새 밴드를 처음 읽는다 (이미 보유한 포지션에도 적용)
월 19:30      paper-recommend 가 새 값을 읽는다
```

task 가 자식을 기다려도 lock 을 잃지 않는다. lock 은 실행 중 lockDuration/2 주기로 자동 갱신되고,
갱신을 잃는 것은 이벤트 루프가 막히거나 프로세스가 죽을 때뿐이다
(`src/common/queue/worker-options.constant.ts:12-17`). 그래서 탐색과 판정을 한 task 안에서 끝낸다.
재생은 앱 안에서 돌릴 수 없다. `BacktestModule` 은 CLI 전용이다(`src/backtest/backtest.module.ts:7-8`).
그래서 재생이 필요한 일은 전부 자식 프로세스가 맡는다.

## 4. 구성 요소

### 4.1 원장 테이블 `parameter_tune_run` (신규)

한 행은 한 주, 한 전략의 회차다.

| 컬럼 | 의미 |
|---|---|
| `weekStart` (date), `strategy` | 유니크. 회차 예정일(`firedAtKst`)이 속한 주의 월요일. 연도가 포함돼 해가 바뀌어도 충돌하지 않는다 |
| `axis` | 이번 주 축 |
| `status` | `RUNNING` → `DONE` / `FAILED` / `SKIPPED_PROBATION` |
| `attemptToken`, `startedAt`, `failureReason` | 시도 소유권과 실패 사유(자식 로그 마지막 줄 포함) |
| `parameterSnapshot` (Json) | 탐색 시작 시점 4축의 (활성 행 id, version, 값) |
| `verdictKey` | 판정 캐시 키. (축, 마지막 완결 창 끝, 스냅샷 버전 벌, 제외 목록) |
| `verdict` (Json) | 창별 판정과 고른 수치 조합(`chosenCombination`). 라벨이 아니라 수치를 담는다 |
| `decision` | `APPLIED` / `WOULD_APPLY` / `NO_CHANGE` / null, `decisionReason` |
| `previousParameterId`, `appliedParameterId`, `appliedAt` | 반영 전후 활성 행과 반영 시각(성적표 구간 구분의 정본) |
| `probationEndsOn` (date) | 반영 다음 거래일부터 20거래일 뒤 |
| `evaluation` | `KEEP` / `ROLLBACK` / `ROLLBACK_SKIPPED` / `INCONCLUSIVE` / `WOULD_ROLLBACK` / `WOULD_KEEP` / null |
| `evaluatedAt`, `evaluationDetail` (Json) | 재생 비교 원자료 |
| `notifiedAt` | 발송 완료 시각 |

`strategy_parameter` 스키마는 바꾸지 않는다. 자동 반영 행은 기존 `agentRunId` 컬럼
(`prisma/schema.prisma:1177-1179`)으로 이 실행에 연결한다. `reason` 에는 사람이 읽을 요약만 적는다.

### 4.2 활성화 쓰기 경로 (신규, `StrategyParameterPort`)

지금 레포에는 값을 바꾸는 코드가 없다. 포트에는 `findActiveParameters` 만 있고,
`scripts/strategy-parameter.ts` 는 `list`·`seed` 만 받는다(`:75`). 그래서 다음 두 메서드를 더한다.

- `findActiveParametersStrict(strategy)` — 조회가 실패하거나 활성 행이 없으면 예외를 던진다.
  운영용 `ResolveStrategyParametersUsecase` 는 조회 실패 시 코드 상수로 진행하는데
  (`resolve-strategy-parameters.usecase.ts:37-39`), 자동 조정이 그 값을 기준선으로 삼으면 안 된다.
- `activateNewVersion({ strategy, name, expectedSnapshot, value, reason, agentRunId })` — 한 트랜잭션에서
  4축 활성 행이 `expectedSnapshot` 과 모두 같은지 확인한다. 같으면 기존 행에 `supersededAt` 을 쓰고
  `version = max+1` 행을 넣는다. 부분 유니크(`idx_strategy_parameter_active`) 때문에 이 순서여야 한다.
  하나라도 다르면 아무것도 쓰지 않고 `CONFLICT` 를 돌려준다. 다른 축이 바뀐 경우, 사람이 SQL 로 바꾼 경우,
  같은 값으로 되돌아간 경우(A→B→A) 모두 버전이 달라지므로 이 검사로 잡힌다.

### 4.3 탐색 입력 (고정값)

| 항목 | 값 | 근거 |
|---|---|---|
| 기간 | `--from 2021-10-01`, `--to` = 마지막으로 완결된 6개월 창의 끝 | 부분 창을 쓰면 시험 창이 매주 자라 같은 데이터로 재판정하게 된다 (`parameter-search.ts:80-94`) |
| 창 | 6개월, 이동 6개월, 비중첩 | 2026-09-01 실측. LONG_TERM 창당 청산 34건 |
| 슬리피지 | 0 · 0.1 · 0.2 % | 2026-09-02 강건 순위. 0.2% 가 알려진 붕괴 지점 |
| 익절 격자 | 2, 5, 10, 15, 20, 30 % | 2026-09-01 탐색 격자 |
| 손절 격자 | −1, −2, −3, −5, −7, −10, −15 % | −0.2% 는 슬리피지 0.2% 에서 무너지는 절벽이라 뺀다 |
| 거래대금 하한 격자 | 1, 3, 5, 10 억 | 기존 측정 격자 |
| 비중 격자 | 15, 20, 25 % | 기존 측정 격자 |
| 밴드 없음 | 쓰지 않는다 (`--include-bandless` 끔) | TP/SL 이 null 이라 DB 에 넣을 수 없다 |

롤백된 값(최근 8주 `ROLLBACK`)은 격자를 만들 때부터 뺀다. 선택한 뒤에 거르면 그 값이 계속 1위로 남아
차순위 후보가 검토되지 않는다.

축 회전은 고정 기준 주(2026-11-16 월요일)로부터 지난 주 수 mod 4 로 정한다. 2026년처럼 53주가
있는 해에도 순서가 끊기지 않는다.

### 4.4 채택 기준 (순수 함수, `src/backtest/domain/`)

`evaluateRobustWalkForward` 결과를 입력으로 받는다.

1. 판정 가능한 시험 창(`wonEveryCondition !== null`)이 6개 이상 있어야 한다.
2. 마지막 창이 고른 수치 조합을 후보로 삼는다. 같은 조합을 고른 창이 4개 미만이면
   `NO_CHANGE(선택 불안정)` 로 끝낸다.
3. 그 창들 중 `wonEveryCondition === true` 의 비율이 2/3 이상이어야 한다.
4. 그 창들에서 후보의 평균 초과수익이 현행값보다 최소 마진 이상 높아야 한다. 마진의 초깃값은 0.5%p 이고,
   observe 기간에 쌓인 분포를 보고 조정한다.
5. 후보는 현행값에서 격자 한 칸 안이어야 한다. 더 멀면 같은 방향으로 한 칸만 옮긴 값을 반영한다.

한계도 적어 둔다. 마지막 창의 후보는 앞선 시험 창들까지 학습한 결과다. 그래서 2~3번은 "선택이
안정적이다"는 증거일 뿐, 그 값이 앞으로도 좋다는 독립 검증이 아니다. 이 빈틈은 4번 마진과 롤백으로 메운다.

판정 재료가 같으면(`verdictKey` 가 같으면) 탐색을 다시 돌리지 않고 지난 판정을 재사용한다.
그래서 새 판정은 반기마다 창이 하나 완결될 때와 다른 축 값이 바뀔 때만 나온다.

### 4.5 롤백 판정 (순수 함수)

시험 기간을 이전 값과 새 값으로 각각 재생한다. 슬리피지 3단계 모두에서 돌리고, 둘의 차이만 다른
조건은 모두 같게 둔다.

- 반영일부터 누적한 구간을 매주 재평가한다. 새 값의 청산이 5건에 닿은 첫 주에 한 번 판정한다.
  `probationEndsOn` 은 그 최소 대기(20거래일)이고, 12주가 지나도 5건이 안 되면 `INCONCLUSIVE(표본 부족)` 로 닫고 KEEP 처럼 둔다.
- 어느 조건이든 초과수익이 null 이거나 재생에서 불변식이 깨지면 `INCONCLUSIVE(판정 불가)` 로 둔다.
  KEEP 과 구분해 기록하고 다음 주에 다시 평가한다.
- 새 값이 **모든** 조건에서 이전 값보다 초과수익이 낮고, 그 차이가 채택 마진과 같은 크기 이상이면 `ROLLBACK` 한다.
- 롤백은 `activateNewVersion` 으로 이전 값을 새 버전으로 활성화한다. 이때 기대 스냅샷은
  "`appliedParameterId` 가 아직 활성" 이다. 아니면 `ROLLBACK_SKIPPED(사람 변경)` 으로 기록하고 알린다.
- 평가 확정은 `evaluatedAt IS NULL` 조건부 update 로 한 번만 일어나게 한다.

이 재생은 실제 계좌의 시험이 아니다. 재생은 보유 포지션 없이 빈 원장에서 시작하고
(`replay-backtest.usecase.ts:98,325`), 종목도 LLM 추천이 아니라 결정론적 규칙으로 고른다.
그래서 롤백 판정은 "두 규칙끼리의 모형 비교" 다. 알림에도 그렇게 적는다.

### 4.6 모드

| 모드 | 새 반영 | 시험 중 값의 평가·롤백 |
|---|---|---|
| `off` | 탐색하지 않음 | 계속 돈다 |
| `observe` | 판정만 하고 `WOULD_APPLY` 로 기록. 그 건에 가상 시험을 돌려 `WOULD_KEEP`/`WOULD_ROLLBACK` 을 쌓는다 | 계속 돈다 |
| `apply` | 반영 | 계속 돈다 |

모드를 내려도 이미 반영된 값의 감시는 멈추지 않는다. 문제가 보여 모드를 내리는 순간에 롤백 감시까지
꺼지면 안 되기 때문이다. observe 의 가상 시험 결과는 apply 로 전환하기 전에 롤백 판정이 실제로
어떤 분포로 나오는지 보는 근거가 된다.

### 4.7 autopilot 등록과 자식 프로세스

- 등록 지점: 플레이북 항목(독립 항목, digestGroup 없음, `line: 'invest'`), `autopilot.playbook-defaults.ts`
  기본 cron 상수, `AUTOPILOT_TASKS` provider, `AUTOPILOT_DELIVERY_ROUTE`. 마지막 것을 빠뜨리면
  그룹 전체가 throw 한다(`autopilot-delivery-route.ts:80` 이 `autopilot.orchestrator.ts:251` 의 try 밖에서 불린다).
- 원장 기록은 기존 `AgentType.INVEST` 로 `AgentRunService.execute` 를 탄다(`modelUsed: 'deterministic'`).
- 자식 기동: `node -r ts-node/register/transpile-only scripts/parameter-tune.ts --run-ids ... --attempt-token ...`,
  cwd 는 레포 루트다. stdout 과 stderr 는 `logs/param-tune/<weekStart>.log` 에 남긴다. 실패하면 마지막 20줄을
  `failureReason` 에 싣는다. 로컬 운영(ts-node 있음)이 전제다. `dist` 로 운영하게 되면 컴파일 엔트리가 따로 필요하다.
- `scripts/parameter-search.ts` 의 보고 모드는 그대로 둔다. 탐색 루프와 판정 계산은 두 스크립트가 같이 쓰는
  함수로 뽑는다.

## 5. 장애 가정 점검

**유실 지점** — 자식이 도중에 죽으면 그 회차의 탐색 결과는 사라진다. task 는 자식 종료 코드를 보고
행을 `FAILED` 로 닫아 알린다. 앱까지 같이 죽었으면 행이 `RUNNING` 으로 남는다. 다음 회차가
`startedAt + 90분` 이 지난 `RUNNING` 을 `FAILED(중단)` 으로 닫는다.

**실제 전달 보장** — 저빈도 재시도(4회, 30분 지수 백오프, `autopilot.scheduler.ts:22-25`)가 붙는다.
재시도가 선점 행을 만났을 때의 처리는 이렇다. 행이 `RUNNING` 이고 `startedAt` 이 90분 안이면 이미 실행 중으로
보고 끝낸다. `FAILED` 이거나 기한이 지났으면 새 `attemptToken` 으로 다시 선점해 자식을 띄운다.
spawn 이 즉시 실패하면 행을 `FAILED(spawn)` 으로 닫고 예외를 던져 재시도에 맡긴다.

**놓친 회차** — 투자 라인은 놓친 회차를 보충하지 않는다(`autopilot.scheduler.ts:88-93`).
그래서 `param-tune` 을 `LEDGER_GAP_WATCHES` 에 등록해, 원장에 회차가 비면 아침 브리핑이 알리게 한다.
놓친 주는 건너뛰고, 다음 주는 회전 순서대로 다음 축을 잰다.

**멱등성을 깨는 입력** — 결과 기록은 `status='RUNNING' AND attemptToken=?` 조건부 update 로만 한다.
그래서 늦게 끝난 옛 자식이 새 시도의 결과를 덮지 못한다. 반영과 롤백은 `activateNewVersion` 의
스냅샷 CAS 가 최종으로 막고, 평가 확정은 `evaluatedAt IS NULL` 로 한 번만 일어난다.
같은 전략에서 시험이 둘 열리는 일은 "시험 중이면 SKIPPED_PROBATION" 판정을 반영 트랜잭션 안에서
다시 확인해 막는다.

**트랜잭션 경계** — Slack 발송은 커밋 뒤에 한다. 발송 본문은 이번 실행 결과가 아니라 `notifiedAt IS NULL`
인 행 전체로 만든다. 그래서 발송 전에 죽어도 다음 실행이 다시 보낸다. 알릴 행이 없으면
`skip=true` 와 `emptyReason` 으로 끝낸다.

**폭주 시 먼저 포화되는 것** — 자식은 CPU 한 코어와 창 캐시 메모리(창당 수백 MB)를 쓰고,
DB 커넥션 풀도 따로 연다. 토 02:00 근처의 다른 투자 작업은 미국 시세 감시(토 05:30~06:30 KST)뿐이다.
`universe-sweep` 은 평일 전용이 아니라 매일 18:30 에 돈다. 탐색 시간은 축 하나에 6~20분으로
추정하며 아직 실측하지 않았다. 판정 캐시가 맞는 주는 재생 없이 몇 초에 끝난다.

## 6. 성적표와의 관계

파라미터 값이 바뀌어도 `ruleVersion` 은 그대로다(`generate-paper-recommendation.usecase.ts:325-326`).
`RecommendationScore` 는 밴드(`exitBands`)만 기록하고 거래대금 하한과 비중은 기록하지 않는다.
그래서 `parameter_tune_run.appliedAt` 을 구간 구분의 정본으로 둔다. 주간 성적 카드는 그 구간 안에
자동 반영이 있었으면 "이 구간에 자동 반영 N건" 을 한 줄 붙인다.

## 7. 하지 않는 것

- 거래량 급증 문턱과 순위 가중치의 자동 조정(별도 PR 에서 DB 이전부터)
- 실계좌 `stock-monitor` 임계값 조정
- LLM 이 축이나 값을 고르는 것(2026-08-25 결정 유지)
- 재생에 실제 계좌 상태를 주입하는 것, 중첩 검증을 새로 만드는 것(비용 대비 효과가 낮다. 한계로 명시)

## 8. 검증

- 순수 함수 단위 테스트: 채택 기준(마진, 한 칸 제한, 선택 불안정), 롤백 판정(INCONCLUSIVE, 표본 부족,
  마진), 축 회전(53주 경계), `weekStart` 계산, 판정 캐시 키
- 리포지토리 테스트: `activateNewVersion` 의 CAS — 다른 축 변경, A→B→A, 동시 두 호출 중 하나만 성공
- 조건부 update 테스트: 늦은 자식 토큰 거부, 평가 이중 확정 방지
- 모드 테스트: `off` 와 `observe` 는 `strategy_parameter` 를 바꾸지 않고, 시험 중 평가는 세 모드 모두 돈다
- 배선 생존: 테스트 DB 에 일부러 다른 값을 넣고, 반영 뒤 `ResolveStrategyParametersUsecase` 가 새 값을 돌려주는지 확인
- 로컬 1회 실주행: observe 모드로 한 축을 돌려 실제 소요 시간과 판정을 기록
- 완료 조건: `pnpm verify` 와 `check:di`. 스키마 변경이라 `pnpm db:push` 와 `pnpm prisma:generate`.
  새 env 라 `.env.example`·`.env`·`app.config.ts`·README 4곳을 맞춘 뒤 `pnpm docs:sync` → `pnpm docs:check`

## 9. 일정

토 02:00 KST 한 번 돈다. 기존 관례대로 `AUTOPILOT_PARAM_TUNE_SCHEDULE` / `AUTOPILOT_PARAM_TUNE_TIMEZONE`
으로 덮어쓸 수 있다.
