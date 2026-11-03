import { VideoPlatform } from '../../agent/video-watch/domain/video-watch.type';
import { formatVideoWatch } from './video-watch.formatter';

describe('formatVideoWatch', () => {
  it('formats linked highlights and the transcript/frame footer', () => {
    expect(
      formatVideoWatch(
        {
          answer: '핵심 *답변*',
          highlights: [{ timestampSec: 65, note: '전환 <장면>' }],
        },
        {
          title: '제목 *',
          platform: VideoPlatform.YOUTUBE,
          videoId: 'jNQXAC9IVRw',
          frameCount: 2,
          transcriptSource: 'captions',
        },
      ),
    ).toContain(
      '• <https://youtu.be/jNQXAC9IVRw?t=65|01:05> 전환 &lt;장면&gt;',
    );
    expect(
      formatVideoWatch(
        { answer: '답', highlights: [] },
        {
          title: null,
          platform: VideoPlatform.YOUTUBE,
          videoId: 'jNQXAC9IVRw',
          frameCount: 0,
          transcriptSource: null,
        },
      ),
    ).toContain('자막이 없어 화면만 보고 답했습니다');
  });

  it('인스타그램은 재생 시각 링크 없이 시각만 적는다', () => {
    const text = formatVideoWatch(
      { answer: '답', highlights: [{ timestampSec: 65, note: '장면' }] },
      {
        title: null,
        platform: VideoPlatform.INSTAGRAM,
        videoId: 'DfQb_sJlcc1',
        frameCount: 1,
        transcriptSource: null,
      },
    );
    expect(text).toContain('• 01:05 장면');
    expect(text).not.toContain('youtu.be');
  });
});
