import { Module } from '@nestjs/common';

import { ModelRouterModule } from '../model-router/model-router.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PreferenceInferenceAdapter } from './application/preference-inference.adapter';
import { PreferenceProfileService } from './application/preference-profile.service';
import { PreferenceProfileApplyService } from './application/preference-profile-apply.service';
import { PreferenceSignalCollector } from './application/preference-signal.collector';
import { PREFERENCE_PROFILE_PORT } from './domain/port/preference-profile.port';
import { PREFERENCE_PROFILE_REPOSITORY } from './domain/port/preference-profile.repository.port';
import { PREFERENCE_PROPOSAL_REPOSITORY } from './domain/port/preference-proposal.repository.port';
import { PREFERENCE_SIGNAL_SOURCES } from './domain/port/preference-signal-source.port';
import { PreferenceProfilePrismaRepository } from './infrastructure/preference-profile.prisma.repository';
import { PreferenceProposalPrismaRepository } from './infrastructure/preference-proposal.prisma.repository';
import { ProposalDecisionSignalSource } from './infrastructure/proposal-decision.signal-source';

// 선호 프로필 자가학습 모듈 — 저장(버전형)+학습(주간 추론)+소비(주입 블록).
@Module({
  imports: [PrismaModule, ModelRouterModule],
  providers: [
    {
      provide: PREFERENCE_PROFILE_REPOSITORY,
      useClass: PreferenceProfilePrismaRepository,
    },
    {
      provide: PREFERENCE_PROPOSAL_REPOSITORY,
      useClass: PreferenceProposalPrismaRepository,
    },
    ProposalDecisionSignalSource,
    {
      provide: PREFERENCE_SIGNAL_SOURCES,
      useFactory: (proposalSource: ProposalDecisionSignalSource) => [
        proposalSource,
      ],
      inject: [ProposalDecisionSignalSource],
    },
    PreferenceSignalCollector,
    PreferenceInferenceAdapter,
    { provide: PREFERENCE_PROFILE_PORT, useClass: PreferenceProfileService },
    PreferenceProfileApplyService,
  ],
  exports: [
    PREFERENCE_PROFILE_PORT,
    PreferenceProfileApplyService,
    PreferenceSignalCollector,
    PreferenceInferenceAdapter,
    PREFERENCE_PROFILE_REPOSITORY,
    PREFERENCE_PROPOSAL_REPOSITORY,
  ],
})
export class PreferenceProfileModule {}
