import { PreviewAction } from '../preview-action.type';

export const PREVIEW_CARD_PORT = Symbol('PREVIEW_CARD_PORT');

// 카드가 표현할 종결 상태. APPLYING 은 apply 진행 중, 나머지는 최종 상태.
// APPLY_FAILED 만 버튼을 되살린다(DB 는 PENDING 유지 → 재시도 허용).
export type PreviewCardState =
  | 'APPLYING'
  | 'APPLIED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'APPLY_FAILED';

// A 경로(chat.postMessage) 카드를 상태에 맞춰 chat.update 로 다시 그린다.
// 좌표(slackChannelId/slackMessageTs) 없거나 토큰 미설정이면 구현체가 조용히 no-op.
// 갱신 실패는 swallow — apply/cancel 결과를 막지 않는다(best-effort).
export interface PreviewCardPort {
  update(input: {
    preview: PreviewAction;
    state: PreviewCardState;
    // APPLIED 등에서 카드 본문에 덧붙일 결과 텍스트. 없으면 preview.previewText 만.
    resultText?: string;
  }): Promise<void>;
}
