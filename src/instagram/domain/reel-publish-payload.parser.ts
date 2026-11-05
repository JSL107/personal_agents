import { isMatching, P } from 'ts-pattern';

import { INSTAGRAM_CAPTION_MAX_CHARS } from './instagram.constants';
import { InstagramException } from './instagram.exception';
import { InstagramErrorCode } from './instagram-error-code.enum';
import { ReelPublishPayload } from './instagram-post.type';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const REEL_PUBLISH_PAYLOAD_PATTERN = {
  reelKey: P.string.regex(/^\d{4}-\d{2}-\d{2}\/(ai|dev|daily)$/),
  field: P.union('ai', 'dev', 'daily'),
  title: P.string,
  videoPath: P.string,
  videoSha256: P.string,
  videoBytes: P.number.finite(),
  caption: P.string.maxLength(INSTAGRAM_CAPTION_MAX_CHARS),
  durationSec: P.number.finite(),
  coverOffsetMs: P.optional(P.number.int().gte(0)),
  segmentFields: P.optional(P.array(P.union('ai', 'dev'))),
  story: P.optional({
    videoPath: P.string,
    videoSha256: P.string.regex(SHA256_PATTERN),
    videoBytes: P.number.int().gt(0),
  }),
};

export const parseReelPublishPayload = (
  payload: unknown,
): ReelPublishPayload => {
  if (!isMatching(REEL_PUBLISH_PAYLOAD_PATTERN, payload)) {
    throw invalidPayload();
  }
  // 표지 지점이 영상 밖이면 Meta 가 어떤 프레임을 쓸지 알 수 없다. 두 필드를 비교해야 해 패턴 밖에서 본다.
  if (
    payload.coverOffsetMs !== undefined &&
    payload.coverOffsetMs >= payload.durationSec * 1000
  ) {
    throw invalidPayload();
  }
  return payload;
};

const invalidPayload = (): InstagramException =>
  new InstagramException({
    code: InstagramErrorCode.INVALID_PAYLOAD,
    message: '릴스 payload가 올바르지 않습니다',
  });
