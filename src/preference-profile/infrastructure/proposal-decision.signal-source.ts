import { Inject, Injectable } from '@nestjs/common';

import {
  PREFERENCE_PROPOSAL_REPOSITORY,
  PreferenceProposalRepositoryPort,
} from '../domain/port/preference-proposal.repository.port';
import { PreferenceSignalSource } from '../domain/port/preference-signal-source.port';
import { PreferenceSignal } from '../domain/preference-signal.type';

@Injectable()
export class ProposalDecisionSignalSource implements PreferenceSignalSource {
  readonly name = 'proposal_decision';

  constructor(
    @Inject(PREFERENCE_PROPOSAL_REPOSITORY)
    private readonly proposalRepository: PreferenceProposalRepositoryPort,
  ) {}

  async fetch(ownerUserId: string, sinceMs: number): Promise<PreferenceSignal[]> {
    const decisions = await this.proposalRepository.recentDecisions(
      ownerUserId,
      sinceMs,
    );
    return decisions.map((decision) => ({
      source: 'proposal_decision' as const,
      evidenceRef: `preferenceProposal:${decision.id}`,
      observedText: `[${decision.status}] ${decision.rationale}`,
    }));
  }
}
