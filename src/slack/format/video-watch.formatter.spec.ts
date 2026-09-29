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
          videoId: 'jNQXAC9IVRw',
          frameCount: 0,
          transcriptSource: null,
        },
      ),
    ).toContain('자막이 없어 화면만 보고 답했습니다');
  });
});
