export enum PreviewActionErrorCode {
  NOT_FOUND = 'PREVIEW_NOT_FOUND',
  ALREADY_RESOLVED = 'PREVIEW_ALREADY_RESOLVED',
  EXPIRED = 'PREVIEW_EXPIRED',
  WRONG_OWNER = 'PREVIEW_WRONG_OWNER',
  // PreviewApplier 가 등록 안 된 kind — kind 분기 누락 검증.
  NO_APPLIER_FOR_KIND = 'PREVIEW_NO_APPLIER_FOR_KIND',
  // apply 진행 중 같은 previewId 재진입 — in-memory 락이 거절.
  ALREADY_APPLYING = 'PREVIEW_ALREADY_APPLYING',
}
