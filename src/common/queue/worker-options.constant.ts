// BullMQ worker 기본 옵션 모음.
//
// 본 프로젝트의 worker 들은 대부분 LLM CLI (codex / claude) 호출을 내부에서 수행한다.
// codex/claude CLI 의 max timeout = 180_000ms (3분) + context fetch (GitHub / Notion / DB)
// 추가 시간 → 한 job 처리에 1~3분 걸리는 경우가 흔하다. BullMQ default `lockDuration` (30s)
// 으론 그 사이 lock 갱신을 못 해 다음 두 가지 에러가 발생:
//
//   Error: could not renew lock for job <repeat:...>
//   Error: Missing lock for job <repeat:...>. moveToFinished
//
// 이 상태에서 job 결과는 정상이지만 BullMQ 가 같은 job 을 재시도 trigger 하면서 중복 실행
// 위험 + 로그 noise 가 증가. lockDuration 을 충분히 늘려 정상 처리 흐름 안에서 lock 이
// 만료되지 않게 한다 (실제 timeout 은 `Worker.run` 의 job runner 가 자체 관리).
//
// 5분 = 가장 긴 LLM 호출 (180s) + context fetch (수십 초) + slack 발송 (수 초) 을 모두
// 흡수하는 safe upper bound. job 이 hang 한 경우에도 5분 후엔 자동 release 되므로 너무
// 길지 않다.
export const LONG_RUNNING_WORKER_LOCK_DURATION_MS = 5 * 60 * 1000;

// 13 worker consumer 가 spread 로 쓰는 공통 옵션. 추가로 `concurrency` 가 필요한 worker 는
// 자체 옵션 객체에 spread 후 덧붙인다 — `@Processor(QUEUE, { concurrency: 1, ...LONG_RUNNING_WORKER_OPTIONS })`.
export const LONG_RUNNING_WORKER_OPTIONS = {
  lockDuration: LONG_RUNNING_WORKER_LOCK_DURATION_MS,
} as const;

// cron 발송 idempotency 가드 TTL (초). stalled 재처리 중복 발송 차단용 키의 만료 시간.
// 25h — 하루 슬롯을 넘기되 다음 날 같은 시각 발사 전엔 만료돼 정상 재발송을 막지 않는다.
// (매일/주1회 cron 모두 "같은 날 중복" 만 차단하면 되므로 25h 로 충분.)
export const CRON_SENT_GUARD_TTL_SECONDS = 90_000;
