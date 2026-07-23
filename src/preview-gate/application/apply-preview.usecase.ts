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
  PREVIEW_CARD_PORT,
  PreviewCardPort,
  PreviewCardState,
} from '../domain/port/preview-card.port';
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
  // apply 진행 중인 previewId — 2분 창(codex+humanize+Notion) 동안의 중복 클릭 발행을 막는다.
  private readonly applying = new Set<string>();

  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
    @Inject(PREVIEW_APPLIERS)
    private readonly appliers: PreviewApplier[],
    @Inject(RESULT_VERIFIERS)
    private readonly verifiers: ResultVerifier[],
    @Inject(PREVIEW_CARD_PORT)
    private readonly card: PreviewCardPort,
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
    if (this.applying.has(previewId)) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.ALREADY_APPLYING,
        message: 'Preview 가 이미 처리 중입니다. 잠시만 기다려주세요.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    // 락은 검증(assertReadyToResolve) 전에 동기적으로 잡는다. async 검증 뒤에 add 하면 첫 클릭이
    // await 에서 suspend 된 사이 두 번째 클릭이 락 체크를 통과해버리는 레이스가 생긴다.
    this.applying.add(previewId);
    try {
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
      // 여기부터 실제 apply 단계 — 실패 시에만 APPLY_FAILED 로 카드 복구(버튼 되살림).
      // 검증 단계 실패(만료/미존재/owner/applier 없음)는 이 안쪽 catch 를 타지 않는다.
      try {
        await this.safeUpdateCard({ preview, state: 'APPLYING' });
        const applyResult = await applier.apply(preview);
        const transitioned = await this.repository.transition({
          id: preview.id,
          status: PREVIEW_STATUS.APPLIED,
        });
        // apply 성공(APPLIED 전이) 후 외부 부작용이 실제 반영됐는지 재조회 검증해 안내에 합성.
        // 검증은 부가 정보 — verify 가 throw 해도 apply 결과 자체는 그대로 노출 (graceful).
        const resultText = await this.composeResultText(applyResult);
        await this.safeUpdateCard({
          preview: transitioned,
          state: 'APPLIED',
          resultText,
        });
        return { preview: transitioned, resultText };
      } catch (applyError: unknown) {
        // applier / transition 실패 — DB 는 PENDING 유지(재시도 가능). 카드는 버튼을 되살린다.
        await this.safeUpdateCard({ preview, state: 'APPLY_FAILED' });
        throw applyError;
      }
    } finally {
      this.applying.delete(previewId);
    }
  }

  // 카드 갱신은 best-effort — 실패해도 apply 결과를 막지 않는다.
  // updater 구현도 자체 swallow 하지만, port 계약(Promise<void>)이 reject 를 배제하지 못하므로
  // usecase 레벨에서 한 번 더 방어한다.
  private async safeUpdateCard(input: {
    preview: PreviewAction;
    state: PreviewCardState;
    resultText?: string;
  }): Promise<void> {
    try {
      await this.card.update(input);
    } catch (error: unknown) {
      this.logger.warn(
        `Preview 카드 갱신 실패(무시) preview=${input.preview.id} state=${input.state}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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
      const expired = await this.repository.transition({
        id: preview.id,
        status: PREVIEW_STATUS.EXPIRED,
      });
      // 스위퍼가 아직 안 훑은 카드를 사용자가 먼저 눌렀을 때, 거절과 동시에 버튼 제거.
      await this.safeUpdateCard({ preview: expired, state: 'EXPIRED' });
      throw new PreviewActionException({
        code: PreviewActionErrorCode.EXPIRED,
        message: 'Preview 가 만료되었습니다 (TTL 초과). 새로 요청해주세요.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }
    return preview;
  }
}
