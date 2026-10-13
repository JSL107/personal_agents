import { ArtJobListing } from '../domain/art-job-feed.type';
import { ArtJobSourcePort } from '../domain/port/art-job-feed.ports';
import { GameImageResolver } from './game-image.resolver';

const listing: ArtJobListing = {
  sourceId: '1',
  title: '[카오스 제로 나이트메어] 캐릭터 원화',
  company: '스마일게이트',
  detailUrl: 'https://example.com',
  deadlineText: null,
};

describe('GameImageResolver', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('selects a matching app and its icon', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<div><a href="/store/apps/details?id=wrong" aria-label="무관한 앱"></a><img src="https://play-lh.googleusercontent.com/wrong=s64"></div><div><a href="/store/apps/details?id=right" aria-label="카오스 제로 나이트메어"></a><img src="https://play-lh.googleusercontent.com/right=s64"></div>',
    });
    const source: ArtJobSourcePort = {
      fetchLatest: jest.fn(),
      fetchCompanyPhotoUrls: jest.fn(),
    };
    expect(
      (await new GameImageResolver(source).resolve(listing)).image,
    ).toEqual({
      url: 'https://play-lh.googleusercontent.com/right=w512',
      origin: 'PLAY_STORE',
    });
  });
  it('falls back to a company photo after search failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const source: ArtJobSourcePort = {
      fetchLatest: jest.fn(),
      fetchCompanyPhotoUrls: jest
        .fn()
        .mockResolvedValue(['https://example.com/photo.jpg']),
    };
    expect(
      (await new GameImageResolver(source).resolve(listing)).image?.origin,
    ).toBe('COMPANY_PHOTO');
  });
});
