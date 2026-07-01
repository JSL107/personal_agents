import { PreviewAction, PreviewKind } from '../preview-action.type';

// PreviewCanceller 들을 multi-provider 로 모으기 위한 DI 토큰. NestJS providers 에 array 로 inject.
export const PREVIEW_CANCELLERS = Symbol('PREVIEW_CANCELLERS');

// Strategy — kind 별 ❌ cancel(거부) 후처리. PreviewApplier(승인) 의 대칭.
// 예: PREFERENCE_PROFILE 은 연결된 PreferenceProposal 을 REJECTED 로 기록해 학습 신호로 되먹인다.
// onCancel 은 CANCELLED 전이 "후" best-effort 로 호출된다 — throw 해도 cancel 자체는 성공 처리.
// canceller 미등록 kind 는 no-op (기존 kind 하위호환).
export interface PreviewCanceller {
  readonly kind: PreviewKind;
  onCancel(preview: PreviewAction): Promise<void>;
}
