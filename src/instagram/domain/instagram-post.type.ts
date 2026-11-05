import { InstagramException } from './instagram.exception';
import { InstagramErrorCode } from './instagram-error-code.enum';

export type InstagramPostStatus = 'PENDING' | 'PUBLISHING' | 'PUBLISHED';
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
  status?: InstagramPostStatus | null;
  lastError?: string | null;
  publishedAt?: Date | null;
}

export const parseReelPublishPayload = (
  payload: unknown,
): ReelPublishPayload => {
  if (typeof payload !== 'object' || payload === null) {
    throw new InstagramException({
      code: InstagramErrorCode.INVALID_PAYLOAD,
      message: '릴스 payload가 올바르지 않습니다',
    });
  }
  const value = payload as Record<string, unknown>;
  if (
    typeof value.reelKey !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}\/(ai|dev)$/.test(value.reelKey) ||
    (value.field !== 'ai' && value.field !== 'dev') ||
    typeof value.title !== 'string' ||
    typeof value.videoPath !== 'string' ||
    typeof value.videoSha256 !== 'string' ||
    typeof value.caption !== 'string' ||
    value.caption.length > 2200 ||
    typeof value.videoBytes !== 'number' ||
    !Number.isFinite(value.videoBytes) ||
    typeof value.durationSec !== 'number' ||
    !Number.isFinite(value.durationSec)
  ) {
    throw new InstagramException({
      code: InstagramErrorCode.INVALID_PAYLOAD,
      message: '릴스 payload가 올바르지 않습니다',
    });
  }
  return value as unknown as ReelPublishPayload;
};
