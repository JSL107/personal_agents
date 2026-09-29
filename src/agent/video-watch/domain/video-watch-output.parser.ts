import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { VideoWatchException } from './video-watch.exception';
import { VideoWatchResult } from './video-watch.type';
import { VideoWatchErrorCode } from './video-watch-error-code.enum';

export const parseVideoWatchOutput = (
  text: string,
  durationSec: number | null,
): VideoWatchResult => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error: unknown) {
    throw new VideoWatchException({
      code: VideoWatchErrorCode.INVALID_MODEL_OUTPUT,
      message: 'INVALID_MODEL_OUTPUT',
      status: DomainStatus.INTERNAL,
      cause: error,
    });
  }

  if (!value || typeof value !== 'object') {
    throw invalidOutput();
  }
  const record = value as Record<string, unknown>;
  if (typeof record.answer !== 'string' || !Array.isArray(record.highlights)) {
    throw invalidOutput();
  }

  const highlights = record.highlights
    .filter(
      (
        highlight,
      ): highlight is {
        timestampSec: number;
        note: string;
      } => {
        if (!highlight || typeof highlight !== 'object') {
          return false;
        }
        const candidate = highlight as Record<string, unknown>;
        return (
          Number.isInteger(candidate.timestampSec) &&
          Number(candidate.timestampSec) >= 0 &&
          (durationSec === null ||
            Number(candidate.timestampSec) <= durationSec) &&
          typeof candidate.note === 'string'
        );
      },
    )
    .slice(0, 5);

  return { answer: record.answer, highlights };
};

const invalidOutput = (): VideoWatchException => {
  return new VideoWatchException({
    code: VideoWatchErrorCode.INVALID_MODEL_OUTPUT,
    message: 'INVALID_MODEL_OUTPUT',
    status: DomainStatus.INTERNAL,
  });
};
