import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { ConsoleEventBus } from '../../console/application/console-event-bus.service';
import { toConsoleApproval } from '../../console/application/console-mappers';
import {
  PREVIEW_ACTION_REPOSITORY_PORT,
  PreviewActionRepositoryPort,
} from '../domain/port/preview-action.repository.port';
import {
  PREVIEW_CARD_PORT,
  PreviewCardPort,
} from '../domain/port/preview-card.port';
import { PREVIEW_STATUS } from '../domain/preview-action.type';

// 만료됐지만 PENDING 인 카드를 EXPIRED 로 전이 + 카드에서 버튼 제거.
// preview-sweeper autopilot task 가 매시간 호출한다. 클릭 경로가 아직 안 훑은 카드를 정리.
const DEFAULT_LIMIT = 100;

@Injectable()
export class ExpirePreviewsUsecase {
  private readonly logger = new Logger(ExpirePreviewsUsecase.name);

  constructor(
    @Inject(PREVIEW_ACTION_REPOSITORY_PORT)
    private readonly repository: PreviewActionRepositoryPort,
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
        await this.card.update({ preview: expired, state: 'EXPIRED' });
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
