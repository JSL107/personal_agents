import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SubconsciousGate } from '../domain/port/subconscious-gate.port';
import { GateDecision, RedactedChange } from '../domain/subconscious.type';
import { JevSubconsciousGate } from './jev-subconscious-gate';
import { LlmSubconsciousGate } from './llm-subconscious-gate';

type GateMode = 'legacy' | 'shadow' | 'hybrid';

@Injectable()
export class HybridSubconsciousGate implements SubconsciousGate {
  private readonly logger = new Logger(HybridSubconsciousGate.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jevGate: JevSubconsciousGate,
    private readonly legacyGate: LlmSubconsciousGate,
  ) {}

  async judge(changes: RedactedChange[]): Promise<GateDecision[]> {
    const mode = this.mode;
    if (mode === 'legacy' || changes.length === 0) {
      return this.legacyGate.judge(changes);
    }
    if (mode === 'shadow') {
      return this.shadow(changes);
    }
    return this.hybrid(changes);
  }

  private async shadow(changes: RedactedChange[]): Promise<GateDecision[]> {
    const [legacyResult, jevResult] = await Promise.allSettled([
      this.legacyGate.judge(changes),
      this.jevGate.evaluate(changes),
    ]);

    if (jevResult.status === 'rejected') {
      this.logger.warn(
        `Jev shadow 판단 실패 — 기존 LLM 결과 사용: ${jevResult.reason instanceof Error ? jevResult.reason.message : String(jevResult.reason)}`,
      );
    } else {
      const legacyByKey = new Map(
        legacyResult.status === 'fulfilled'
          ? legacyResult.value.map((decision) => [decision.changeKey, decision])
          : [],
      );
      const jevByKey = new Map(
        jevResult.value.decisions.map((decision) => [
          decision.changeKey,
          decision,
        ]),
      );
      const mismatches = changes.filter((change) => {
        const legacy = legacyByKey.get(change.key);
        const jev = jevByKey.get(change.key);
        return (
          legacy === undefined ||
          jev === undefined ||
          legacy.promote !== jev.promote ||
          legacy.suggestedAgentType !== jev.suggestedAgentType
        );
      }).length;
      this.logger.log(
        `Jev shadow 판단 완료 — changes=${changes.length}, mismatches=${mismatches}, jevDecisions=${jevResult.value.decisions.length}, confidentPromotions=${jevResult.value.confidentDecisions.length}, fallback=${jevResult.value.fallbackChanges.length}, model=${jevResult.value.model}`,
      );
    }

    if (legacyResult.status === 'rejected') {
      throw legacyResult.reason;
    }
    return legacyResult.value;
  }

  private async hybrid(changes: RedactedChange[]): Promise<GateDecision[]> {
    try {
      const jev = await this.jevGate.evaluate(changes);
      const fallbackDecisions =
        jev.fallbackChanges.length === 0
          ? []
          : await this.legacyGate.judge([...jev.fallbackChanges]);
      this.logger.log(
        `Jev hybrid 판단 완료 — changes=${changes.length}, confidentPromotions=${jev.confidentDecisions.length}, fallback=${jev.fallbackChanges.length}, model=${jev.model}`,
      );
      return [...jev.confidentDecisions, ...fallbackDecisions];
    } catch (error) {
      this.logger.warn(
        `Jev hybrid 판단 실패 — 전체를 기존 LLM으로 fallback: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.legacyGate.judge(changes);
    }
  }

  private get mode(): GateMode {
    const mode = this.configService
      .get<string>('SUBCONSCIOUS_GATE_MODE')
      ?.trim()
      .toLowerCase();
    return mode === 'shadow' || mode === 'hybrid' ? mode : 'legacy';
  }
}
