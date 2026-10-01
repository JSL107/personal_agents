import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 라우터가 아는 부모 실행 id 를 "그 dispatch 아래에서 열리는 첫 AgentRun" 의 행에 처음부터 싣는 통로.
 *
 * 예전에는 자식 실행이 **끝난 뒤** outcome.agentRunId 로 되돌아가 parentId 를 적었다. 그러면
 * 시작 알림(run.started) 순간에는 부모가 비어 있어, 콘솔 오피스가 "이 일에 누가 엮였는지" 를
 * 시작할 때 알 수 없었다 — 회의 연출이 한 번도 열리지 않은 이유 중 하나다. 워커가 예외로 끝나면
 * 되받기 자체가 끊기는 것도 같은 구멍이다.
 *
 * 라우팅 근거(`routing-context.ts`)와 같은 방식이지만 슬롯을 따로 둔다. 라우팅 근거는 원문이
 * 있을 때만 만들어지는데(handoff passthrough 가 비면 없다), 부모는 원문과 무관하게 있다.
 *
 * 스코프 밖(cron·슬래시 직접 호출)이면 부모 없이 기록되고, 그게 정상이다.
 */
interface ParentRunSlot {
  readonly parentId: number;
  claimed: boolean;
}

const storage = new AsyncLocalStorage<ParentRunSlot>();

/** 라우터 전용 — 이 콜백 아래에서 열리는 첫 AgentRun 이 parentId 를 가져간다. */
export const runWithParentRun = <T>(
  parentId: number,
  run: () => Promise<T>,
): Promise<T> => storage.run({ parentId, claimed: false }, run);

/**
 * 스코프당 **한 번만** 부모를 돌려준다. 두 번째 호출부터는 undefined.
 *
 * 한 dispatch 가 AgentRun 을 둘 이상 열면 뒤의 것까지 같은 부모를 달아, 하나였던 위임이
 * 원장에서 여러 갈래로 보인다. 라우팅 근거의 "발화 1건 = 기록 1행" 규칙과 같다.
 */
export const claimParentRun = (): number | undefined => {
  const slot = storage.getStore();
  if (slot === undefined || slot.claimed) {
    return undefined;
  }
  slot.claimed = true;
  return slot.parentId;
};
