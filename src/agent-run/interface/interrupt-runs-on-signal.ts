import { INestApplicationContext, Logger } from '@nestjs/common';

import { AgentRunService } from '../application/agent-run.service';

const SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

// 종료 신호를 받으면 실행 중이던 run 에 중단 사유만 남기고, 곧바로 종전처럼 죽는다.
//
// `app.enableShutdownHooks()` 를 쓰지 않는 이유: 그것을 켜면 BullMQ 의 onApplicationShutdown 이
// `worker.close()` 로 **활성 job 이 끝날 때까지 제한 없이** 기다린다. 그런데 HTTP 포트는 그보다 먼저
// 닫히므로, 포트를 기준으로 종료를 판정하는 `scripts/console-dev.sh` 의 release_port 가 "죽었다" 고
// 보고 새 백엔드를 띄운다 — 옛 프로세스가 워커를 쥔 채 남는다. Nest 는 종료 진행 중 들어온 추가
// 신호도 무시하므로(nest-application-context 의 receivedSignal) Ctrl+C 로 끊을 수도 없다.
//
// 리스너는 `once` 로 걸고 마감 뒤 같은 신호를 다시 올린다 — 리스너가 빠진 자리라 기본 동작(즉시 종료)
// 으로 간다. 그래서 이 배선이 늘리는 종료 시간은 마감 기록 한 번(상한 2초)뿐이다.
export const interruptRunsOnSignal = (
  application: INestApplicationContext,
): void => {
  const logger = new Logger('InterruptRunsOnSignal');
  for (const signal of SIGNALS) {
    process.once(signal, (received: NodeJS.Signals) => {
      void application
        .get(AgentRunService)
        .interruptActiveRuns()
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          logger.warn(`중단 마감 실패, 그대로 종료한다: ${message}`);
        })
        .finally(() => {
          process.kill(process.pid, received);
        });
    });
  }
};
