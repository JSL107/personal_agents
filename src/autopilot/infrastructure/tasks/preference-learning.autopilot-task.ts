import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  InferenceResult,
  PreferenceInferenceAdapter,
} from '../../../preference-profile/application/preference-inference.adapter';
import { PreferenceSignalCollector } from '../../../preference-profile/application/preference-signal.collector';
import {
  PREFERENCE_PROFILE_REPOSITORY,
  PreferenceProfileRepositoryPort,
} from '../../../preference-profile/domain/port/preference-profile.repository.port';
import {
  PREFERENCE_PROPOSAL_REPOSITORY,
  PreferenceProposalRepositoryPort,
} from '../../../preference-profile/domain/port/preference-proposal.repository.port';
import { EMPTY_PROFILE } from '../../../preference-profile/domain/preference-profile.type';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { formatPreferenceProposal } from '../../../slack/format/preference-proposal.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SIGNAL_CAP = 30;

@Injectable()
export class PreferenceLearningAutopilotTask implements AutopilotTask {
  readonly id = 'preference-learning';

  // skip 분기가 5개라 로그 없이는 "돌았는데 조용했다" 와 "안 돌았다" 가 구별되지 않는다.
  // 태스크 결과에는 skip 사유를 실을 자리가 없어(AutopilotTaskResult) 여기서 직접 남긴다.
  private readonly logger = new Logger(PreferenceLearningAutopilotTask.name);

  constructor(
    private readonly collector: PreferenceSignalCollector,
    private readonly inference: PreferenceInferenceAdapter,
    @Inject(PREFERENCE_PROFILE_REPOSITORY)
    private readonly profileRepository: PreferenceProfileRepositoryPort,
    @Inject(PREFERENCE_PROPOSAL_REPOSITORY)
    private readonly proposalRepository: PreferenceProposalRepositoryPort,
    private readonly configService: ConfigService,
    private readonly agentRunService: AgentRunService,
  ) {}

  async run({
    ownerSlackUserId,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    if (!this.isEnabled()) {
      this.logger.log(
        'skip — 게이트 OFF (AUTOPILOT_PREFERENCE_LEARNING_ENABLED !== true)',
      );
      return { skip: true };
    }
    const sinceMs = Date.now() - WINDOW_MS;
    // 쿼터 가드 — 이번 주 이미 PENDING 제안 있으면 폭주 방지 skip.
    const pending = await this.proposalRepository.countPendingSince(
      ownerSlackUserId,
      sinceMs,
    );
    if (pending > 0) {
      this.logger.log(
        `skip — 최근 7일 PENDING 제안 ${pending}건 (쿼터 가드). 무응답 만료 카드는 PENDING 으로 남아 다음 회차까지 막을 수 있음`,
      );
      return { skip: true };
    }
    const signals = await this.collector.collect(
      ownerSlackUserId,
      sinceMs,
      SIGNAL_CAP,
    );
    if (signals.length === 0) {
      this.logger.log('skip — 최근 7일 선호 신호 0건');
      return { skip: true };
    }
    const active = await this.profileRepository.findActive(ownerSlackUserId);
    const base = active?.profile ?? EMPTY_PROFILE;
    // 원장 편입 — 이 워커는 모델을 부르면서도 agent_run 을 거치지 않아, 추론이 며칠 죽어도
    // 집계에서 "신호가 없어 조용했다" 와 구분되지 않았다(#259·내부 워커 3종 편입의 남은 자리).
    // 실패 시 동작은 그대로 둔다 — execute 가 FAILED 로 마감한 뒤 다시 던지고, 기존 skip 경로가 받는다.
    let inferred: InferenceResult;
    try {
      const outcome = await this.agentRunService.execute<InferenceResult>({
        agentType: AgentType.PREFERENCE_LEARNING,
        triggerType: TriggerType.AUTOPILOT_PREFERENCE_LEARNING_CRON,
        inputSnapshot: {
          taskId: this.id,
          // 사용자 한정 원장 집계(`/quota` 등)가 inputSnapshot.slackUserId JSON path 로만
          // 필터하므로, 이 키가 없으면 새로 남긴 실행이 그 표면에서 빠진다.
          slackUserId: ownerSlackUserId,
          signalCount: signals.length,
          baseVersion: active?.version ?? 0,
        },
        run: async () => {
          const result = await this.inference.infer(base, signals);
          if (!result) {
            throw new Error(
              `선호 추론 실패 — 모델 호출 또는 파싱 실패 (신호 ${signals.length}건)`,
            );
          }
          // diff 본문은 담지 않는다 — preference_proposal 에 이미 저장되고, 원장에 두면
          // 같은 내용이 중복된다(HUMANIZER 선례). 빈 diff 판정에 필요한 키 목록만 남긴다.
          return {
            result,
            modelUsed: result.modelUsed,
            output: {
              rationale: result.rationale,
              diffKeys: Object.keys(result.diff),
            },
          };
        },
      });
      inferred = outcome.result;
    } catch {
      this.logger.log(
        `skip — 신호 ${signals.length}건 수집했으나 추론 실패 (모델 호출/파싱 실패)`,
      );
      return { skip: true };
    }
    if (this.isEmptyDiff(inferred.diff)) {
      this.logger.log(
        `skip — 신호 ${signals.length}건, 추론 결과 빈 diff: ${inferred.rationale}`,
      );
      return { skip: true };
    }
    const id = await this.proposalRepository.createPending({
      ownerUserId: ownerSlackUserId,
      baseVersion: active?.version ?? 0,
      diff: inferred.diff,
      rationale: inferred.rationale,
    });
    this.logger.log(
      `제안 생성 — preferenceProposal:${id} (신호 ${signals.length}건, baseVersion ${active?.version ?? 0})`,
    );
    return {
      skip: false,
      preview: {
        kind: PREVIEW_KIND.PREFERENCE_PROFILE,
        payload: { proposalId: id },
        previewText: formatPreferenceProposal(
          inferred.diff,
          inferred.rationale,
        ),
      },
    };
  }

  private isEnabled(): boolean {
    return (
      this.configService.get<string>(
        'AUTOPILOT_PREFERENCE_LEARNING_ENABLED',
      ) === 'true'
    );
  }

  private isEmptyDiff(diff: object): boolean {
    return Object.keys(diff).length === 0;
  }
}
