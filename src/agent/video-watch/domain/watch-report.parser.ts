import { isAbsolute, relative, resolve, sep } from 'node:path';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { VideoWatchException } from './video-watch.exception';
import { WatchFrame, WatchReport } from './video-watch.type';
import { VideoWatchErrorCode } from './video-watch-error-code.enum';

const FRAME_PATTERN =
  /^- `([^`]+)` \(t=(\d{1,2}:\d{2}(?::\d{2})?)(?:,[^)]*)?\)\s*$/gm;

const parseTimestamp = (timestamp: string): number => {
  const parts = timestamp.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
};

const parseDuration = (markdown: string): number | null => {
  const match = markdown.match(/^- \*\*Duration:\*\* .*?\(([\d.]+)s\)/m);
  return match ? Number(match[1]) : null;
};

const parseFrames = (markdown: string, outDir: string): WatchFrame[] => {
  const frames: WatchFrame[] = [];
  const resolvedOutDir = resolve(outDir);
  let match: RegExpExecArray | null;
  while ((match = FRAME_PATTERN.exec(markdown)) !== null) {
    const sourcePath = match[1];
    const framePath = isAbsolute(sourcePath)
      ? resolve(sourcePath)
      : resolve(resolvedOutDir, sourcePath);
    const pathFromOutDir = relative(resolvedOutDir, framePath);
    const insideOutDir =
      pathFromOutDir !== '' &&
      pathFromOutDir !== '..' &&
      !pathFromOutDir.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromOutDir);
    if (!insideOutDir || !/\.(?:jpe?g|png)$/i.test(framePath)) {
      continue;
    }
    frames.push({ path: framePath, timestampSec: parseTimestamp(match[2]) });
  }
  return frames;
};

export const parseWatchReport = (
  markdown: string,
  outDir: string,
): WatchReport => {
  if (!/^# watch: video report\s*$/m.test(markdown)) {
    throw new VideoWatchException({
      code: VideoWatchErrorCode.INVALID_WATCH_REPORT,
      message: 'INVALID_WATCH_REPORT',
      status: DomainStatus.INTERNAL,
    });
  }

  const titleMatch = markdown.match(/^- \*\*Title:\*\* (.*)$/m);
  const sourceMatch = markdown.match(
    /^- \*\*Transcript:\*\* .*?\(via (.+)\)$/m,
  );
  const transcriptSection = markdown.split(/^## Transcript\s*$/m)[1];
  const transcriptMatch = transcriptSection?.match(
    /```[^\n]*\n([\s\S]*?)\n```/,
  );
  const transcript = transcriptMatch?.[1]?.trim() || null;

  return {
    title: titleMatch?.[1] ?? null,
    durationSec: parseDuration(markdown),
    frames: parseFrames(markdown, outDir),
    transcript,
    transcriptSource: sourceMatch?.[1] ?? null,
  };
};
