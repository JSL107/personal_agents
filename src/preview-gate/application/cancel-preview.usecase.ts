import { Inject, Injectable } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import { PreviewActionException } from '../domain/preview-action.exception';
import { PREVIEW_STATUS, PreviewAction } from '../domain/preview-action.type';
import { PreviewActionErrorCode } from '../domain/preview-action-error-code.enum';

// PO-2: 사용자 ❌ cancel 클릭 시점. PENDING 검증 + owner 매칭 후 CANCELLED 전이만 — 실제 부작용 없음.
// 만료된 PENDING 도 그대로 CANCELLED 처리 (이미 죽은 결과 row 라 사용자 의도와 일치).
@Injectable()
export class CancelPreviewUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
  ) {}

  async execute({
    previewId,
    slackUserId,
  }: {
    previewId: string;
    slackUserId: string;
  }): Promise<PreviewAction> {
    const preview = await this.repository.findById(previewId);
    if (!preview) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NOT_FOUND,
        message: `Preview ${previewId} 를 찾을 수 없습니다.`,
        status: DomainStatus.NOT_FOUND,
      });
    }
    if (preview.slackUserId !== slackUserId) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.WRONG_OWNER,
        message: '다른 사용자의 preview 를 apply/cancel 할 수 없습니다.',
        status: DomainStatus.FORBIDDEN,
      });
    }
    if (preview.status !== PREVIEW_STATUS.PENDING) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.ALREADY_RESOLVED,
        message: `Preview 가 이미 ${preview.status} 상태입니다.`,
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }

    return this.repository.transition({
      id: preview.id,
      status: PREVIEW_STATUS.CANCELLED,
    });
  }
}
