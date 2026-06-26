import { Inject, Injectable, Logger } from '@nestjs/common';

import { redactPii } from '../../model-router/infrastructure/pii-redaction.util';
import { diffSnapshots } from '../domain/diff-snapshots';
import type { PromotionBudget } from '../domain/port/promotion-budget.port';
import { PROMOTION_BUDGET } from '../domain/port/promotion-budget.port';
import type { ProposalEmitter } from '../domain/port/proposal-emitter.port';
import { PROPOSAL_EMITTER } from '../domain/port/proposal-emitter.port';
import type { StateSource } from '../domain/port/state-source.port';
import { STATE_SOURCES } from '../domain/port/state-source.port';
import type { SubconsciousBaselineRepository } from '../domain/port/subconscious-baseline.repository.port';
import { SUBCONSCIOUS_BASELINE_REPOSITORY } from '../domain/port/subconscious-baseline.repository.port';
import type { SubconsciousGate } from '../domain/port/subconscious-gate.port';
import { SUBCONSCIOUS_GATE } from '../domain/port/subconscious-gate.port';
import {
  RedactedChange,
  StateChange,
  StateSnapshot,
} from '../domain/subconscious.type';

@Injectable()
export class SubconsciousEngine {
  private readonly logger = new Logger(SubconsciousEngine.name);

  constructor(
    @Inject(STATE_SOURCES)
    private readonly stateSources: StateSource[],
    @Inject(SUBCONSCIOUS_GATE)
    private readonly gate: SubconsciousGate,
    @Inject(PROMOTION_BUDGET)
    private readonly budget: PromotionBudget,
    @Inject(SUBCONSCIOUS_BASELINE_REPOSITORY)
    private readonly baselineRepository: SubconsciousBaselineRepository,
    @Inject(PROPOSAL_EMITTER)
    private readonly proposalEmitter: ProposalEmitter,
  ) {}

  async runTick(ownerSlackUserId: string, now: number): Promise<void> {
    const allChanges: StateChange[] = [];
    const successfulSnapshots = new Map<string, StateSnapshot>();

    for (const source of this.stateSources) {
      try {
        const currentSnapshot = await source.fetchSnapshot(ownerSlackUserId);
        const previousSnapshot = await this.baselineRepository.findBySource(
          ownerSlackUserId,
          source.id,
        );
        const changes = diffSnapshots(previousSnapshot, currentSnapshot);
        allChanges.push(...changes);
        successfulSnapshots.set(source.id, currentSnapshot);
      } catch (error) {
        this.logger.error(
          `StateSource "${source.id}" fetchSnapshot failed — skipping baseline advance`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    // Upsert baseline for all successfully-fetched sources (even if no changes).
    for (const [sourceId, snapshot] of successfulSnapshots) {
      await this.baselineRepository.upsert(
        ownerSlackUserId,
        sourceId,
        snapshot,
      );
    }

    if (allChanges.length === 0) {
      this.logger.log(
        `runTick(${ownerSlackUserId}): no changes — gate not called`,
      );
      return;
    }

    // Redact PII from change summaries before passing to the gate.
    const redactedChanges: RedactedChange[] = allChanges.map((change) => ({
      sourceId: change.sourceId,
      kind: change.kind,
      key: change.item.key,
      summary: redactPii(change.item.summary),
    }));

    const decisions = await this.gate.judge(redactedChanges);

    // Map decisions back to their original StateChange by changeKey.
    const changeByKey = new Map<string, StateChange>(
      allChanges.map((change) => [change.item.key, change]),
    );

    for (const decision of decisions) {
      if (!decision.promote) {
        continue;
      }
      if (!decision.suggestedAgentType) {
        this.logger.warn(
          `Gate promoted changeKey="${decision.changeKey}" but omitted suggestedAgentType — dropping`,
        );
        continue;
      }

      const originalChange = changeByKey.get(decision.changeKey);
      if (!originalChange) {
        this.logger.warn(
          `Gate returned unknown changeKey="${decision.changeKey}" — dropping`,
        );
        continue;
      }

      const consumed = await this.budget.tryConsume(ownerSlackUserId, now);
      if (!consumed) {
        this.logger.warn(
          `Budget exhausted for owner="${ownerSlackUserId}" — dropping changeKey="${decision.changeKey}"`,
        );
        continue;
      }

      await this.proposalEmitter.emit({
        ownerUserId: ownerSlackUserId,
        change: originalChange,
        decision,
      });
    }
  }
}
