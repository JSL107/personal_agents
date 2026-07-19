import { MODEL_ROUTER_WORST_CASE_MS } from '../llm/llm-timeout.constant';
import { WAKE_PROBE_MAX_WAIT_MS } from '../system/system-wake-guard.service';

// BullMQ worker 기본 옵션 모음.
//
// 본 프로젝트의 worker 들은 대부분 내부에서 ModelRouterUsecase.route() 로 LLM CLI(codex)
// 를 호출한다. fallback 은 2026-07-02 제거됐고, CodexCliProvider 가 일시성 실패를 bounded retry
// 하므로 한 attempt 의 최악 LLM 시간은 단일 호출(180s)이 아니라 codex timeout 2회 누적
// = 360s (MODEL_ROUTER_WORST_CASE_MS) — 이다. 여기에 context fetch(GitHub/Notion/DB, 수십 초) +
// slack 발송(수 초)이 더해진다.
//
// 과거 lockDuration(5분)은 "가장 긴 LLM 호출 1회(180s)"만 가정해 2회 누적 경로를 흡수하지
// 못했고, 그 결과 codex full timeout + 후속 시도가 겹친 날 lock 갱신을 못 해 다음 에러가 났다:
//
//   Error: could not renew lock for job <repeat:...>
//   Error: Missing lock for job <repeat:...>. moveToFinished  (code -2)
//
// 이 상태가 되면 BullMQ 가 같은 job 을 stalled 로 보고 재처리(중복 LLM 호출 + 발송 시도) 한다.
// → lockDuration 을 route() worst-case(360s) + context/slack 여유(90s) 를 흡수하도록 둔다.
//   LLM timeout 이 바뀌면 MODEL_ROUTER_WORST_CASE_MS 를 통해 이 값도 자동으로 따라간다.
//   (실제 hang 시에도 이 시간이 지나면 lock 이 release 되므로 stalled 복구가 영구 지연되지 않는다.)
const CONTEXT_AND_DELIVERY_BUDGET_MS = 90 * 1000;
export const LONG_RUNNING_WORKER_LOCK_DURATION_MS =
  MODEL_ROUTER_WORST_CASE_MS + CONTEXT_AND_DELIVERY_BUDGET_MS;

// 13 worker consumer 가 spread 로 쓰는 공통 옵션. 추가로 `concurrency` 가 필요한 worker 는
// 자체 옵션 객체에 spread 후 덧붙인다 — `@Processor(QUEUE, { concurrency: 1, ...LONG_RUNNING_WORKER_OPTIONS })`.
export const LONG_RUNNING_WORKER_OPTIONS = {
  lockDuration: LONG_RUNNING_WORKER_LOCK_DURATION_MS,
} as const;

// autopilot consumer 전용 옵션. 절전 직후 SystemWakeGuard.waitUntilReady 가 백엔드 준비를
// 최대 WAKE_PROBE_MAX_WAIT_MS 폴링한 뒤 runGroup 을 실행하므로, 그 대기가 lock 안에서 소화되도록
// probe 예산을 lockDuration 에 더한다. (probe 하지 않는 나머지 worker 는 LONG_RUNNING_WORKER_OPTIONS 유지 —
// 이들의 lock 을 불필요하게 늘려 stalled 복구를 지연시키지 않는다.)
export const AUTOPILOT_WORKER_OPTIONS = {
  lockDuration: LONG_RUNNING_WORKER_LOCK_DURATION_MS + WAKE_PROBE_MAX_WAIT_MS,
} as const;

// cron 발송 idempotency 가드 TTL (초). stalled 재처리 중복 발송 차단용 키의 만료 시간.
// 25h — 하루 슬롯을 넘기되 다음 날 같은 시각 발사 전엔 만료돼 정상 재발송을 막지 않는다.
// (매일/주1회 cron 모두 "같은 날 중복" 만 차단하면 되므로 25h 로 충분.)
export const CRON_SENT_GUARD_TTL_SECONDS = 90_000;
