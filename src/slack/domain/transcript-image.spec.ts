import { selectTranscriptImages } from './transcript-image';

describe('selectTranscriptImages', () => {
  it('현재 메시지 사진을 이전 사용자 사진보다 먼저 고른다', () => {
    const file = {
      id: 'F',
      mimetype: 'image/png',
      size: 1,
      urlPrivateDownload: 'https://files.slack.com/file',
    };
    const result = selectTranscriptImages({
      messages: [
        { ts: '1', user: 'U', text: '', files: [file] },
        { ts: '2', user: 'U', text: '', files: [file] },
      ],
      currentTs: '2',
      speakerUserId: 'U',
    });
    expect(result.selected.map((image) => image.ts)).toEqual(['2', '1']);
  });
});

it('지원하지 않는 형식과 크기 초과 및 네 장을 넘는 사진을 건너뛴다', () => {
  const valid = {
    id: 'F',
    mimetype: 'image/png',
    size: 1,
    urlPrivateDownload: 'https://files.slack.com/file',
  };
  const result = selectTranscriptImages({
    messages: [
      {
        ts: '1',
        user: 'U',
        text: '',
        files: [
          valid,
          valid,
          valid,
          valid,
          valid,
          { ...valid, size: 5242881 },
          { ...valid, mimetype: 'application/pdf' },
        ],
      },
    ],
    speakerUserId: 'U',
  });
  expect(result.selected).toHaveLength(4);
  expect(result.skippedCount).toBe(3);
  expect(result.labels.get('1')).toEqual([1, 2, 3, 4]);
});
