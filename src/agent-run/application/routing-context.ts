import { AsyncLocalStorage } from 'node:async_hooks';

import { RoutedVia } from '../domain/agent-run.type';

/**
 * 라우터가 고른 근거를 "그 dispatch 아래에서 열리는 AgentRun" 까지 닿게 하는 통로.
 *
 * 라우터는 무엇을 어디로 왜 보냈는지 알지만 행을 만들지 않고, 행을 만드는 것은
 * `AgentRunService.execute` 인데 그 사이에 dispatcher 15종과 execute 호출부 39곳이 끼어 있다.
 * 인자로 흘리면 54곳을 전부 고쳐야 하고, 반대로 결과(agentRunId)를 되받아 사후에 붙이면
 * 워커가 예외로 끝나는 순간 되받기가 끊긴다 — 그래서 **분류가 틀려서 죽은 표본**, 즉 정확도
 * 분석에 가장 필요한 회차가 통째로 빠졌다 (PR #629 가 남긴 구멍).
 *
 * AsyncLocalStorage 는 인자를 넘기지 않고도 호출 아래 전부가 들여다볼 수 있는 임시 보관소다.
 * 라우터가 dispatch 를 이 스코프로 감싸 두면 그 아래 어디서 begin 이 일어나든 — 동기 워커든
 * `void` 로 띄운 백그라운드 워커(BLOG)든 — 같은 값을 집어 간다.
 *
 * 스코프 밖에서 도는 실행(cron·autopilot·슬래시 직접 호출)은 store 가 없어 근거 없이 기록된다.
 * 라우터를 거치지 않았으니 그게 정상이고, 빈손은 결함이 아니다.
 */
export interface RoutingContext {
  /** 사용자가 실제로 친 원문. 마스킹·길이 제한은 소비자(AgentRunService)가 건다. */
  readonly text: string;
  /** 라우터가 고른 worker. */
  readonly routedTo: string;
  /** 고른 경로 — 분류기를 탄 회차만 골라 채점하려면 셋을 구분해야 한다. */
  readonly routedVia: RoutedVia;
  /** 분류기 확신도. hint·nickname 경로에는 없다. */
  readonly confidence?: number;
}

interface RoutingContextSlot {
  readonly context: RoutingContext;
  claimed: boolean;
}

const storage = new AsyncLocalStorage<RoutingContextSlot>();

/** 라우터 전용 — 이 콜백 아래에서 열리는 첫 AgentRun 이 근거를 가져간다. */
export const runWithRoutingContext = <T>(
  context: RoutingContext,
  run: () => Promise<T>,
): Promise<T> => storage.run({ context, claimed: false }, run);

/**
 * 스코프당 **한 번만** 근거를 돌려준다. 두 번째 호출부터는 undefined.
 *
 * 한 dispatch 가 AgentRun 을 둘 이상 열거나 워커가 스코프 안에서 무관한 작업을 `void` 로
 * 띄우면, 같은 발화가 여러 행에 복사돼 분류 정확도의 **분모가 부풀어 오른다**.
 * "사용자 발화 1건 = 기록 1행" 은 #629 가 세운 규칙이고 여기서도 그대로 지킨다.
 */
export const claimRoutingContext = (): RoutingContext | undefined => {
  const slot = storage.getStore();
  if (slot === undefined || slot.claimed) {
    return undefined;
  }
  slot.claimed = true;
  return slot.context;
};
