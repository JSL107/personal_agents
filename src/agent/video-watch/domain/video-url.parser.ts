import {
  ExtractedVideo,
  ExtractedVideoRequest,
  VideoPlatform,
} from './video-watch.type';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
]);
const INSTAGRAM_HOSTS = new Set([
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
]);
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const INSTAGRAM_SHORTCODE_PATTERN = /^[A-Za-z0-9_-]{5,64}$/;
const URL_TOKEN_PATTERN = /<?https?:\/\/[^\s<>|]+(?:\|[^>]+)?>?/g;

// 링크 원문 대신 검증된 id 로 정규 URL 을 다시 만든다 — 추적 파라미터(igsh·exln 등)를 버리고,
// /retry-run 이 저장된 id 만으로 같은 URL 을 복원할 수 있게 한다.
export const buildVideoUrl = ({
  platform,
  videoId,
}: {
  platform: VideoPlatform;
  videoId: string;
}): string => {
  if (platform === VideoPlatform.INSTAGRAM) {
    return `https://www.instagram.com/reel/${videoId}/`;
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
};

const parseYoutubeVideoId = (parsedUrl: URL): string | null => {
  if (parsedUrl.hostname === 'youtu.be') {
    return parsedUrl.pathname.split('/').filter(Boolean)[0] ?? null;
  }
  if (parsedUrl.pathname === '/watch') {
    return parsedUrl.searchParams.get('v');
  }
  const match = parsedUrl.pathname.match(/^\/shorts\/([^/]+)\/?$/);
  return match?.[1] ?? null;
};

// /p/·/tv/·/reel(s)/ 와 앞에 계정명이 붙은 공유 링크(/<계정>/reel/<code>/)는 yt-dlp 가 같은
// shortcode 로 받는다(2026-11-03 실측). 그래서 어느 형식이든 /reel/<code>/ 로 정규화한다.
const parseInstagramShortcode = (parsedUrl: URL): string | null => {
  const match = parsedUrl.pathname.match(
    /^(?:\/[^/]+)?\/(?:reels?|p|tv)\/([^/]+)\/?$/,
  );
  return match?.[1] ?? null;
};

const toExtractedVideo = ({
  platform,
  videoId,
  pattern,
}: {
  platform: VideoPlatform;
  videoId: string | null;
  pattern: RegExp;
}): ExtractedVideo | null => {
  if (!videoId || !pattern.test(videoId)) {
    return null;
  }
  const url = buildVideoUrl({ platform, videoId });
  return { platform, videoId, url };
};

const parseVideoToken = (token: string): ExtractedVideo | null => {
  const normalizedToken = token
    .replace(/^</, '')
    .replace(/>$/, '')
    .split('|')[0];
  const parsedUrl = URL.parse(normalizedToken);
  if (!parsedUrl) {
    return null;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(hostname)) {
    return toExtractedVideo({
      platform: VideoPlatform.YOUTUBE,
      videoId: parseYoutubeVideoId(parsedUrl),
      pattern: YOUTUBE_VIDEO_ID_PATTERN,
    });
  }
  if (INSTAGRAM_HOSTS.has(hostname)) {
    return toExtractedVideo({
      platform: VideoPlatform.INSTAGRAM,
      videoId: parseInstagramShortcode(parsedUrl),
      pattern: INSTAGRAM_SHORTCODE_PATTERN,
    });
  }
  return null;
};

// 첫 번째 지원 영상 링크를 고르고, 그 링크 토큰을 뺀 나머지를 질문으로 쓴다.
export const extractVideoRequest = (
  text: string,
): ExtractedVideoRequest | null => {
  const tokens = text.match(URL_TOKEN_PATTERN) ?? [];
  for (const token of tokens) {
    const video = parseVideoToken(token);
    if (video) {
      const question = text.replace(token, '').trim() || '이 영상을 요약해줘';
      return { video, question };
    }
  }
  return null;
};
