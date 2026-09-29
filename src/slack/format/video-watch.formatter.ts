import { VideoWatchResult } from '../../agent/video-watch/domain/video-watch.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

export interface VideoWatchReportSummary {
  title: string | null;
  videoId: string;
  frameCount: number;
  transcriptSource: string | null;
}

export const formatVideoWatch = (
  result: VideoWatchResult,
  report: VideoWatchReportSummary,
): string => {
  const lines = [
    `🎬 *${escapeSlackMrkdwn(report.title ?? '영상 분석')}*`,
    '',
    escapeSlackMrkdwn(result.answer),
  ];
  for (const highlight of result.highlights) {
    lines.push(
      `• <https://youtu.be/${report.videoId}?t=${highlight.timestampSec}|${formatTimestamp(highlight.timestampSec)}> ${escapeSlackMrkdwn(highlight.note)}`,
    );
  }
  lines.push(
    '',
    `_자막 ${report.transcriptSource ? escapeSlackMrkdwn(report.transcriptSource) : '없음'} · 프레임 ${report.frameCount}장 기준_`,
  );
  if (!report.transcriptSource) {
    lines.push('_자막이 없어 화면만 보고 답했습니다_');
  }
  return lines.join('\n');
};

const formatTimestamp = (timestampSec: number): string => {
  const minutes = Math.floor(timestampSec / 60);
  const seconds = timestampSec % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
