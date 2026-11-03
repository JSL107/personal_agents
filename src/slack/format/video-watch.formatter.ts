import {
  VideoPlatform,
  VideoWatchResult,
} from '../../agent/video-watch/domain/video-watch.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

export interface VideoWatchReportSummary {
  title: string | null;
  uploader: string | null;
  platform: VideoPlatform;
  videoId: string;
  frameCount: number;
  transcriptSource: string | null;
}

export const formatVideoWatch = (
  result: VideoWatchResult,
  report: VideoWatchReportSummary,
): string => {
  const lines = [
    `🎬 *${escapeSlackMrkdwn(formatHeading(report))}*`,
    '',
    escapeSlackMrkdwn(result.answer),
  ];
  // 본문 마지막 문단(「추론:」 등)에 목록이 붙어 그 일부로 읽히지 않게 소제목으로 나눈다.
  if (result.highlights.length > 0) {
    lines.push('', '*주요 장면*');
  }
  for (const highlight of result.highlights) {
    const timestamp = formatTimestamp(highlight.timestampSec);
    // 인스타그램은 재생 시각으로 바로 가는 링크가 없어 시각만 적는다.
    const anchor =
      report.platform === VideoPlatform.YOUTUBE
        ? `<https://youtu.be/${report.videoId}?t=${highlight.timestampSec}|${timestamp}>`
        : timestamp;
    lines.push(`• ${anchor} ${escapeSlackMrkdwn(highlight.note)}`);
  }
  // 「자막」은 영상에 따로 붙는 자막 텍스트다. 화면 속 글자와 헷갈리지 않게 「음성 자막」이라 쓴다.
  const footer = report.transcriptSource
    ? `_자막 ${escapeSlackMrkdwn(report.transcriptSource)} · 프레임 ${report.frameCount}장 기준_`
    : `_음성 자막 없음 · 화면 ${report.frameCount}장만 보고 답했습니다_`;
  lines.push('', footer);
  return lines.join('\n');
};

// 인스타그램은 영상 제목이 없어 yt-dlp 가 "Video by <계정>" 을 채운다. 정보가 없어 올린 사람 이름을 쓴다.
const formatHeading = (report: VideoWatchReportSummary): string => {
  if (report.platform !== VideoPlatform.INSTAGRAM) {
    return report.title ?? '영상 분석';
  }
  return report.uploader ? `인스타 릴스 · ${report.uploader}` : '인스타 릴스';
};

const formatTimestamp = (timestampSec: number): string => {
  const minutes = Math.floor(timestampSec / 60);
  const seconds = timestampSec % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
