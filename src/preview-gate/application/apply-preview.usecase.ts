import { Inject, Injectable } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import {
  PREVIEW_APPLIERS,
  PreviewApplier,
} from '../domain/port/preview-applier.port';
import { PreviewActionException } from '../domain/preview-action.exception';
import { PREVIEW_STATUS, PreviewAction } from '../domain/preview-action.type';
import { PreviewActionErrorCode } from '../domain/preview-action-error-code.enum';

// PO-2: 사용자 ✅ apply 클릭 시점. PENDING 검증 + owner 매칭 + ttl 검증 후 strategy.apply 위임.
// strategy 가 throw 하면 row 는 PENDING 그대로 두고 (재시도 가능) 예외 그대로 전파.
// 성공 시 APPLIED 로 전이 + strategy 결과 메시지 반환.
@Injectable()
export class ApplyPreviewUsecase {
  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
    @Inject(PREVIEW_APPLIERS)
    private readonly appliers: PreviewApplier[],
  ) {}

  async execute({
    previewId,
    slackUserId,
    now = new Date(),
  }: {
    previewId: string;
    slackUserId: string;
    now?: Date;
  }): Promise<{ preview: PreviewAction; resultText: string }> {
    const preview = await this.assertReadyToResolve({
      previewId,
      slackUserId,
      now,
    });
    const applier = this.appliers.find((a) => a.kind === preview.kind);
    if (!applier) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: `Preview kind '${preview.kind}' 에 대한 PreviewApplier 가 등록되지 않았습니다.`,
        status: DomainStatus.INTERNAL,
      });
    }

    const resultText = await applier.apply(preview);
    const transitioned = await this.repository.transition({
      id: preview.id,
      status: PREVIEW_STATUS.APPLIED,
    });
    return { preview: transitioned, resultText };
  }

  // PENDING / 소유자 / 만료 검증을 한 곳에 모음. cancel usecase 와 공유 가능하도록 protected 가 아니라 private 으로 inline.
  private async assertReadyToResolve({
    previewId,
    slackUserId,
    now,
  }: {
    previewId: string;
    slackUserId: string;
    now: Date;
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
    if (preview.expiresAt.getTime() <= now.getTime()) {
      // 만료된 preview — 자동으로 EXPIRED 전이 후 거절 (DB 정리는 호출자 별도 책임).
      await this.repository.transition({
        id: preview.id,
        status: PREVIEW_STATUS.EXPIRED,
      });
      throw new PreviewActionException({
        code: PreviewActionErrorCode.EXPIRED,
        message: 'Preview 가 만료되었습니다 (TTL 초과). 새로 요청해주세요.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    return preview;
  }
}
