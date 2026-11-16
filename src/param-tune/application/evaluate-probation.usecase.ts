import { Inject, Injectable } from '@nestjs/common';

import {
  createReplayWindowCache,
  ReplayBacktestUsecase,
} from '../../backtest/application/replay-backtest.usecase';
import { replayParameters } from '../../backtest/application/robust-parameter-search';
import { BACKTEST_DEFAULTS } from '../../backtest/interface/backtest-cli.parser';
import { getKstDateOf, utcMidnightOf } from '../../common/util/kst-date.util';
import { StrategyParameterStrategy } from '../../strategy-parameter/domain/strategy-parameter.type';
import { ActivateNewVersionKind } from '../../strategy-parameter/domain/strategy-parameter.type';
import {
  ParameterSnapshot,
  TUNE_SLIPPAGE_PERCENTS,
  TuneEvaluation,
} from '../domain/param-tune.type';
import { RollbackDecisionKind } from '../domain/param-tune.type';
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

interface ProbationTarget {
  probation: OpenProbation;
  input: EvaluateProbationInput;
}

interface RollbackTarget extends ProbationTarget {
  detail: unknown;
}

interface Settlement {
  probation: OpenProbation;
  evaluation: TuneEvaluation;
  detail: unknown;
}

interface RealProbationResult {
  /** 실제 시험이 없거나 이번에 확정됐다. */
  settled: boolean;
  rolledBack: boolean;
}

interface Judgement {
  decision: RollbackDecision;
  detail: unknown;
}

const toPercent = (rate: string | null): number | null =>
  rate === null ? null : Number(rate) * 100;

/** 자동 반영된 값의 시험 평가와 롤백. 모드와 무관하게 돈다. */
@Injectable()
export class EvaluateProbationUsecase {
  constructor(
    @Inject(PARAM_TUNE_RUN_PORT) private readonly runPort: ParamTuneRunPort,
    private readonly replay: ReplayBacktestUsecase,
  ) {}

  async evaluate(
    input: EvaluateProbationInput,
  ): Promise<EvaluateProbationOutcome> {
    const real = await this.evaluateOpenReal(input);

    // 가상 시험은 값을 바꾸지 않고 기록만 하며 회차를 막지 않는다.
    const virtuals = await this.runPort.findWouldApplyUnevaluated(
      input.strategy,
    );
    for (const virtual of virtuals) {
      await this.evaluateVirtual({ probation: virtual, input });
    }
    return { rolledBack: real.rolledBack, realProbationOpen: !real.settled };
  }

  private async evaluateOpenReal(
    input: EvaluateProbationInput,
  ): Promise<RealProbationResult> {
    const probation = await this.runPort.findOpenProbation(input.strategy);
    if (probation === null) {
      return { settled: true, rolledBack: false };
    }
    return await this.evaluateReal({ probation, input });
  }

  private async evaluateReal(
    target: ProbationTarget,
  ): Promise<RealProbationResult> {
    const { probation } = target;
    const { decision, detail } = await this.judge(target);
    switch (decision.kind) {
      case RollbackDecisionKind.WAIT:
        return { settled: false, rolledBack: false };
      case RollbackDecisionKind.INCONCLUSIVE: {
        if (!decision.final) {
          return { settled: false, rolledBack: false };
        }
        const settled = await this.settle({
          probation,
          evaluation: TuneEvaluation.INCONCLUSIVE,
          detail,
        });
        return { settled, rolledBack: false };
      }
      case RollbackDecisionKind.KEEP: {
        const settled = await this.settle({
          probation,
          evaluation: TuneEvaluation.KEEP,
          detail,
        });
        return { settled, rolledBack: false };
      }
      case RollbackDecisionKind.ROLLBACK: {
        const rolledBack = await this.rollback({ ...target, detail });
        if (!rolledBack) {
          await this.settle({
            probation,
            evaluation: TuneEvaluation.ROLLBACK_SKIPPED,
            detail,
          });
        }
        return { settled: true, rolledBack };
      }
    }
  }

  private async evaluateVirtual(target: ProbationTarget): Promise<void> {
    const { probation } = target;
    const { decision, detail } = await this.judge(target);
    switch (decision.kind) {
      case RollbackDecisionKind.WAIT:
        return;
      case RollbackDecisionKind.INCONCLUSIVE:
        if (decision.final) {
          await this.settle({
            probation,
            evaluation: TuneEvaluation.INCONCLUSIVE,
            detail,
          });
        }
        return;
      case RollbackDecisionKind.KEEP:
        await this.settle({
          probation,
          evaluation: TuneEvaluation.WOULD_KEEP,
          detail,
        });
        return;
      case RollbackDecisionKind.ROLLBACK:
        await this.settle({
          probation,
          evaluation: TuneEvaluation.WOULD_ROLLBACK,
          detail,
        });
        return;
    }
  }

  /**
   * 롤백을 적용했으면 true — 이때 ROLLBACK 확정도 같은 트랜잭션에서 끝났다.
   * 대상 값이 이미 다른 행으로 바뀌었거나 충돌이면 아무것도 쓰지 않고 false.
   */
  private async rollback({
    probation,
    input,
    detail,
  }: RollbackTarget): Promise<boolean> {
    const current = input.snapshot.find(
      (entry) => entry.name === probation.axis,
    );
    const stillApplied = current?.parameterId === probation.appliedParameterId;
    if (!stillApplied) {
      return false;
    }
    // 활성화와 평가 확정이 따로 쓰이면 그 사이에 죽었을 때 다음 회차가 ROLLBACK_SKIPPED 로
    // 확정해 제외 목록이 비고, 같은 값이 다시 채택된다.
    const result = await this.runPort.commitRollback({
      runId: probation.runId,
      activation: {
        strategy: input.strategy,
        name: probation.axis,
        expectedSnapshot: input.snapshot,
        value: probation.previousValue,
        reason: `자동 조정 롤백 (run #${input.runId})`,
        agentRunId: input.agentRunId,
      },
      detail,
    });
    return result.kind === ActivateNewVersionKind.ACTIVATED;
  }

  private async settle({
    probation,
    evaluation,
    detail,
  }: Settlement): Promise<boolean> {
    return await this.runPort.settleEvaluation({
      runId: probation.runId,
      evaluation,
      detail,
    });
  }

  private async judge({
    probation,
    input,
  }: ProbationTarget): Promise<Judgement> {
    const from = getKstDateOf(probation.startedOn);
    const to = input.today;
    const daysSinceApplied = Math.round(
      (utcMidnightOf(to).getTime() - utcMidnightOf(from).getTime()) /
        MS_PER_DAY,
    );
    const current = combinationFromSnapshot(input.snapshot);
    const previous = withAxisValue({
      combination: current,
      axis: probation.axis,
      value: probation.previousValue,
    });
    const applied = withAxisValue({
      combination: current,
      axis: probation.axis,
      value: probation.candidateValue,
    });
    const cache = createReplayWindowCache(
      from,
      to,
      BACKTEST_DEFAULTS.volatilityEstimator,
    );

    const replays: ProbationReplay[] = [];
    for (const slippagePercent of TUNE_SLIPPAGE_PERCENTS) {
      const common = { strategy: input.strategy, from, to, slippagePercent };
      const appliedResult = await replayParameters({
        input: { ...common, combination: applied },
        replay: this.replay,
        cache,
      });
      const previousResult = await replayParameters({
        input: { ...common, combination: previous },
        replay: this.replay,
        cache,
      });
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
