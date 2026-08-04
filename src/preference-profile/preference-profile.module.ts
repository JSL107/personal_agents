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
import { PreviewDecisionSignalSource } from './infrastructure/preview-decision.signal-source';
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
    PreviewDecisionSignalSource,
    {
      provide: PREFERENCE_SIGNAL_SOURCES,
      // proposalSource 를 먼저 둔다 — collector 가 순서대로 모아 cap 으로 자르므로
      // 선호 카드 직결 신호가 일반 PreviewGate 결정보다 우선 살아남는다.
      useFactory: (
        proposalSource: ProposalDecisionSignalSource,
        previewSource: PreviewDecisionSignalSource,
      ) => [proposalSource, previewSource],
      inject: [ProposalDecisionSignalSource, PreviewDecisionSignalSource],
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
