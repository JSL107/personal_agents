import { Logger } from '@nestjs/common';

import {
  PreviewCanceller,
  PreviewCancelReason,
} from '../domain/port/preview-canceller.port';
import { PreviewAction } from '../domain/preview-action.type';

interface RunPreviewCancellerInput {
  cancellers: PreviewCanceller[];
  preview: PreviewAction;
  reason: PreviewCancelReason;
  logger: Logger;
}

// kind 일치 canceller 의 onCancel 을 호출. 없으면 no-op(기존 kind 하위호환) — 이때도 true 다.
//
// 카드가 승인 없이 닫히는 경로는 셋이고 — ❌ 클릭(CancelPreviewUsecase), 스위퍼 만료
// (ExpirePreviewsUsecase), TTL 지난 뒤 뒤늦은 ✅ 클릭(ApplyPreviewUsecase) — 셋 다 여기를
// 지나야 한다. 한 경로에만 넣으면 나머지 경로로 연동 레코드가 그대로 PENDING 잔류한다.
//
// 예외는 여기서 삼키되 **성공 여부는 돌려준다.** 삼키기만 하고 알리지 않으면 호출자가
// 재시도할 거리를 남길 수 없다 — 만료 경로는 이미 EXPIRED 로 전이한 뒤라 다음 스윕의
// `findExpiredPending`(PENDING 만 조회)에 다시 걸리지 않고, 그러면 이 변경이 없애려던
// PENDING 잔류가 실패한 그 건에서 그대로 재발한다.
export async function runPreviewCanceller({
  cancellers,
  preview,
  reason,
  logger,
}: RunPreviewCancellerInput): Promise<boolean> {
  const canceller = cancellers.find((found) => found.kind === preview.kind);
  if (!canceller) {
    return true;
  }
  try {
    await canceller.onCancel(preview, reason);
    return true;
  } catch (error) {
    logger.warn(
      `PreviewCanceller(${preview.kind}) onCancel(${reason}) 실패: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}
