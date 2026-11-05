import { parseReelPublishPayload } from './reel-publish-payload.parser';

const payload = {
  reelKey: '2026-11-05/ai',
  field: 'ai',
  title: 'title',
  videoPath: '/video',
  videoSha256: 'hash',
  videoBytes: 12,
  caption: 'caption',
  durationSec: 30,
};

describe('parseReelPublishPayload', () => {
  it('정상 payload를 반환한다', () => {
    expect(parseReelPublishPayload(payload)).toEqual(payload);
  });
  it('하루 2편 시절 카드(새 키 없음)도 그대로 받는다', () => {
    expect(parseReelPublishPayload(payload).field).toBe('ai');
  });

  it('하루 1편 카드의 표지·꼭지·스토리를 받는다', () => {
    const daily = {
      ...payload,
      reelKey: '2026-11-06/daily',
      field: 'daily',
      coverOffsetMs: 29_750,
      segmentFields: ['ai', 'dev'],
      story: {
        videoPath: '/story',
        videoSha256: 'a'.repeat(64),
        videoBytes: 9,
      },
    };
    expect(parseReelPublishPayload(daily)).toEqual(daily);
  });

  it.each([
    { ...payload, title: undefined },
    { ...payload, reelKey: '2026-11-06/foo' },
    { ...payload, coverOffsetMs: 30_000 },
    { ...payload, coverOffsetMs: 1.5 },
    { ...payload, coverOffsetMs: -1 },
    { ...payload, segmentFields: ['ai', 'story'] },
    {
      ...payload,
      story: { videoPath: '/story', videoSha256: 'hash', videoBytes: 9 },
    },
    {
      ...payload,
      story: {
        videoPath: '/story',
        videoSha256: 'a'.repeat(64),
        videoBytes: 0,
      },
    },
    { ...payload, reelKey: 'bad' },
    { ...payload, caption: 'a'.repeat(2201) },
  ])('누락 또는 형식 오류를 거절한다: %p', (invalid) => {
    expect(() => parseReelPublishPayload(invalid)).toThrow();
  });
});
