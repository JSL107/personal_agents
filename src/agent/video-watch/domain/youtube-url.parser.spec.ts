import {
  extractYoutubeQuestion,
  extractYoutubeVideo,
} from './youtube-url.parser';

describe('extractYoutubeVideo', () => {
  it('extracts the first valid YouTube URL and removes its token from the question', () => {
    expect(
      extractYoutubeVideo(
        '설명해줘 <https://youtu.be/jNQXAC9IVRw|영상> 다른 말',
      ),
    ).toEqual({
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
    expect(extractYoutubeVideo(url)?.videoId).toBe('jNQXAC9IVRw');
  });

  it('rejects deceptive hosts, invalid ids, and malformed URLs', () => {
    expect(
      extractYoutubeVideo('https://youtube.com.evil.com/watch?v=jNQXAC9IVRw'),
    ).toBeNull();
    expect(extractYoutubeVideo('https://youtu.be/-jNQXAC9IVRw')).toBeNull();
    expect(extractYoutubeVideo('not a URL')).toBeNull();
  });

  it('removes the video URL from the question and supplies a default when empty', () => {
    expect(
      extractYoutubeQuestion('설명해줘 https://youtu.be/jNQXAC9IVRw'),
    ).toBe('설명해줘');
    expect(extractYoutubeQuestion('https://youtu.be/jNQXAC9IVRw')).toBe(
      '이 영상을 요약해줘',
    );
  });
});
