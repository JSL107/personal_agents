export enum InstagramPostStatus {
  PENDING = 'PENDING',
  PUBLISHING = 'PUBLISHING',
  PUBLISHED = 'PUBLISHED',
}
export type ReelField = 'ai' | 'dev';
export interface ReelPublishPayload {
  reelKey: string;
  field: ReelField;
  title: string;
  videoPath: string;
  videoSha256: string;
  videoBytes: number;
  caption: string;
  durationSec: number;
}
export interface ClaimReelInput {
  reelKey: string;
  field: ReelField;
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
