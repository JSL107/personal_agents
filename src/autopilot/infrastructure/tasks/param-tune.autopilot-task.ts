import { join } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { match } from 'ts-pattern';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  ChildOutcomeKind,
  ClaimKind,
  TUNE_CHILD_TIMEOUT_MS,
} from '../../../param-tune/domain/param-tune.type';
import {
  PARAM_TUNE_RUN_PORT,
  ParamTuneRunPort,
} from '../../../param-tune/domain/port/param-tune-run.port';
import {
  axisForWeek,
  weekStartOf,
} from '../../../param-tune/domain/tune-schedule';
import { formatParamTuneReport } from '../../../param-tune/infrastructure/param-tune.formatter';
import { ParamTuneChildLauncher } from '../../../param-tune/infrastructure/param-tune-child.launcher';
import { StrategyParameterStrategy } from '../../../strategy-parameter/domain/strategy-parameter.type';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const STRATEGIES: readonly StrategyParameterStrategy[] = ['SWING', 'LONG_TERM'];
const EMPTY_REASON = '이번 주 알릴 자동 조정 없음';

@Injectable()
export class ParamTuneAutopilotTask implements AutopilotTask {
  readonly id = 'param-tune';
  private readonly logger = new Logger(ParamTuneAutopilotTask.name);

  constructor(
    @Inject(PARAM_TUNE_RUN_PORT)
    private readonly runPort: ParamTuneRunPort,
    private readonly launcher: ParamTuneChildLauncher,
    private readonly agentRunService: AgentRunService,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const weekStart = weekStartOf(context.firedAtKst);
    const axis = axisForWeek(weekStart);

    const outcome = await this.agentRunService.execute<AutopilotTaskResult>({
      agentType: AgentType.INVEST,
      triggerType: TriggerType.AUTOPILOT_PARAM_TUNE_CRON,
      inputSnapshot: { weekStart, axis },
      run: async ({ agentRunId }) => {
        const spawnFailures: string[] = [];
        // 두 전략은 같은 DB·시세 캐시를 쓰는 수십 분짜리 재생이라 병렬로 돌리지 않는다.
        for (const strategy of STRATEGIES) {
          // 루프 밖에서 잡으면 두 번째 전략의 선점 시각이 첫 전략 실행 시간(최대 60분)만큼
          // 과거가 되어 RUNNING 만료(90분) 판정이 일찍 걸리고 아직 도는 자식을 중복 실행할 수 있다.
          const claimedAt = new Date();
          const claim = await this.runPort.claim({
            weekStart,
            strategy,
            axis,
            now: claimedAt,
          });
          if (claim.kind !== ClaimKind.CLAIMED) {
            continue;
          }
          const child = await this.launcher.run({
            args: [
              '--run-id',
              String(claim.runId),
              '--attempt-token',
              claim.attemptToken,
              '--strategy',
              strategy,
              '--axis',
              axis,
              '--today',
              context.firedAtKst,
              '--agent-run-id',
              String(agentRunId),
            ],
            logPath: join('logs', 'param-tune', `${weekStart}-${strategy}.log`),
            timeoutMs: TUNE_CHILD_TIMEOUT_MS,
          });

          if (child.kind === ChildOutcomeKind.EXITED && child.code === 0) {
            // 정상이면 자식이 행을 DONE 으로 닫았다. 아직 RUNNING 이면 다음 회차의 stale 회수가 맡는다.
            this.logger.log(
              `param-tune ${strategy}: 자식이 종료 코드 0 으로 끝났다 (run ${claim.runId}).`,
            );
            continue;
          }
          const reason = match(child)
            .with(
              { kind: ChildOutcomeKind.EXITED },
              (exited) =>
                `자식 프로세스 종료 코드 ${exited.code}\n${exited.tail}`,
            )
            .with(
              { kind: ChildOutcomeKind.TIMEOUT },
              (timedOut) => `자식 프로세스 시간 초과\n${timedOut.tail}`,
            )
            .with(
              { kind: ChildOutcomeKind.SPAWN_FAILED },
              (failed) => `자식 프로세스 기동 실패: ${failed.message}`,
            )
            .exhaustive();
          await this.runPort.markFailed({
            runId: claim.runId,
            attemptToken: claim.attemptToken,
            reason,
          });
          if (child.kind === ChildOutcomeKind.SPAWN_FAILED) {
            spawnFailures.push(`${strategy}: ${child.message}`);
          }
        }

        // 기동 실패는 환경 문제일 가능성이 커 같은 이유로 둘 다 실패했을 것이다. 행을 모두
        // 마킹한 뒤 한 번만 올려 BullMQ 재시도가 FAILED 행을 다시 선점하게 한다.
        if (spawnFailures.length > 0) {
          throw new Error(
            `param-tune 자식 프로세스 기동 실패 — ${spawnFailures.join(' / ')}`,
          );
        }

        return {
          result: await this.buildResult(),
          modelUsed: 'deterministic',
          output: { weekStart, axis },
        };
      },
    });
    return outcome.result;
  }

  private async buildResult(): Promise<AutopilotTaskResult> {
    const rows = await this.runPort.findUnnotified();
    if (rows.length === 0) {
      return { skip: true, emptyReason: EMPTY_REASON };
    }
    const ids = rows.map((row) => row.id);
    return {
      skip: false,
      summaryText: formatParamTuneReport(rows),
      // 발송이 실패하면 호출되지 않아 다음 회차에 같은 행이 다시 후보가 된다.
      onDelivered: async () =>
        this.runPort.markNotified({ ids, at: new Date() }),
    };
  }
}
