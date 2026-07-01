import { Inject, Injectable } from '@nestjs/common';

import { PreviewCanceller } from '../../preview-gate/domain/port/preview-canceller.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import {
  PREFERENCE_PROPOSAL_REPOSITORY,
  PreferenceProposalRepositoryPort,
} from '../domain/port/preference-proposal.repository.port';

// PreviewGate canceller — 사용자가 선호 프로필 갱신 제안을 ❌ 거부하면 연결된 proposal 을
// REJECTED 로 기록한다. ProposalDecisionSignalSource(recentDecisions = APPROVED/REJECTED)가
// 이 REJECTED 를 다음 회차 학습 신호로 흡수 → 피드백 루프 완성(spec v1 §5.5).
@Injectable()
export class PreferenceProfileCanceller implements PreviewCanceller {
  readonly kind = PREVIEW_KIND.PREFERENCE_PROFILE;

  constructor(
    @Inject(PREFERENCE_PROPOSAL_REPOSITORY)
    private readonly proposalRepository: PreferenceProposalRepositoryPort,
  ) {}

  async onCancel(preview: PreviewAction): Promise<void> {
    const payload = preview.payload as { proposalId?: number };
    if (typeof payload?.proposalId !== 'number') {
      return;
    }
    await this.proposalRepository.markResolved(payload.proposalId, 'REJECTED');
  }
}
