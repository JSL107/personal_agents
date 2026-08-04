import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PreferenceInferenceAdapter } from '../../../preference-profile/application/preference-inference.adapter';
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
    const inferred = await this.inference.infer(base, signals);
    if (!inferred) {
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
