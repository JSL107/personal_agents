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
  // 이 값은 양쪽에서 막혀 있어 정확한 값으로 고정한다. 위 lockDuration 과 달리 관계식이 아니라
  // 두 근거 사이에서 고른 값이라, 한쪽만 단언하면 반대쪽 회귀가 그대로 통과한다.
  //
  // 아래로: 1 이면 BullMQ 기본값과 같아져 autopilot 의 모든 cron 그룹이 한 줄로 선다. LLM 을
  // 쓰는 긴 작업(PR 리뷰 스윕 평균 824초) 하나가 5분 주기의 짧은 작업을 굶기고, 굶은 회차는
  // 원장에 행조차 남지 않아 아무도 모른다(실측 2026-08-26~09-09: 예정 870 회 중 63 회 소실).
  //
  // 위로: 3 이상이면 이 큐가 spawn 하는 codex CLI 동시 호출이 그만큼 늘어 쿼터 소모가 집중된다.
  // 실측상 동시 점유가 2개였던 회차는 3 건뿐이라, 그 3 건을 위해 LLM 동시성을 더 늘리는 것은
  // 값이 맞지 않는다. 올려야 할 근거가 생기면 이 테스트를 함께 고쳐 그 근거를 남긴다.
  it('굶김 방지와 쿼터 집중 사이에서 고른 값을 고정한다', () => {
    expect(AUTOPILOT_WORKER_OPTIONS.concurrency).toBe(2);
  });
});
