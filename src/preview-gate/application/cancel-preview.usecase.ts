import { Inject, Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import {
  PREVIEW_CANCELLERS,
  PreviewCanceller,
} from '../domain/port/preview-canceller.port';
import { PreviewActionException } from '../domain/preview-action.exception';
import { PREVIEW_STATUS, PreviewAction } from '../domain/preview-action.type';
import { PreviewActionErrorCode } from '../domain/preview-action-error-code.enum';

// PO-2: 사용자 ❌ cancel 클릭 시점. PENDING 검증 + owner 매칭 후 CANCELLED 전이.
// 만료된 PENDING 도 그대로 CANCELLED 처리 (이미 죽은 결과 row 라 사용자 의도와 일치).
// 전이 후 kind 별 PreviewCanceller.onCancel 을 best-effort 로 호출 — 거부의 도메인 후처리
// (예: PREFERENCE_PROFILE 은 연결된 proposal 을 REJECTED 로 기록해 학습 신호로 되먹임).
@Injectable()
export class CancelPreviewUsecase {
  private readonly logger = new Logger(CancelPreviewUsecase.name);

  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
    @Inject(PREVIEW_CANCELLERS)
    private readonly cancellers: PreviewCanceller[],
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

    const cancelled = await this.repository.transition({
      id: preview.id,
      status: PREVIEW_STATUS.CANCELLED,
    });
    await this.runCanceller(cancelled);
    return cancelled;
  }

  // kind 일치 canceller 의 onCancel 을 best-effort 호출. 없으면 no-op(기존 kind 하위호환).
  // 훅 실패가 사용자 cancel UX 를 막지 않도록 예외는 swallow 하고 로그만 남긴다.
  private async runCanceller(preview: PreviewAction): Promise<void> {
    const canceller = this.cancellers.find((c) => c.kind === preview.kind);
    if (!canceller) {
      return;
    }
    try {
      await canceller.onCancel(preview);
    } catch (error) {
      this.logger.warn(
        `PreviewCanceller(${preview.kind}) onCancel 실패(swallow): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
