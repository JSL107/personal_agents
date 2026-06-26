import { Module, forwardRef } from '@nestjs/common';

import { RouterModule } from '../router/router.module';
import { SlackModule } from '../slack/slack.module';
import { SubconsciousProposalService } from './application/subconscious-proposal.service';
import { PROPOSAL_EMITTER } from './domain/port/proposal-emitter.port';
import { SUBCONSCIOUS_PROPOSAL_REPOSITORY } from './domain/port/subconscious-proposal.repository.port';
import { SubconsciousProposalPrismaRepository } from './infrastructure/subconscious-proposal.prisma.repository';

// SubconsciousModule — Task 7 (Proposal 라이프사이클).
// SubconsciousProposalService 를 export 해 SlackModule 의 SubconsciousProposalActionHandler 가 주입받는다.
// PROPOSAL_EMITTER 토큰도 export — SubconsciousEngine 이 ProposalEmitter 로 주입받을 때 사용.
// forwardRef(SlackModule) — SlackModule 이 SubconsciousModule 을 import 하므로 순환 참조 해소.
@Module({
  imports: [
    // IDAERI_ROUTER_PORT (IdaeriRouterUsecase) — proposal apply 시 worker dispatch.
    RouterModule,
    // SlackService (postProposalMessage) — DM 버튼 메시지 발송.
    // forwardRef: SlackModule → SubconsciousModule → SlackModule 순환 방지.
    forwardRef(() => SlackModule),
  ],
  providers: [
    {
      provide: SUBCONSCIOUS_PROPOSAL_REPOSITORY,
      useClass: SubconsciousProposalPrismaRepository,
    },
    SubconsciousProposalService,
    {
      provide: PROPOSAL_EMITTER,
      useExisting: SubconsciousProposalService,
    },
  ],
  exports: [SubconsciousProposalService, PROPOSAL_EMITTER],
})
export class SubconsciousModule {}
