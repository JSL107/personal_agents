import { isMatching, P } from 'ts-pattern';

import { INSTAGRAM_CAPTION_MAX_CHARS } from './instagram.constants';
import { InstagramException } from './instagram.exception';
import { InstagramErrorCode } from './instagram-error-code.enum';
import { ReelPublishPayload } from './instagram-post.type';

const REEL_PUBLISH_PAYLOAD_PATTERN = {
  reelKey: P.string.regex(/^\d{4}-\d{2}-\d{2}\/(ai|dev)$/),
  field: P.union('ai', 'dev'),
  title: P.string,
  videoPath: P.string,
  videoSha256: P.string,
  videoBytes: P.number.finite(),
  caption: P.string.maxLength(INSTAGRAM_CAPTION_MAX_CHARS),
  durationSec: P.number.finite(),
};

export const parseReelPublishPayload = (
  payload: unknown,
): ReelPublishPayload => {
  if (!isMatching(REEL_PUBLISH_PAYLOAD_PATTERN, payload)) {
    throw new InstagramException({
      code: InstagramErrorCode.INVALID_PAYLOAD,
      message: '릴스 payload가 올바르지 않습니다',
    });
  }
  return payload;
};
