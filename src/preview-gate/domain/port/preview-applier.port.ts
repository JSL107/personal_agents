import { PreviewAction, PreviewKind } from '../preview-action.type';

// PreviewApplier 들을 multi-provider 로 모으기 위한 DI 토큰. NestJS providers 에 array 로 inject.
export const PREVIEW_APPLIERS = Symbol('PREVIEW_APPLIERS');

// Strategy — kind 별 실제 부작용 (Notion/GitHub write 등) 수행.
// PM-2 가 PM_WRITE_BACK applier 를 등록. 추가 kind 는 새 PreviewApplier 구현체로 확장.
export interface PreviewApplier {
  readonly kind: PreviewKind;
  // 사용자 ✅ 클릭 후 호출. preview 객체 전체를 받아 payload 를 strategy 자체 schema 로 narrow.
  // 실패 시 throw — apply usecase 가 그대로 사용자에게 노출. payload validation 도 strategy 책임.
  // 반환 텍스트는 Slack 메시지 응답 (예: "GitHub Issue #34 에 코멘트 추가됨").
  apply(preview: PreviewAction): Promise<string>;
}
