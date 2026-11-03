import { ExtractedVideo, VideoPlatform } from './video-watch.type';

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
export const buildVideoUrl = (
  platform: VideoPlatform,
  videoId: string,
): string => {
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

const parseInstagramShortcode = (parsedUrl: URL): string | null => {
  const match = parsedUrl.pathname.match(/^\/reels?\/([^/]+)\/?$/);
  return match?.[1] ?? null;
};

const toExtractedVideo = (
  platform: VideoPlatform,
  videoId: string | null,
  pattern: RegExp,
): ExtractedVideo | null => {
  if (!videoId || !pattern.test(videoId)) {
    return null;
  }
  return { platform, videoId, url: buildVideoUrl(platform, videoId) };
};

const parseVideoToken = (token: string): ExtractedVideo | null => {
  const normalizedToken = token
    .replace(/^</, '')
    .replace(/>$/, '')
    .split('|')[0];
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedToken);
  } catch {
    return null;
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(hostname)) {
    return toExtractedVideo(
      VideoPlatform.YOUTUBE,
      parseYoutubeVideoId(parsedUrl),
      YOUTUBE_VIDEO_ID_PATTERN,
    );
  }
  if (INSTAGRAM_HOSTS.has(hostname)) {
    return toExtractedVideo(
      VideoPlatform.INSTAGRAM,
      parseInstagramShortcode(parsedUrl),
      INSTAGRAM_SHORTCODE_PATTERN,
    );
  }
  return null;
};

export const extractVideo = (text: string): ExtractedVideo | null => {
  const tokens = text.match(URL_TOKEN_PATTERN) ?? [];
  for (const token of tokens) {
    const extracted = parseVideoToken(token);
    if (extracted) {
      return extracted;
    }
  }
  return null;
};

export const extractVideoQuestion = (text: string): string => {
  const tokens = text.match(URL_TOKEN_PATTERN) ?? [];
  for (const token of tokens) {
    if (parseVideoToken(token)) {
      const question = text.replace(token, '').trim();
      return question || '이 영상을 요약해줘';
    }
  }
  return text.trim() || '이 영상을 요약해줘';
};
