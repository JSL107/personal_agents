import { PreviewAction, PreviewKind } from '../preview-action.type';

// PreviewCanceller 들을 multi-provider 로 모으기 위한 DI 토큰. NestJS providers 에 array 로 inject.
export const PREVIEW_CANCELLERS = Symbol('PREVIEW_CANCELLERS');

// 카드가 승인 없이 닫힌 사유. 둘을 뭉개면 안 되는 이유는 학습 신호다 — 무응답 만료를 거부로
// 기록하면 사용자가 보지도 않은 제안을 "물렸다" 로 배운다(preview-decision.signal-source.ts:45
// 가 EXPIRED 를 신호에서 제외하는 것과 같은 판단).
export const PREVIEW_CANCEL_REASON = {
  // 사용자가 ❌ 를 눌렀다 — 명시적 거부.
  CANCELLED: 'CANCELLED',
  // TTL 이 지나도록 아무도 누르지 않았다 — 판단 없음.
  EXPIRED: 'EXPIRED',
} as const;

export type PreviewCancelReason =
  (typeof PREVIEW_CANCEL_REASON)[keyof typeof PREVIEW_CANCEL_REASON];

// Strategy — kind 별 "승인 없이 닫힘" 후처리. PreviewApplier(승인) 의 대칭.
// 예: PREFERENCE_PROFILE 은 연결된 PreferenceProposal 을 종결 상태로 기록한다 — 거부는
// REJECTED(학습 신호로 되먹임), 만료는 EXPIRED(신호는 아니지만 PENDING 잔류는 풀어준다).
// onCancel 은 CANCELLED / EXPIRED 전이 "후" best-effort 로 호출된다 — throw 해도 전이 자체는 성공.
// canceller 미등록 kind 는 no-op (기존 kind 하위호환).
export interface PreviewCanceller {
  readonly kind: PreviewKind;
  onCancel(preview: PreviewAction, reason: PreviewCancelReason): Promise<void>;
}
