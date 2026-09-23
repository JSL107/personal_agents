import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import { toConsoleApproval } from '../../console/application/console-mappers';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import {
  PREVIEW_CANCEL_REASON,
  PREVIEW_CANCELLERS,
  PreviewCanceller,
} from '../domain/port/preview-canceller.port';
import {
  PREVIEW_CARD_PORT,
  PreviewCardPort,
} from '../domain/port/preview-card.port';
import { PreviewActionException } from '../domain/preview-action.exception';
import { PREVIEW_STATUS, PreviewAction } from '../domain/preview-action.type';
import { PreviewActionErrorCode } from '../domain/preview-action-error-code.enum';
import { runPreviewCanceller } from './preview-canceller.helper';

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
    @Inject(PREVIEW_CARD_PORT)
    private readonly card: PreviewCardPort,
    // 콘솔 관제 — ConsoleEventBusModule(@Global) 이 production 에 항상 주입. 미주입 시 emit no-op.
    @Optional()
    private readonly consoleEvents?: ConsoleEventBus,
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
    // 반영이 시작된 뒤의 거절은 반영을 되돌리지 못한다. applier 는 외부 부작용을 끝까지
    // 수행하고, 그 뒤 `transition(APPLIED)` 가 id 만 보고 덮어쓴다 — 여기서 CANCELLED 로
    // 바꿔 두면 **거절 후처리(canceller)는 이미 돌았는데 상태만 APPLIED 로 되돌아가** 둘이
    // 어긋난 채 남는다. 같은 자리를 지키는 `UpdatePreviewPayloadUsecase` 가 수정을 막는 것과
    // 같은 이유이고, 거절이 수정보다 파괴적이므로 여기가 비어 있을 이유가 없다.
    //
    // 판정은 원장의 흔적으로 한다 — `ApplyPreviewUsecase.applying` 은 프로세스 메모리라
    // 다른 백엔드가 돌리는 반영도, 부팅 훅이 순차 대기시켜 둔 재개도 보지 못한다.
    if (
      preview.applyProgress !== null &&
      preview.applyProgress.endedAt === undefined
    ) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.ALREADY_APPLYING,
        message:
          '이미 반영이 시작돼 지금은 거절할 수 없습니다. 잠시 후 결과를 확인해주세요.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }

    const cancelled = await this.repository.transition({
      id: preview.id,
      status: PREVIEW_STATUS.CANCELLED,
    });
    // 콘솔 관제 — 승인 종결 알림(카드가 스냅샷/스트림에서 사라지도록).
    this.consoleEvents?.publish({
      type: 'approval.resolved',
      approval: toConsoleApproval(cancelled),
    });
    // 카드를 CANCELLED 로 갱신(버튼 제거). 갱신 실패가 cancel UX 를 막지 않도록 best-effort
    // (runCanceller 와 동일한 결). runCanceller 앞에 둬 사용자에게 먼저 시각적 마감을 보인다.
    try {
      await this.card.update({ preview: cancelled, state: 'CANCELLED' });
    } catch (error: unknown) {
      this.logger.warn(
        `CANCELLED 카드 갱신 실패(무시) preview=${cancelled.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    await runPreviewCanceller({
      cancellers: this.cancellers,
      preview: cancelled,
      reason: PREVIEW_CANCEL_REASON.CANCELLED,
      logger: this.logger,
    });
    return cancelled;
  }
}
