import { ArtJobListing } from '../domain/art-job-feed.type';
import { GameImageResolver } from './game-image.resolver';

const listing: ArtJobListing = {
  sourceId: '1',
  title: '[카오스 제로 나이트메어] 캐릭터 원화',
  company: '스마일게이트',
  detailUrl: 'https://example.com',
  deadlineText: null,
  career: null,
  employmentType: null,
  location: null,
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
    expect((await new GameImageResolver().resolve(listing)).image).toEqual({
      url: 'https://play-lh.googleusercontent.com/right=w512',
      origin: 'PLAY_STORE',
    });
  });
  it('returns a game-title search link after search failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const result = await new GameImageResolver().resolve(listing);
    expect(result.image).toBeNull();
    expect(result.googleSearchUrl).toBe(
      `https://www.google.com/search?tbm=isch&q=${encodeURIComponent('카오스 제로 나이트메어')}`,
    );
  });
  it('returns no search link without a game title', async () => {
    global.fetch = jest.fn();
    const result = await new GameImageResolver().resolve({
      ...listing,
      title: '캐릭터 원화',
    });
    expect(result).toMatchObject({
      gameTitle: null,
      image: null,
      googleSearchUrl: null,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each([
    ['[NC] 원화', 'NCSOFT W', false],
    ['[카오스 제로 나이트메어] 원화', '카오스 제로 나이트메어', true],
    ['[브라운더스트2] 원화', '브라운더스트2 - 디지털 아트', true],
    ['[LOST ARK Mobile] 원화', 'LOST ARK', false],
  ])(
    'matches game title from %s against %s: %s',
    async (title, appName, matches) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          `<div><a href="/store/apps/details?id=game" aria-label="${appName}"></a><img src="https://play-lh.googleusercontent.com/game=s64"></div>`,
      });
      const result = await new GameImageResolver().resolve({
        ...listing,
        title,
      });
      expect(result.image !== null).toBe(matches);
    },
  );
});
