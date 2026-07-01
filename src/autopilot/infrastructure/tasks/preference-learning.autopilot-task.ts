import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PreferenceInferenceAdapter } from '../../../preference-profile/application/preference-inference.adapter';
import { PreferenceSignalCollector } from '../../../preference-profile/application/preference-signal.collector';
import { EMPTY_PROFILE } from '../../../preference-profile/domain/preference-profile.type';
import {
  PREFERENCE_PROFILE_REPOSITORY,
  PreferenceProfileRepositoryPort,
} from '../../../preference-profile/domain/port/preference-profile.repository.port';
import {
  PREFERENCE_PROPOSAL_REPOSITORY,
  PreferenceProposalRepositoryPort,
} from '../../../preference-profile/domain/port/preference-proposal.repository.port';
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
      return { skip: true };
    }
    const sinceMs = Date.now() - WINDOW_MS;
    // 쿼터 가드 — 이번 주 이미 PENDING 제안 있으면 폭주 방지 skip.
    const pending = await this.proposalRepository.countPendingSince(
      ownerSlackUserId,
      sinceMs,
    );
    if (pending > 0) {
      return { skip: true };
    }
    const signals = await this.collector.collect(
      ownerSlackUserId,
      sinceMs,
      SIGNAL_CAP,
    );
    if (signals.length === 0) {
      return { skip: true };
    }
    const active = await this.profileRepository.findActive(ownerSlackUserId);
    const base = active?.profile ?? EMPTY_PROFILE;
    const inferred = await this.inference.infer(base, signals);
    if (!inferred || this.isEmptyDiff(inferred.diff)) {
      return { skip: true };
    }
    const id = await this.proposalRepository.createPending({
      ownerUserId: ownerSlackUserId,
      baseVersion: active?.version ?? 0,
      diff: inferred.diff,
      rationale: inferred.rationale,
    });
    return {
      skip: false,
      preview: {
        kind: PREVIEW_KIND.PREFERENCE_PROFILE,
        payload: { proposalId: id },
        previewText: formatPreferenceProposal(inferred.diff, inferred.rationale),
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
