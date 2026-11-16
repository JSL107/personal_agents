import { Inject, Injectable } from '@nestjs/common';

import {
  createReplayWindowCache,
  ReplayBacktestUsecase,
} from '../../backtest/application/replay-backtest.usecase';
import { replayParameters } from '../../backtest/application/robust-parameter-search';
import { BACKTEST_DEFAULTS } from '../../backtest/interface/backtest-cli.parser';
import { getKstDateOf, utcMidnightOf } from '../../common/util/kst-date.util';
import {
  STRATEGY_PARAMETER_PORT,
  StrategyParameterPort,
} from '../../strategy-parameter/domain/port/strategy-parameter.port';
import { StrategyParameterStrategy } from '../../strategy-parameter/domain/strategy-parameter.type';
import {
  ParameterSnapshot,
  TUNE_SLIPPAGE_PERCENTS,
  TuneEvaluation,
} from '../domain/param-tune.type';
import {
  OpenProbation,
  PARAM_TUNE_RUN_PORT,
  ParamTuneRunPort,
} from '../domain/port/param-tune-run.port';
import {
  decideRollback,
  ProbationReplay,
  RollbackDecision,
} from '../domain/rollback-rule';
import {
  combinationFromSnapshot,
  withAxisValue,
} from '../domain/tune-combination';

const MS_PER_DAY = 86_400_000;

export interface EvaluateProbationInput {
  strategy: StrategyParameterStrategy;
  snapshot: ParameterSnapshot;
  today: string;
  runId: number;
  agentRunId: number | null;
}

export interface EvaluateProbationOutcome {
  /** 이번 호출에서 실제 롤백이 적용됐다 — 스냅샷이 바뀌었으니 같은 회차에서 탐색하면 안 된다. */
  rolledBack: boolean;
  /** 평가 뒤에도 확정되지 않은 실제 시험이 남았다. */
  realProbationOpen: boolean;
}

interface Judgement {
  decision: RollbackDecision;
  detail: unknown;
}

const toPercent = (rate: string | null): number | null =>
  rate === null ? null : Number(rate) * 100;

/** 자동 반영된 값의 시험 평가와 롤백. 모드와 무관하게 돈다. */
@Injectable()
export class EvaluateProbationService {
  constructor(
    @Inject(PARAM_TUNE_RUN_PORT) private readonly runPort: ParamTuneRunPort,
    @Inject(STRATEGY_PARAMETER_PORT)
    private readonly parameterPort: StrategyParameterPort,
    private readonly replay: ReplayBacktestUsecase,
  ) {}

  async evaluate(
    input: EvaluateProbationInput,
  ): Promise<EvaluateProbationOutcome> {
    const real = await this.runPort.findOpenProbation(input.strategy);
    let rolledBack = false;
    let realProbationOpen = false;
    if (real !== null) {
      const result = await this.evaluateReal(real, input);
      rolledBack = result.rolledBack;
      realProbationOpen = !result.settled;
    }

    // 가상 시험은 값을 바꾸지 않고 기록만 하며 회차를 막지 않는다.
    const virtuals = await this.runPort.findWouldApplyUnevaluated(
      input.strategy,
    );
    for (const virtual of virtuals) {
      await this.evaluateVirtual(virtual, input);
    }
    return { rolledBack, realProbationOpen };
  }

  private async evaluateReal(
    probation: OpenProbation,
    input: EvaluateProbationInput,
  ): Promise<{ settled: boolean; rolledBack: boolean }> {
    const { decision, detail } = await this.judge(probation, input);
    switch (decision.kind) {
      case 'WAIT':
        return { settled: false, rolledBack: false };
      case 'INCONCLUSIVE':
        return {
          settled: decision.final
            ? await this.settle(probation, 'INCONCLUSIVE', detail)
            : false,
          rolledBack: false,
        };
      case 'KEEP':
        return {
          settled: await this.settle(probation, 'KEEP', detail),
          rolledBack: false,
        };
      case 'ROLLBACK': {
        const rolledBack = await this.rollback(probation, input);
        await this.settle(
          probation,
          rolledBack ? 'ROLLBACK' : 'ROLLBACK_SKIPPED',
          detail,
        );
        return { settled: true, rolledBack };
      }
    }
  }

