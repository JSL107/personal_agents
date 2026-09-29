import { parseVideoWatchOutput } from './video-watch-output.parser';

describe('parseVideoWatchOutput', () => {
  it('parses answer and filters out-of-range highlights', () => {
    const output = JSON.stringify({
      answer: '영상의 핵심입니다.',
      highlights: [
        { timestampSec: 3, note: '장면 전환' },
        { timestampSec: 99, note: '길이 초과' },
        { timestampSec: -1, note: '음수' },
      ],
    });
    expect(parseVideoWatchOutput(output, 20)).toEqual({
      answer: '영상의 핵심입니다.',
      highlights: [{ timestampSec: 3, note: '장면 전환' }],
    });
  });

  it('rejects malformed model output', () => {
    expect(() => parseVideoWatchOutput('not json', null)).toThrow(
      'INVALID_MODEL_OUTPUT',
    );
    expect(() =>
      parseVideoWatchOutput('{"answer":3,"highlights":[]}', null),
    ).toThrow('INVALID_MODEL_OUTPUT');
  });
});
