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
        // 목록을 뽑은 시점과 여기 사이에 사용자가 ✅/❌ 를 누를 수 있다. id 만 보고 덮어쓰면
        // 방금 APPLIED 가 된 row 를 EXPIRED 로 되돌리고, 아래 만료 후처리까지 돌아 이미
        // APPROVED 로 기록된 연동 레코드를 EXPIRED 로 오염시킨다. 전이를 획득한 회차만 진행한다.
        const expired = await this.repository.transitionIfStatus({
          id: preview.id,
          from: PREVIEW_STATUS.PENDING,
          to: PREVIEW_STATUS.EXPIRED,
        });
        if (expired === null) {
          continue;
        }
        // 도메인 후처리를 카드보다 **먼저** 한다. 실패하면 아래에서 PENDING 으로 되돌리는데,
        // 카드를 이미 EXPIRED 로 바꿔 놓았으면 되살아난 카드가 버튼 없는 채로 남는다.
        const cancelled = await runPreviewCanceller({
          cancellers: this.cancellers,
          preview: expired,
          reason: PREVIEW_CANCEL_REASON.EXPIRED,
          logger: this.logger,
        });
        if (!cancelled) {
          // 전이를 되돌려 재시도 거리를 남긴다 — 삼키고 넘어가면 이 row 는 EXPIRED 라
          // findExpiredPending(PENDING) 에 영영 안 걸리고, 연동 레코드가 PENDING 으로
          // 잔류해 이 변경이 없애려던 쿼터 차단이 실패한 그 건에서 그대로 재발한다.
          // 되돌리기도 조건부다 — 그 사이 사용자가 눌렀다면 그 결말을 존중한다.
          await this.repository.transitionIfStatus({
            id: expired.id,
            from: PREVIEW_STATUS.EXPIRED,
            to: PREVIEW_STATUS.PENDING,
          });
          this.logger.warn(
            `만료 후처리 실패로 PENDING 복원 preview=${expired.id} — 다음 스윕에서 재시도`,
          );
          continue;
        }
        // 콘솔 관제 — 승인 종결 알림(만료된 카드가 스냅샷/스트림에서 사라지도록).
        this.consoleEvents?.publish({
          type: 'approval.resolved',
          approval: toConsoleApproval(expired),
        });
        // 카드 갱신은 best-effort — Slack 이 흔들려도 만료와 후처리는 이미 끝났다. 여기서
        // throw 를 내보내면 성공한 회차가 실패로 집계된다.
        try {
          await this.card.update({ preview: expired, state: 'EXPIRED' });
        } catch (error: unknown) {
          this.logger.warn(
            `EXPIRED 카드 갱신 실패(무시) preview=${expired.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
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
