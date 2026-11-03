export interface WatchFrame {
  path: string;
  timestampSec: number;
}

export interface WatchReport {
  title: string | null;
  uploader: string | null;
  durationSec: number | null;
  frames: WatchFrame[];
  transcript: string | null;
  transcriptSource: string | null;
}

export interface VideoWatchHighlight {
  timestampSec: number;
  note: string;
}

export interface VideoWatchResult {
  answer: string;
  highlights: VideoWatchHighlight[];
}

export enum VideoPlatform {
  YOUTUBE = 'YOUTUBE',
  INSTAGRAM = 'INSTAGRAM',
}

export interface ExtractedVideo {
  platform: VideoPlatform;
  // 유튜브는 영상 id, 인스타그램은 릴스 shortcode.
  videoId: string;
  url: string;
}

export interface ExtractedVideoRequest {
  video: ExtractedVideo;
  question: string;
}
