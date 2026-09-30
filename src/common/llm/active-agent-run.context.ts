import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 지금 실행 중인 AgentRun 의 id 를 그 아래 호출 전체가 들여다보게 하는 통로.
 *
 * `AgentRunService.execute` 가 run 콜백을 이 스코프로 감싸고, `ModelRouterUsecase.route()` 가
 * 모델 호출 기록(model_call)에 id 를 붙이는 데 쓴다. 스코프 밖(원장을 거치지 않은 호출)이면
 * undefined 이고, 그 빈칸이 곧 "원장 밖에서 불렸다" 는 표식이다.
 *
 * common 에 두는 이유: agent-run 은 이미 model-router 의 타입을 import 한다 — 반대 방향
 * import 를 만들지 않으려고 둘 다 여기서 가져간다.
 */
const storage = new AsyncLocalStorage<number>();

export const runWithActiveAgentRun = <T>(
  agentRunId: number,
  run: () => Promise<T>,
): Promise<T> => storage.run(agentRunId, run);

export const getActiveAgentRunId = (): number | undefined => storage.getStore();
