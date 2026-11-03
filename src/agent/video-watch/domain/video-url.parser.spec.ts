import { extractVideoRequest } from './video-url.parser';
import { ExtractedVideo, VideoPlatform } from './video-watch.type';

const extractVideo = (text: string): ExtractedVideo | null =>
  extractVideoRequest(text)?.video ?? null;

describe('extractVideoRequest', () => {
  it('extracts the first valid YouTube URL and removes its token from the question', () => {
    expect(
      extractVideo('설명해줘 <https://youtu.be/jNQXAC9IVRw|영상> 다른 말'),
    ).toEqual({
      platform: VideoPlatform.YOUTUBE,
      videoId: 'jNQXAC9IVRw',
      url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    });
  });

  it.each([
    'https://youtube.com/watch?v=jNQXAC9IVRw',
    'https://www.youtube.com/shorts/jNQXAC9IVRw',
    'https://m.youtube.com/watch?v=jNQXAC9IVRw',
    'https://youtu.be/jNQXAC9IVRw',
  ])('accepts %s', (url) => {
    expect(extractVideo(url)?.videoId).toBe('jNQXAC9IVRw');
  });

  it.each([
    'https://www.instagram.com/reel/DfQb_sJlcc1/?exln=b2J0YmdtMWQzc3Bp',
    '<https://www.instagram.com/reels/DfQb_sJlcc1/|instagram.com/reels/DfQb_sJlcc1>',
    'https://instagram.com/reel/DfQb_sJlcc1',
    'https://m.instagram.com/reel/DfQb_sJlcc1/',
    'https://www.instagram.com/p/DfQb_sJlcc1/?igsh=abc',
    'https://www.instagram.com/tv/DfQb_sJlcc1/',
    'https://www.instagram.com/yoona.code/reel/DfQb_sJlcc1/',
  ])('accepts Instagram video link %s and drops tracking params', (url) => {
    expect(extractVideo(url)).toEqual({
      platform: VideoPlatform.INSTAGRAM,
      videoId: 'DfQb_sJlcc1',
      url: 'https://www.instagram.com/reel/DfQb_sJlcc1/',
    });
  });

  it('rejects deceptive hosts, invalid ids, non-reel paths, and malformed URLs', () => {
    expect(
      extractVideo('https://youtube.com.evil.com/watch?v=jNQXAC9IVRw'),
    ).toBeNull();
    expect(extractVideo('https://youtu.be/-jNQXAC9IVRw')).toBeNull();
    expect(
      extractVideo('https://instagram.com.evil.com/reel/DfQb_sJlcc1/'),
    ).toBeNull();
    expect(extractVideo('https://www.instagram.com/yoona.code/')).toBeNull();
    expect(extractVideo('https://www.instagram.com/reel/a.b/')).toBeNull();
    expect(
      extractVideo('https://www.instagram.com/reels/audio/123456/'),
    ).toBeNull();
    expect(
      extractVideo('https://www.instagram.com/a/b/reel/DfQb_sJlcc1/'),
    ).toBeNull();
    expect(extractVideo('not a URL')).toBeNull();
  });

  it('removes the chosen video URL from the question and supplies a default when empty', () => {
    expect(
      extractVideoRequest('설명해줘 https://youtu.be/jNQXAC9IVRw')?.question,
    ).toBe('설명해줘');
    expect(extractVideoRequest('https://youtu.be/jNQXAC9IVRw')?.question).toBe(
      '이 영상을 요약해줘',
    );
    expect(
      extractVideoRequest(
        'https://www.instagram.com/reel/DfQb_sJlcc1/?exln=x\n영상분석해줘',
      )?.question,
    ).toBe('영상분석해줘');
  });
});
