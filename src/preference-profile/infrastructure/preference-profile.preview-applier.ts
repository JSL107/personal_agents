import { Injectable } from '@nestjs/common';

import { ApplyResult } from '../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { PreferenceProfileApplyService } from '../application/preference-profile-apply.service';

// PreviewGate applier — 사용자가 선호 프로필 갱신 제안을 ✅ 승인하면 diff 를 적용(새 버전).
@Injectable()
export class PreferenceProfilePreviewApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.PREFERENCE_PROFILE;

  constructor(private readonly applyService: PreferenceProfileApplyService) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = preview.payload as { proposalId?: number };
    if (typeof payload?.proposalId !== 'number') {
      throw new Error(
        'PreferenceProfile preview payload 에 proposalId 가 없습니다.',
      );
    }
    const result = await this.applyService.apply(payload.proposalId);
    const message =
      result === 'APPLIED'
        ? '✅ 선호 프로필에 반영했습니다.'
        : result === 'STALE'
          ? '⚠️ 그새 프로필이 바뀌어 이 제안은 무효(STALE)입니다. 다음 주 재제안됩니다.'
          : '⚠️ 제안을 찾을 수 없습니다.';
    return { message, artifacts: [] };
  }
}
