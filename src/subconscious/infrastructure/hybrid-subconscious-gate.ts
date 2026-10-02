import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SubconsciousGate } from '../domain/port/subconscious-gate.port';
import {
  SUBCONSCIOUS_GATE_SHADOW_REPOSITORY,
  SubconsciousGateShadowRecord,
  SubconsciousGateShadowRepository,
} from '../domain/port/subconscious-gate-shadow.repository.port';
import { GateDecision, RedactedChange } from '../domain/subconscious.type';
import { JevEvaluation, JevSubconsciousGate } from './jev-subconscious-gate';
import { LlmSubconsciousGate } from './llm-subconscious-gate';

const SHADOW_ERROR_MAX_LENGTH = 400;

const describeError = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

type GateMode = 'legacy' | 'shadow' | 'hybrid';

@Injectable()
export class HybridSubconsciousGate implements SubconsciousGate {
  private readonly logger = new Logger(HybridSubconsciousGate.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jevGate: JevSubconsciousGate,
    private readonly legacyGate: LlmSubconsciousGate,
    @Inject(SUBCONSCIOUS_GATE_SHADOW_REPOSITORY)
    private readonly shadowRepository: SubconsciousGateShadowRepository,
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

    await this.recordShadow(changes, legacyResult, jevResult);

    if (legacyResult.status === 'rejected') {
      throw legacyResult.reason;
    }
    return legacyResult.value;
  }

  // 변경마다 한 행. shadow 가 실패한 회차도 error 행으로 남긴다 — 빠진 회차와 실패한 회차를
  // 구분하지 못하면 보정 표본이 조용히 편향된다. 영속 실패는 운영 경로(legacy 반환)를 깨지 않는다.
  private async recordShadow(
    changes: RedactedChange[],
    legacyResult: PromiseSettledResult<GateDecision[]>,
    jevResult: PromiseSettledResult<JevEvaluation>,
  ): Promise<void> {
    const legacyByKey = new Map(
      legacyResult.status === 'fulfilled'
        ? legacyResult.value.map((decision) => [decision.changeKey, decision])
        : [],
    );
    const scoreByKey = new Map(
      jevResult.status === 'fulfilled'
        ? jevResult.value.scores.map((score) => [score.changeKey, score])
        : [],
    );
    const shadowModel =
      jevResult.status === 'fulfilled'
        ? jevResult.value.model
        : this.jevGate.model;
    const error =
      jevResult.status === 'rejected'
        ? describeError(jevResult.reason).slice(0, SHADOW_ERROR_MAX_LENGTH)
        : null;

    const records: SubconsciousGateShadowRecord[] = changes.map((change) => {
      const score = scoreByKey.get(change.key);
      const legacy = legacyByKey.get(change.key);
      return {
        changeKey: change.key,
        sourceId: change.sourceId,
        kind: change.kind,
        summary: change.summary,
        shadowModel,
        promoteProbability: score?.promoteProbability ?? null,
        agentChoice: score?.agentChoice ?? null,
        agentConfidence: score?.agentConfidence ?? null,
        legacyPromote: legacy?.promote ?? null,
        legacyAgent: legacy?.suggestedAgentType ?? null,
        error,
      };
    });

    try {
      await this.shadowRepository.recordMany(records);
    } catch (persistError) {
      this.logger.warn(
        `shadow 판정 저장 실패 (운영 판정은 계속): ${describeError(persistError)}`,
      );
    }
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
