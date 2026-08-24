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

// kind 일치 canceller 의 onCancel 을 best-effort 호출. 없으면 no-op(기존 kind 하위호환).
//
// 카드가 승인 없이 닫히는 경로는 셋이고 — ❌ 클릭(CancelPreviewUsecase), 스위퍼 만료
// (ExpirePreviewsUsecase), TTL 지난 뒤 뒤늦은 ✅ 클릭(ApplyPreviewUsecase) — 셋 다 여기를
// 지나야 한다. 한 경로에만 넣으면 나머지 경로로 연동 레코드가 그대로 PENDING 잔류한다.
//
// 훅 실패가 카드 마감을 막지 않도록 예외는 swallow 하고 로그만 남긴다.
export async function runPreviewCanceller({
  cancellers,
  preview,
  reason,
  logger,
}: RunPreviewCancellerInput): Promise<void> {
  const canceller = cancellers.find((found) => found.kind === preview.kind);
  if (!canceller) {
    return;
  }
  try {
    await canceller.onCancel(preview, reason);
  } catch (error) {
    logger.warn(
      `PreviewCanceller(${preview.kind}) onCancel(${reason}) 실패(swallow): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
