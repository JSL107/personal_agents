import { MODEL_ROUTER_WORST_CASE_MS } from '../llm/llm-timeout.constant';
import { LONG_RUNNING_WORKER_LOCK_DURATION_MS } from './worker-options.constant';

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
