import { ArtJobListing } from '../domain/art-job-feed.type';
import { GameImageResolver, pickKakaoImage } from './game-image.resolver';
import { KakaoImageDocument } from './kakao-image.search';

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

// 키가 없는 기본 상태 — 카카오 보강은 꺼져 있다.
const kakaoOff = () => {
  return { isEnabled: () => false, search: jest.fn() } as never;
};
const kakaoReturning = (documents: KakaoImageDocument[]) => {
  return {
    isEnabled: () => true,
    search: jest.fn().mockResolvedValue(documents),
  };
};
const document = (
  overrides: Partial<KakaoImageDocument> = {},
): KakaoImageDocument => ({
  imageUrl: 'https://img.inven.co.kr/a.jpg',
  docUrl: 'https://www.inven.co.kr/webzine/news/?news=1',
  sourceName: '인벤',
  width: 1200,
  height: 675,
  ...overrides,
});

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
    expect(
      (await new GameImageResolver(kakaoOff()).resolve(listing)).image,
    ).toEqual({
      url: 'https://play-lh.googleusercontent.com/right=w512',
      origin: 'PLAY_STORE',
    });
  });
  it('returns a game-title search link after search failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const result = await new GameImageResolver(kakaoOff()).resolve(listing);
    expect(result.image).toBeNull();
    expect(result.googleSearchUrl).toBe(
      `https://www.google.com/search?tbm=isch&q=${encodeURIComponent('카오스 제로 나이트메어')}`,
    );
  });
  it('returns no search link without a game title', async () => {
    global.fetch = jest.fn();
    const result = await new GameImageResolver(kakaoOff()).resolve({
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
      const result = await new GameImageResolver(kakaoOff()).resolve({
        ...listing,
        title,
      });
      expect(result.image !== null).toBe(matches);
    },
  );

  it('플레이스토어에 없으면 카카오 검색에서 게임 매체 이미지를 쓴다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => '' });
    const kakao = kakaoReturning([
      document({
        docUrl: 'https://blog.example.com/fanart',
        sourceName: '블로그',
      }),
      document(),
    ]);
    const result = await new GameImageResolver(kakao as never).resolve(listing);
    expect(kakao.search).toHaveBeenCalledWith('카오스 제로 나이트메어 게임');
    expect(result).toEqual({
      gameTitle: '카오스 제로 나이트메어',
      image: {
        url: 'https://img.inven.co.kr/a.jpg',
        origin: 'KAKAO_IMAGE',
        sourceName: '인벤',
      },
      googleSearchUrl: null,
    });
  });

  it('카카오 검색이 실패하면 구글 검색 링크로 물러선다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => '' });
    const kakao = {
      isEnabled: () => true,
      search: jest.fn().mockRejectedValue(new Error('401')),
    };
    const result = await new GameImageResolver(kakao as never).resolve(listing);
    expect(result.image).toBeNull();
    expect(result.googleSearchUrl).not.toBeNull();
  });
});

describe('pickKakaoImage', () => {
  it('게임 매체가 아닌 출처와 작은 그림은 버린다', () => {
    expect(
      pickKakaoImage([
        document({ docUrl: 'https://cafe.daum.net/x' }),
        document({ width: 200 }),
        document({ docUrl: 'not a url' }),
      ]),
    ).toBeNull();
  });

  it('하위 도메인도 매체로 인정하고, 사이트명이 없으면 호스트를 출처로 쓴다', () => {
    expect(
      pickKakaoImage([
        document({ docUrl: 'https://m.ruliweb.com/news/1', sourceName: '' }),
      ]),
    ).toEqual({
      url: 'https://img.inven.co.kr/a.jpg',
      origin: 'KAKAO_IMAGE',
      sourceName: 'm.ruliweb.com',
    });
  });
});
