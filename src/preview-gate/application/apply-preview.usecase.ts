import { Inject, Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { ApplyResult } from '../domain/apply-result.type';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import {
  PREVIEW_APPLIERS,
  PreviewApplier,
} from '../domain/port/preview-applier.port';
import {
  RESULT_VERIFIERS,
  ResultVerifier,
} from '../domain/port/result-verifier.port';
import { PreviewActionException } from '../domain/preview-action.exception';
import { PREVIEW_STATUS, PreviewAction } from '../domain/preview-action.type';
import { PreviewActionErrorCode } from '../domain/preview-action-error-code.enum';

// PO-2: 사용자 ✅ apply 클릭 시점. PENDING 검증 + owner 매칭 + ttl 검증 후 strategy.apply 위임.
// strategy 가 throw 하면 row 는 PENDING 그대로 두고 (재시도 가능) 예외 그대로 전파.
// 성공 시 APPLIED 로 전이 + strategy 결과 메시지 반환.
@Injectable()
export class ApplyPreviewUsecase {
  private readonly logger = new Logger(ApplyPreviewUsecase.name);

  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
    @Inject(PREVIEW_APPLIERS)
    private readonly appliers: PreviewApplier[],
    @Inject(RESULT_VERIFIERS)
    private readonly verifiers: ResultVerifier[],
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

    const applyResult = await applier.apply(preview);
    const transitioned = await this.repository.transition({
      id: preview.id,
      status: PREVIEW_STATUS.APPLIED,
    });
    // apply 성공(APPLIED 전이) 후 외부 부작용이 실제 반영됐는지 재조회 검증해 안내에 합성.
    // 검증은 부가 정보 — verify 가 throw 해도 apply 결과 자체는 그대로 노출 (graceful).
    const resultText = await this.composeResultText(applyResult);
    return { preview: transitioned, resultText };
  }

  // ApplyResult.message + artifacts 검증 결과를 사용자 안내 텍스트로 합성.
  // artifact 가 없으면 message 그대로. verifier 미등록 artifact 는 skip.
  private async composeResultText(applyResult: ApplyResult): Promise<string> {
    if (applyResult.artifacts.length === 0) {
      return applyResult.message;
    }
    const verificationLines: string[] = [];
    for (const artifact of applyResult.artifacts) {
      const verifier = this.verifiers.find((candidate) =>
        candidate.supports(artifact),
      );
      if (!verifier) {
        continue;
      }
      try {
        const outcome = await verifier.verify(artifact);
        if (outcome.verified) {
          verificationLines.push(`✅ ${outcome.detail}`);
        } else if (outcome.unverifiableReason) {
          verificationLines.push(
            `ℹ️ 반영 확인 불가 — ${outcome.detail} (${outcome.unverifiableReason})`,
          );
        } else {
          verificationLines.push(
            `⚠️ 반영 확인 실패 — ${outcome.detail}. 수동 확인을 권장합니다.`,
          );
        }
      } catch (error: unknown) {
        // verify 자체 실패는 apply 결과를 막지 않는다 — 안내만 "확인 불가" 로.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`ResultVerifier verify 실패 (graceful): ${message}`);
        verificationLines.push(
          `ℹ️ 반영 확인 불가 — 검증 중 오류가 발생했습니다.`,
        );
      }
    }
    if (verificationLines.length === 0) {
      return applyResult.message;
    }
    return `${applyResult.message}\n\n${verificationLines.join('\n')}`;
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
