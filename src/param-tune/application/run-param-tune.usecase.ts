import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { match } from 'ts-pattern';

import { ReplayBacktestUsecase } from '../../backtest/application/replay-backtest.usecase';
import { runRobustSearch } from '../../backtest/application/robust-parameter-search';
import {
  buildParameterGrid,
  buildSearchWindows,
  evaluateRobustWalkForward,
  ParameterCombination,
  RobustWalkForwardVerdict,
} from '../../backtest/domain/parameter-search';
import {
  DEFAULT_RANKING_WEIGHTS,
  SWING_VOLUME_SURGE_MINIMUM,
} from '../../screener/domain/screener-rule';
import {
  STRATEGY_PARAMETER_PORT,
  StrategyParameterPort,
} from '../../strategy-parameter/domain/port/strategy-parameter.port';
import { StrategyParameterSnapshotError } from '../../strategy-parameter/domain/strategy-parameter.exception';
import {
  StrategyParameterName,
  StrategyParameterStrategy,
} from '../../strategy-parameter/domain/strategy-parameter.type';
import { decideAdoption } from '../domain/adoption-rule';
import {
  DEFAULT_PARAM_TUNE_MODE,
  ParameterSnapshot,
  ParamTuneMode,
  TUNE_GRID,
  TUNE_SEARCH_FROM,
  TUNE_SLIPPAGE_PERCENTS,
  TUNE_WINDOW_MONTHS,
} from '../domain/param-tune.type';
import {
  PARAM_TUNE_RUN_PORT,
  ParamTuneRunPort,
  TuneRunPatch,
} from '../domain/port/param-tune-run.port';
import { combinationFromSnapshot } from '../domain/tune-combination';
import { lastCompletedWindowEnd } from '../domain/tune-schedule';
import { EvaluateProbationService } from './evaluate-probation.service';

export interface RunParamTuneInput {
  runId: number;
  attemptToken: string;
  strategy: StrategyParameterStrategy;
  axis: StrategyParameterName;
  today: string;
  agentRunId: number | null;
}

/** `verdict` 컬럼에 저장되고 캐시 적중 때 그대로 읽히는 모양. */
export interface StoredVerdict {
  verdicts: RobustWalkForwardVerdict[];
  combinations: Array<{ label: string; combination: ParameterCombination }>;
  chosenLabel: string | null;
}

interface SearchOutcome {
  verdictKey: string;
  verdict: StoredVerdict;
  excluded: number[];
}

const MODES: readonly ParamTuneMode[] = ['off', 'observe', 'apply'];

const isStoredVerdict = (value: unknown): value is StoredVerdict =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as StoredVerdict).verdicts) &&
  Array.isArray((value as StoredVerdict).combinations);

/**
 * 자식 프로세스 본체: 시험 평가(필요하면 롤백) → 탐색 → 채택 판정 → 반영.
 * 어떤 경로든 끝에서 `finish` 또는 `markFailed` 중 하나를 부른다.
 */
@Injectable()
export class RunParamTuneUsecase {
  private readonly logger = new Logger(RunParamTuneUsecase.name);

  constructor(
    @Inject(PARAM_TUNE_RUN_PORT) private readonly runPort: ParamTuneRunPort,
    @Inject(STRATEGY_PARAMETER_PORT)
    private readonly parameterPort: StrategyParameterPort,
    private readonly evaluateProbation: EvaluateProbationService,
    private readonly replay: ReplayBacktestUsecase,
    private readonly configService: ConfigService,
  ) {}

