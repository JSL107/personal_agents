import { MODEL_ROUTER_WORST_CASE_MS } from '../llm/llm-timeout.constant';
import {
  AUTOPILOT_WORKER_OPTIONS,
  LONG_RUNNING_WORKER_LOCK_DURATION_MS,
} from './worker-options.constant';

describe('LONG_RUNNING_WORKER_LOCK_DURATION_MS', () => {
  // 회귀 방지: lockDuration 은 ModelRouter.route() 의 worst-case(primary timeout + fallback
  // timeout 순차 2회 누적)를 반드시 초과해야 한다. 그러지 못하면 codex full timeout + claude
  // fallback 이 겹친 attempt 에서 BullMQ lock 이 만료돼 stalled 재처리가 발생한다:
  //   Error: could not renew lock for job <repeat:...>
  //   Error: Missing lock for job <repeat:...>. moveToFinished  (code -2)
  it('ModelRouter fallback worst-case 를 흡수해 lock 만료를 막는다', () => {
    expect(LONG_RUNNING_WORKER_LOCK_DURATION_MS).toBeGreaterThan(
      MODEL_ROUTER_WORST_CASE_MS,
    );
  });
});

describe('AUTOPILOT_WORKER_OPTIONS', () => {
  // 회귀 방지: 이 값을 지우면 BullMQ 기본값 1 로 돌아가 autopilot 의 모든 cron 그룹이 다시
  // 한 줄로 선다. 그러면 LLM 을 쓰는 긴 작업(PR 리뷰 스윕 평균 824초) 하나가 5분 주기의
  // 짧은 작업을 굶기고, 굶은 회차는 원장에 행조차 남지 않아 아무도 모른다
  // (실측 2026-08-26~09-09: 예정 870 회 중 63 회 소실).
  it('cron 그룹이 한 줄로 서지 않도록 동시 처리 수를 명시한다', () => {
    expect(AUTOPILOT_WORKER_OPTIONS.concurrency).toBeGreaterThan(1);
  });
});