  private async evaluateVirtual(
    probation: OpenProbation,
    input: EvaluateProbationInput,
  ): Promise<void> {
    const { decision, detail } = await this.judge(probation, input);
    switch (decision.kind) {
      case 'WAIT':
        return;
      case 'INCONCLUSIVE':
        if (decision.final) {
          await this.settle(probation, 'INCONCLUSIVE', detail);
        }
        return;
      case 'KEEP':
        await this.settle(probation, 'WOULD_KEEP', detail);
        return;
      case 'ROLLBACK':
        await this.settle(probation, 'WOULD_ROLLBACK', detail);
        return;
    }
  }

  /** 롤백을 적용했으면 true. 대상 값이 이미 다른 행으로 바뀌었거나 충돌이면 건너뛴다. */
  private async rollback(
    probation: OpenProbation,
    input: EvaluateProbationInput,
  ): Promise<boolean> {
    const current = input.snapshot.find(
      (entry) => entry.name === probation.axis,
    );
    if (
      current === undefined ||
      current.parameterId !== probation.appliedParameterId
    ) {
      return false;
    }
    const result = await this.parameterPort.activateNewVersion({
      strategy: input.strategy,
      name: probation.axis,
      expectedSnapshot: input.snapshot,
      value: probation.previousValue,
      reason: `자동 조정 롤백 (run #${input.runId})`,
      agentRunId: input.agentRunId,
    });
    return result.kind === 'ACTIVATED';
  }

  private async settle(
    probation: OpenProbation,
    evaluation: TuneEvaluation,
    detail: unknown,
  ): Promise<boolean> {
    return await this.runPort.settleEvaluation({
      runId: probation.runId,
      evaluation,
      detail,
    });
  }

  private async judge(
    probation: OpenProbation,
    input: EvaluateProbationInput,
  ): Promise<Judgement> {
    const from = getKstDateOf(probation.startedOn);
    const to = input.today;
    const daysSinceApplied = Math.round(
      (utcMidnightOf(to).getTime() - utcMidnightOf(from).getTime()) /
        MS_PER_DAY,
    );
    const current = combinationFromSnapshot(input.snapshot);
    const previous = withAxisValue(
      current,
      probation.axis,
      probation.previousValue,
    );
    const applied = withAxisValue(
      current,
      probation.axis,
      probation.candidateValue,
    );
    const cache = createReplayWindowCache(
      from,
      to,
      BACKTEST_DEFAULTS.volatilityEstimator,
    );

    const replays: ProbationReplay[] = [];
    for (const slippagePercent of TUNE_SLIPPAGE_PERCENTS) {
      const common = { strategy: input.strategy, from, to, slippagePercent };
      const appliedResult = await replayParameters(
        { ...common, combination: applied },
        this.replay,
        cache,
      );
      const previousResult = await replayParameters(
        { ...common, combination: previous },
        this.replay,
        cache,
      );
      const score = appliedResult.scores.find(
        (candidate) => candidate.strategy === input.strategy,
      );
      replays.push({
        slippagePercent,
        previousExcessPercent: toPercent(previousResult.meanExcessReturnRate),
        appliedExcessPercent: toPercent(appliedResult.meanExcessReturnRate),
        appliedClosedCount: score?.closedCount ?? 0,
        tradeDateCount: appliedResult.tradeDateCount,
        invariantViolated:
          appliedResult.invariantViolations.length > 0 ||
          previousResult.invariantViolations.length > 0,
      });
    }
    const decision = decideRollback({ replays, daysSinceApplied });
    return { decision, detail: { decision, replays, daysSinceApplied } };
  }
}
