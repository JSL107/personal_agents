import { Inject, Injectable } from '@nestjs/common';

import {
  PREVIEW_CANCEL_REASON,
  PreviewCanceller,
  PreviewCancelReason,
} from '../../preview-gate/domain/port/preview-canceller.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import {
  PREFERENCE_PROPOSAL_REPOSITORY,
  PreferenceProposalRepositoryPort,
} from '../domain/port/preference-proposal.repository.port';

// PreviewGate canceller — 선호 프로필 갱신 제안이 승인 없이 닫히면 연결된 proposal 을 종결한다.
//
// ❌ 거부(CANCELLED) → REJECTED. ProposalDecisionSignalSource(recentDecisions = APPROVED/REJECTED)
// 가 이 REJECTED 를 다음 회차 학습 신호로 흡수 → 피드백 루프 완성(spec v1 §5.5).
//
// 무응답 만료(EXPIRED) → EXPIRED. 사용자가 아무 판단도 내리지 않은 것이라 거부로 쓰면 안 된다
// (preview-decision.signal-source.ts:45 와 같은 판단). recentDecisions 가 APPROVED/REJECTED 만
// 읽으므로 EXPIRED 는 학습 신호에서 자동 제외된다. 그럼에도 종결은 해야 한다 — PENDING 으로
// 남으면 preference-learning 의 쿼터 가드(countPendingSince)가 7일간 새 추론을 막는다.
@Injectable()
export class PreferenceProfileCanceller implements PreviewCanceller {
  readonly kind = PREVIEW_KIND.PREFERENCE_PROFILE;

  constructor(
    @Inject(PREFERENCE_PROPOSAL_REPOSITORY)
    private readonly proposalRepository: PreferenceProposalRepositoryPort,
  ) {}

  async onCancel(
    preview: PreviewAction,
    reason: PreviewCancelReason,
  ): Promise<void> {
    const payload = preview.payload as { proposalId?: number };
    if (typeof payload?.proposalId !== 'number') {
      return;
    }
    await this.proposalRepository.markResolved(
      payload.proposalId,
      reason === PREVIEW_CANCEL_REASON.EXPIRED ? 'EXPIRED' : 'REJECTED',
    );
  }
}
