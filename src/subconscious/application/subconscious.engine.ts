import { Inject, Injectable, Logger } from '@nestjs/common';

import { getKstDayStartAsUtc } from '../../common/util/kst-date.util';
import { redactPii } from '../../common/util/pii-redaction.util';
import { AgentType } from '../../model-router/domain/model-router.type';
import { diffSnapshots } from '../domain/diff-snapshots';
import type { DropSamplePolicy } from '../domain/port/drop-sample-policy.port';
import { DROP_SAMPLE_POLICY } from '../domain/port/drop-sample-policy.port';
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
  GateDecision,
  RedactedChange,
  StateChange,
  StateSnapshot,
} from '../domain/subconscious.type';

const GITHUB_PR_KEY_PREFIX = 'github:pr:';

// 표본 카드 문구는 일반 카드와 구분되지 않게 쓴다 — 표시가 있으면 "원래 버려진 것" 이라는
// 인식이 판정을 끌어당긴다. 출처는 DB 의 origin 으로만 가른다.
const buildSampleProposalText = (change: StateChange): string =>
  change.item.key.startsWith(GITHUB_PR_KEY_PREFIX)
    ? `「${change.item.summary}」 PR, 코드 리뷰할까요?`
    : `「${change.item.summary}」 — 살펴볼까요?`;

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
    @Inject(DROP_SAMPLE_POLICY)
    private readonly dropSamplePolicy: DropSamplePolicy,
  ) {}

  async runTick(ownerSlackUserId: string, now: number): Promise<void> {
    // 이번 회차의 변경을 보기 전에, 지난 회차 카드 중 스윕이 대신 처리한 것을 닫는다.
    // 실패해도 tick 본체는 진행한다 — 정리는 다음 회차에 다시 시도되고, 못 닫은 카드가
    // 새 제안을 막지도 않는다(중복 판정은 changeKey 단위라 다른 대상에 영향이 없다).
    try {
      const dismissed =
        await this.proposalEmitter.dismissSweptPending(ownerSlackUserId);
      if (dismissed > 0) {
        this.logger.log(
          `스윕이 대신 처리한 제안 카드 ${dismissed}건 자동 종료`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `제안 카드 사후 정리 실패 (tick 은 계속): ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const allChanges: StateChange[] = [];
    const successfulSnapshots = new Map<string, StateSnapshot>();

    for (const source of this.stateSources) {
      try {
        const currentSnapshot = await source.fetchSnapshot(ownerSlackUserId);
        const previousSnapshot = await this.baselineRepository.findBySource(
          ownerSlackUserId,
          source.id,
        );
        // 사라진 항목은 판정에 넘기지 않는다. 소스가 돌려주는 것은 「나에게 걸린 열린 일」뿐이라
        // (GitHub 담당 open PR·이슈, Notion 진행 중 태스크) 목록에서 빠졌다는 것은 머지·닫힘·완료·
        // 담당 해제를 뜻하고, 스냅샷만으로는 그중 무엇인지 구분할 수 없다. gate 는 그 구분 없이
        // "제거됐다" 만 보고 "의도된 대체인지 정리할까요?" 류 제안을 지어낸다(2026-09-30, 전날 머지한
        // PR 3건이 기능 누락 의심 카드로 뜸 — 역대 removed 제안은 이 1건뿐이었다). baseline 은 아래에서
        // 그대로 전진하므로 같은 항목이 다음 회차에 다시 잡히지도 않는다.
        const changes = diffSnapshots(previousSnapshot, currentSnapshot).filter(
          (change) => change.kind !== 'removed',
        );
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
        await this.sampleDropped(ownerSlackUserId, now, decision, changeByKey);
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

      // 예산 소비 전에 카드를 만들 이유가 있는지 먼저 묻는다 — 생략될 변경(이미 스윕이
      // 리뷰한 PR, 미응답 카드가 남은 대상)이 시간당 제한량을 먹으면 정작 유효한 제안이
      // Budget exhausted 로 버려진다.
      const shouldEmit = await this.proposalEmitter.shouldEmit({
        ownerUserId: ownerSlackUserId,
        decision,
      });
      if (!shouldEmit) {
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

  // legacy 가 버린 변경 일부를 일반 카드로 올려 버린 영역의 정답을 모은다. 표본 경로의 어떤 실패도
  // tick 을 죽이지 않는다 — 운영 경로(승격 카드)보다 우선순위가 낮다.
  private async sampleDropped(
    ownerSlackUserId: string,
    now: number,
    decision: GateDecision,
    changeByKey: Map<string, StateChange>,
  ): Promise<void> {
    const { rate, dailyCap, random } = this.dropSamplePolicy;
    if (rate <= 0 || dailyCap <= 0) {
      return;
    }
    const originalChange = changeByKey.get(decision.changeKey);
    if (!originalChange) {
      return;
    }
    if (random() >= rate) {
      return;
    }

    // PR 표본은 문구가 "코드 리뷰할까요?" 로 고정이라 워커도 CODE_REVIEWER 로 고정한다 — 버린 판정에
    // 다른 워커가 붙어 와도 그걸 쓰면 사람이 본 카드와 실제 실행이 어긋나고 라벨이 오염된다.
    const suggestedAgentType = decision.changeKey.startsWith(
      GITHUB_PR_KEY_PREFIX,
    )
      ? AgentType.CODE_REVIEWER
      : decision.suggestedAgentType;
    if (suggestedAgentType === undefined) {
      this.logger.debug(
        `표본 제외: changeKey="${decision.changeKey}" 는 담당 워커를 정할 수 없다`,
      );
      return;
    }

    const sampleDecision: GateDecision = {
      ...decision,
      promote: true,
      suggestedAgentType,
      // 버린 판정에 실린 문구("제안할 필요 없음" 류)를 쓰면 표본인 게 드러난다 — 항상 중립 문구.
      proposalText: buildSampleProposalText(originalChange),
    };

    try {
      const shouldEmit = await this.proposalEmitter.shouldEmit({
        ownerUserId: ownerSlackUserId,
        decision: sampleDecision,
      });
      if (!shouldEmit) {
        return;
      }
      // ponytail: count 후 emit 이라 동시 tick 이 겹치면 상한을 1~2건 넘길 수 있다. tick 은
      // BullMQ repeatable 단일 job 이라 실제로 겹치지 않는다 — 겹치게 되면 DB 유니크 슬롯으로 바꾼다.
      const sampledToday = await this.proposalEmitter.countDropSamplesSince(
        ownerSlackUserId,
        getKstDayStartAsUtc(0, now),
      );
      if (sampledToday >= dailyCap) {
        return;
      }
      // 시간당 승격 예산은 소비하지 않는다 — 표본이 진짜 제안을 밀어내지 않게.
      await this.proposalEmitter.emit({
        ownerUserId: ownerSlackUserId,
        change: originalChange,
        decision: sampleDecision,
        origin: 'DROP_SAMPLE',
      });
      this.logger.log(
        `drop 표본 카드 생성: changeKey="${decision.changeKey}" (오늘 ${sampledToday + 1}/${dailyCap})`,
      );
    } catch (error) {
      this.logger.warn(
        `drop 표본 처리 실패 (tick 은 계속): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
