export enum InstagramPostStatus {
  PENDING = 'PENDING',
  PUBLISHING = 'PUBLISHING',
  PUBLISHED = 'PUBLISHED',
}
// 카드 payload 의 분야. 'ai'·'dev' 는 하루 2편 시절(2026-11-05 이전) 카드를 읽기 위해 남긴다.
export type ReelField = 'ai' | 'dev' | 'daily';
// 원장 행의 분야. 스토리도 같은 원장에 기록한다.
export type InstagramPostField = ReelField | 'story';
export type SegmentField = 'ai' | 'dev';
export interface StoryVideo {
  videoPath: string;
  videoSha256: string;
  videoBytes: number;
}
export interface ReelPublishPayload {
  reelKey: string;
  field: ReelField;
  title: string;
  videoPath: string;
  videoSha256: string;
  videoBytes: number;
  caption: string;
  durationSec: number;
  // 아래는 하루 1편 카드에만 있다. 없는 카드(배포 전 PENDING)도 그대로 승인할 수 있어야 한다.
  coverOffsetMs?: number;
  segmentFields?: SegmentField[];
  story?: StoryVideo;
}
export interface ClaimReelInput {
  reelKey: string;
  field: InstagramPostField;
  title: string;
  videoPath: string;
  videoSha256: string;
  caption: string;
  previewActionId: string;
}
export interface InstagramPost extends ClaimReelInput {
  id: string;
  containerId: string | null;
  containerCreatedAt: Date | null;
  uploadedAt: Date | null;
  publishAttemptedAt: Date | null;
  mediaId: string | null;
  permalink: string | null;
  status: InstagramPostStatus;
  lastError: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface InstagramPostPatch {
  containerId?: string | null;
  containerCreatedAt?: Date | null;
  uploadedAt?: Date | null;
  publishAttemptedAt?: Date | null;
  mediaId?: string | null;
  permalink?: string | null;
  status?: InstagramPostStatus;
  lastError?: string | null;
  publishedAt?: Date | null;
}
