import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

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
import { PREVIEW_STATUS } from '../domain/preview-action.type';
import { runPreviewCanceller } from './preview-canceller.helper';

// 만료됐지만 PENDING 인 카드를 EXPIRED 로 전이 + 카드에서 버튼 제거.
// preview-sweeper autopilot task 가 매시간 호출한다. 클릭 경로가 아직 안 훑은 카드를 정리.
const DEFAULT_LIMIT = 100;

@Injectable()
export class ExpirePreviewsUsecase {
  private readonly logger = new Logger(ExpirePreviewsUsecase.name);

  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
    // 무응답 만료도 kind 별 후처리를 받아야 한다 — 없으면 연동 레코드가 PENDING 으로 영구 잔류.
    @Inject(PREVIEW_CANCELLERS)
    private readonly cancellers: PreviewCanceller[],
    @Inject(PREVIEW_CARD_PORT)
    private readonly card: PreviewCardPort,
    // 콘솔 관제 — ConsoleEventBusModule(@Global) 이 production 에 항상 주입. 미주입 시 emit no-op.
    @Optional()
    private readonly consoleEvents?: ConsoleEventBus,
  ) {}

  // 정리한 건수를 반환. 한 건 실패가 나머지를 막지 않도록 개별 try/catch.
  async execute({
    now,
    limit = DEFAULT_LIMIT,
  }: {
    now: Date;
    limit?: number;
  }): Promise<number> {
    const expiredPreviews = await this.repository.findExpiredPending({
      now,
      limit,
    });
    let sweptCount = 0;
    for (const preview of expiredPreviews) {
      try {
        const expired = await this.repository.transition({
          id: preview.id,
          status: PREVIEW_STATUS.EXPIRED,
        });
        // 콘솔 관제 — 승인 종결 알림(만료된 카드가 스냅샷/스트림에서 사라지도록).
        this.consoleEvents?.publish({
          type: 'approval.resolved',
          approval: toConsoleApproval(expired),
        });
        // 카드 갱신은 best-effort — 여기서 throw 를 밖으로 내보내면 아래 canceller 가
        // 건너뛰어진다. row 는 이미 EXPIRED 라 다음 스윕의 findExpiredPending(PENDING) 에
        // 다시 잡히지 않으므로, Slack 이 한 번 흔들린 카드는 후처리를 영영 못 받는다.
        // (CancelPreviewUsecase 가 카드 갱신을 감싸는 것과 같은 결.)
        try {
          await this.card.update({ preview: expired, state: 'EXPIRED' });
        } catch (error: unknown) {
          this.logger.warn(
            `EXPIRED 카드 갱신 실패(무시) preview=${expired.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        // 카드 마감 뒤 도메인 후처리. 훅이 throw 해도 만료 자체는 성공으로 집계한다
        // (helper 가 swallow) — 훅 실패로 카드가 PENDING 으로 되돌아가면 다음 스윕이
        // 같은 카드를 다시 잡아 훅을 반복 호출한다.
        await runPreviewCanceller({
          cancellers: this.cancellers,
          preview: expired,
          reason: PREVIEW_CANCEL_REASON.EXPIRED,
          logger: this.logger,
        });
        sweptCount += 1;
      } catch (error: unknown) {
        this.logger.warn(
          `Preview ${preview.id} 만료 처리 실패(계속): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return sweptCount;
  }
}
