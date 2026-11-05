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
  it.each([
    { ...payload, title: undefined },
    { ...payload, reelKey: 'bad' },
    { ...payload, caption: 'a'.repeat(2201) },
  ])('누락 또는 형식 오류를 거절한다: %p', (invalid) => {
    expect(() => parseReelPublishPayload(invalid)).toThrow();
  });
});
