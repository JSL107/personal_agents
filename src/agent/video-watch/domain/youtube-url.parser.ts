import { ExtractedYoutubeVideo } from './video-watch.type';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
]);
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const URL_TOKEN_PATTERN = /<?https?:\/\/[^\s<>|]+(?:\|[^>]+)?>?/g;

const parseYoutubeVideoToken = (
  token: string,
): ExtractedYoutubeVideo | null => {
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
  if (!YOUTUBE_HOSTS.has(hostname)) {
    return null;
  }

  let videoId: string | null = null;
  if (hostname === 'youtu.be') {
    videoId = parsedUrl.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (parsedUrl.pathname === '/watch') {
    videoId = parsedUrl.searchParams.get('v');
  } else {
    const match = parsedUrl.pathname.match(/^\/shorts\/([^/]+)\/?$/);
    videoId = match?.[1] ?? null;
  }

  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
    return null;
  }
  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
};

export const extractYoutubeVideo = (
  text: string,
): ExtractedYoutubeVideo | null => {
  const tokens = text.match(URL_TOKEN_PATTERN) ?? [];
  for (const token of tokens) {
    const extracted = parseYoutubeVideoToken(token);
    if (extracted) {
      return extracted;
    }
  }
  return null;
};

export const extractYoutubeQuestion = (text: string): string => {
  const tokens = text.match(URL_TOKEN_PATTERN) ?? [];
  for (const token of tokens) {
    if (parseYoutubeVideoToken(token)) {
      const question = text.replace(token, '').trim();
      return question || '이 영상을 요약해줘';
    }
  }
  return text.trim() || '이 영상을 요약해줘';
};
