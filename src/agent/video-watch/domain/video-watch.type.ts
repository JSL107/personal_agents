export interface WatchFrame {
  path: string;
  timestampSec: number;
}

export interface WatchReport {
  title: string | null;
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

export interface ExtractedYoutubeVideo {
  videoId: string;
  url: string;
}
