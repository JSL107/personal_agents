import { Inject, Injectable } from '@nestjs/common';

import {
  PREFERENCE_PROFILE_REPOSITORY,
  PreferenceProfileRepositoryPort,
} from '../domain/port/preference-profile.repository.port';
import {
  PREFERENCE_PROPOSAL_REPOSITORY,
  PreferenceProposalRepositoryPort,
} from '../domain/port/preference-proposal.repository.port';
import { applyDiff } from '../domain/preference-profile.parser';
import { EMPTY_PROFILE } from '../domain/preference-profile.type';

export type ApplyResult = 'APPLIED' | 'STALE' | 'NOT_FOUND';

@Injectable()
export class PreferenceProfileApplyService {
  constructor(
    @Inject(PREFERENCE_PROFILE_REPOSITORY)
    private readonly profileRepository: PreferenceProfileRepositoryPort,
    @Inject(PREFERENCE_PROPOSAL_REPOSITORY)
    private readonly proposalRepository: PreferenceProposalRepositoryPort,
  ) {}

  async apply(proposalId: number): Promise<ApplyResult> {
    const proposal = await this.proposalRepository.findById(proposalId);
    if (!proposal) {
      return 'NOT_FOUND';
    }
    const active = await this.profileRepository.findActive(
      proposal.ownerUserId,
    );
    const activeVersion = active?.version ?? 0;
    if (activeVersion !== proposal.baseVersion) {
      return 'STALE';
    }
    const base = active?.profile ?? EMPTY_PROFILE;
    const next = applyDiff(base, proposal.diff);
    await this.profileRepository.saveNewVersion(
      proposal.ownerUserId,
      activeVersion + 1,
      next,
    );
    await this.proposalRepository.markResolved(proposalId, 'APPROVED');
    return 'APPLIED';
  }
}
