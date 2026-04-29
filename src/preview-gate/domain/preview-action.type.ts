// PO-2 Preview Gate — 외부 부작용 명령 (Notion/GitHub write 등) 이 사용자 confirm 후에만 실행되도록 한다.
// kind 는 preview 의 의미 종류 — PreviewApplier strategy 가 같은 kind 를 implement 해 실제 부작용을 수행한다.
export const PREVIEW_KIND = {
  // PM-2: PM Agent 가 만든 DailyPlan 의 task subtasks 를 GitHub Issue 코멘트 / Notion page 로 write-back.
  PM_WRITE_BACK: 'PM_WRITE_BACK',
} as const;

export type PreviewKind = (typeof PREVIEW_KIND)[keyof typeof PREVIEW_KIND];

export const PREVIEW_STATUS = {
  PENDING: 'PENDING',
  APPLIED: 'APPLIED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;

export type PreviewStatus =
  (typeof PREVIEW_STATUS)[keyof typeof PREVIEW_STATUS];

// repository / usecase 가 도메인 객체로 다룰 단위. payload 는 kind 별 자유 JSON.
export interface PreviewAction {
  id: string;
  slackUserId: string;
  kind: PreviewKind;
  payload: unknown;
  status: PreviewStatus;
  previewText: string;
  responseUrl: string | null;
  expiresAt: Date;
  createdAt: Date;
  appliedAt: Date | null;
  cancelledAt: Date | null;
}

// 새 preview 생성 시 호출자가 채워 넘기는 데이터. id / status / createdAt / appliedAt / cancelledAt 은 시스템이 채움.
export interface CreatePreviewInput {
  slackUserId: string;
  kind: PreviewKind;
  payload: unknown;
  previewText: string;
  responseUrl: string | null;
  // ttl 초과시 사용자가 ✅ 눌러도 EXPIRED 로 거절. default 1h 권고.
  ttlMs: number;
}

// Slack Bolt block_actions 의 action_id 명세 — Block Kit 의 button 마다 이 값 노출.
export const PREVIEW_ACTION_IDS = {
  APPLY: 'preview:apply',
  CANCEL: 'preview:cancel',
} as const;