  async execute(input: RunParamTuneInput): Promise<void> {
    try {
      await this.run(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason =
        error instanceof StrategyParameterSnapshotError
          ? `활성 행 없음: ${message}`
          : message.split('\n')[0];
      this.logger.error(`param-tune run #${input.runId} 실패: ${message}`);
      // markFailed 자체가 실패하면 그대로 던진다 — 행이 RUNNING 으로 남아 stale 회수 대상이 된다.
      await this.runPort.markFailed({
        runId: input.runId,
        attemptToken: input.attemptToken,
        reason,
      });
    }
  }

  private async run(input: RunParamTuneInput): Promise<void> {
    const mode = this.readMode();
    const snapshot = await this.parameterPort.findSnapshotStrict(
      input.strategy,
    );

    const probation = await this.evaluateProbation.evaluate({
      strategy: input.strategy,
      snapshot,
      today: input.today,
      runId: input.runId,
      agentRunId: input.agentRunId,
    });
    if (probation.rolledBack) {
      await this.finish(input, {
        status: 'DONE',
        decisionReason: '롤백한 주라 탐색하지 않음',
      });
      return;
    }
    if (probation.realProbationOpen) {
      await this.finish(input, { status: 'SKIPPED_PROBATION' });
      return;
    }
    if (mode === 'off') {
      await this.finish(input, { status: 'DONE', decisionReason: 'off' });
      return;
    }

    const stored = await this.searchOrReuse(input, snapshot);
    const patch = await this.adopt(input, snapshot, mode, stored);
    await this.finish(input, {
      status: 'DONE',
      parameterSnapshot: snapshot,
      verdictKey: stored.verdictKey,
      verdict: stored.verdict,
      ...patch,
    });
  }

  private readMode(): ParamTuneMode {
    const raw =
      this.configService.get<string>('PARAM_AUTO_TUNE_MODE') ??
      DEFAULT_PARAM_TUNE_MODE;
    const mode = MODES.find((candidate) => candidate === raw);
    if (mode === undefined) {
      throw new Error(`알 수 없는 PARAM_AUTO_TUNE_MODE: ${raw}`);
    }
    return mode;
  }

  private async searchOrReuse(
    input: RunParamTuneInput,
    snapshot: ParameterSnapshot,
  ): Promise<SearchOutcome> {
    const excluded = await this.runPort.findExcludedValues({
      strategy: input.strategy,
      axis: input.axis,
      now: new Date(),
    });
    const windowEnd = lastCompletedWindowEnd(input.today);
    const verdictKey = [
      input.axis,
      windowEnd,
      ...snapshot.map((entry) => entry.version),
      ...[...excluded].sort((left, right) => left - right),
    ].join('|');

    const cached = await this.runPort.findVerdictByKey(verdictKey);
    if (cached !== null && isStoredVerdict(cached.verdict)) {
      return { verdictKey, verdict: cached.verdict, excluded };
    }

    const current = combinationFromSnapshot(snapshot);
    const candidates = TUNE_GRID[input.axis].filter(
      (value) => !excluded.includes(value),
    );
    const only = (axis: StrategyParameterName, own: number): number[] =>
      axis === input.axis ? candidates : [own];
    const combinations = buildParameterGrid({
      takeProfitPercents: only(
        'EXIT_TAKE_PROFIT_PERCENT',
        current.takeProfitPercent as number,
      ),
      stopLossPercents: only(
        'EXIT_STOP_LOSS_PERCENT',
        current.stopLossPercent as number,
      ),
      minimumTurnover60s: only('MINIMUM_TURNOVER60', current.minimumTurnover60),
      maximumWeightPercents: only(
        'MAXIMUM_WEIGHT_PERCENT',
        current.maximumWeightPercent,
      ),
      volumeSurgeMinimums: [SWING_VOLUME_SURGE_MINIMUM],
      rankingWeights: [DEFAULT_RANKING_WEIGHTS],
      includeBandless: false,
      baseline: current,
    });
    const windows = buildSearchWindows({
      from: TUNE_SEARCH_FROM,
      to: windowEnd,
      windowMonths: TUNE_WINDOW_MONTHS,
      stepMonths: TUNE_WINDOW_MONTHS,
    });

    const searched = await runRobustSearch(
      {
        windows,
        slippagePercents: [...TUNE_SLIPPAGE_PERCENTS],
        strategies: [
          { strategy: input.strategy, baseline: current, combinations },
        ],
      },
      this.replay,
    );
    const output = searched.get(input.strategy);
    if (output === undefined) {
      throw new Error(`탐색 결과에 ${input.strategy} 가 없다`);
    }
    const verdicts = evaluateRobustWalkForward({
      conditions: output.conditions,
      baselineLabel: output.baselineLabel,
    });
    return {
      verdictKey,
      excluded,
      verdict: {
        verdicts,
        combinations: [...output.combinationByLabel].map(
          ([label, combination]) => ({ label, combination }),
        ),
        chosenLabel: verdicts.at(-1)?.chosenLabel ?? null,
      },
    };
  }

  private async adopt(
    input: RunParamTuneInput,
    snapshot: ParameterSnapshot,
    mode: ParamTuneMode,
    searched: SearchOutcome,
  ): Promise<TuneRunPatch> {
    const stored = searched.verdict;
    const currentEntry = snapshot.find((entry) => entry.name === input.axis);
    if (currentEntry === undefined) {
      throw new Error(`스냅샷에 ${input.axis} 이 없다`);
    }
    const decision = decideAdoption({
      axis: input.axis,
      verdicts: stored.verdicts,
      combinationByLabel: new Map(
        stored.combinations.map((entry) => [entry.label, entry.combination]),
      ),
      currentValue: currentEntry.value,
    });
    return await match(decision)
      .with({ kind: 'NO_CHANGE' }, (noChange) => ({
        decision: 'NO_CHANGE' as const,
        decisionReason: noChange.reason,
      }))
      .with({ kind: 'ADOPT' }, async (adopt) => {
        const proposal = {
          previousValue: currentEntry.value,
          candidateValue: adopt.value,
        };
        // 한 칸 제한이 격자에서 뺀 값을 다시 고르면 제외 기간이 무력해진다.
        if (searched.excluded.includes(adopt.value)) {
          return {
            decision: 'NO_CHANGE' as const,
            decisionReason: `제외된 값(${adopt.value})으로 한 칸 제한됨`,
          };
        }
        if (mode !== 'apply') {
          // 판정이 반년 재사용되므로 같은 값의 가상 시험을 주마다 쌓지 않는다.
          const open = (
            await this.runPort.findWouldApplyUnevaluated(input.strategy)
          ).find(
            (row) =>
              row.axis === input.axis && row.candidateValue === adopt.value,
          );
          if (open !== undefined) {
            return {
              decision: 'NO_CHANGE' as const,
              decisionReason: `같은 값 가상 시험 중 (run #${open.runId})`,
            };
          }
          return {
            decision: 'WOULD_APPLY' as const,
            decisionReason: adopt.reason,
            ...proposal,
          };
        }
        const result = await this.parameterPort.activateNewVersion({
          strategy: input.strategy,
          name: input.axis,
          expectedSnapshot: snapshot,
          value: adopt.value,
          reason: `자동 조정 (run #${input.runId}): ${adopt.reason}`,
          agentRunId: input.agentRunId,
        });
        if (result.kind === 'CONFLICT') {
          return {
            decision: 'NO_CHANGE' as const,
            decisionReason: '활성값 변경 감지',
          };
        }
        return {
          decision: 'APPLIED' as const,
          decisionReason: adopt.reason,
          ...proposal,
          previousParameterId: currentEntry.parameterId,
          appliedParameterId: result.parameterId,
          appliedAt: new Date(),
        };
      })
      .exhaustive();
  }

  private async finish(
    input: RunParamTuneInput,
    patch: TuneRunPatch,
  ): Promise<void> {
    const written = await this.runPort.finish({
      runId: input.runId,
      attemptToken: input.attemptToken,
      patch,
    });
    if (!written) {
      this.logger.warn(
        `param-tune run #${input.runId}: 토큰이 달라 기록하지 못했다 — 다른 프로세스가 행을 넘겨받았다`,
      );
    }
  }
}
