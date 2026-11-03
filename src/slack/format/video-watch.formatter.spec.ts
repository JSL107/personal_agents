import { VideoPlatform } from '../../agent/video-watch/domain/video-watch.type';
import { formatVideoWatch } from './video-watch.formatter';

describe('formatVideoWatch', () => {
  it('formats linked highlights and the transcript/frame footer', () => {
    const text = formatVideoWatch(
      {
        answer: '핵심 *답변*',
        highlights: [{ timestampSec: 65, note: '전환 <장면>' }],
      },
      {
        title: '제목 *',
        uploader: '채널',
        platform: VideoPlatform.YOUTUBE,
        videoId: 'jNQXAC9IVRw',
        frameCount: 2,
        transcriptSource: 'captions',
      },
    );
    expect(text).toContain(
      '• <https://youtu.be/jNQXAC9IVRw?t=65|01:05> 전환 &lt;장면&gt;',
    );
    expect(text).toContain('_자막 captions · 프레임 2장 기준_');
  });

  it('자막 텍스트가 없으면 꼬리말 한 줄로 화면만 봤다고 알린다', () => {
    const text = formatVideoWatch(
      { answer: '답', highlights: [] },
      {
        title: null,
        uploader: null,
        platform: VideoPlatform.YOUTUBE,
        videoId: 'jNQXAC9IVRw',
        frameCount: 3,
        transcriptSource: null,
      },
    );
    expect(text.split('\n').at(-1)).toBe(
      '_음성 자막 없음 · 화면 3장만 보고 답했습니다_',
    );
    expect(text).toContain('🎬 *영상 분석*');
  });

  it('인스타그램은 제목 대신 올린 사람을 쓰고, 재생 시각 링크 없이 시각만 적는다', () => {
    const text = formatVideoWatch(
      { answer: '답', highlights: [{ timestampSec: 65, note: '장면' }] },
      {
        title: 'Video by yoona.code',
        uploader: '우니코드',
        platform: VideoPlatform.INSTAGRAM,
        videoId: 'DfQb_sJlcc1',
        frameCount: 24,
        transcriptSource: null,
      },
    );
    expect(text).toContain('🎬 *인스타 릴스 · 우니코드*');
    expect(text).not.toContain('Video by');
    expect(text).toContain('• 01:05 장면');
    expect(text).not.toContain('youtu.be');
  });

  it('인스타그램 올린 사람 이름의 Slack 특수문자를 이스케이프한다', () => {
    const text = formatVideoWatch(
      { answer: '답', highlights: [] },
      {
        title: null,
        uploader: '<!channel> & *굵게*',
        platform: VideoPlatform.INSTAGRAM,
        videoId: 'DfQb_sJlcc1',
        frameCount: 1,
        transcriptSource: null,
      },
    );
    const heading = text.split('\n')[0];
    expect(heading).not.toContain('<!channel>');
    expect(heading).toContain('&lt;!channel&gt; &amp;');
  });

  it('인스타그램에서 올린 사람을 모르면 「인스타 릴스」만 쓴다', () => {
    const text = formatVideoWatch(
      { answer: '답', highlights: [] },
      {
        title: 'Video by someone',
        uploader: null,
        platform: VideoPlatform.INSTAGRAM,
        videoId: 'DfQb_sJlcc1',
        frameCount: 1,
        transcriptSource: null,
      },
    );
    expect(text.split('\n')[0]).toBe('🎬 *인스타 릴스*');
  });
});
