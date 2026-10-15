import { ArtJobListing } from '../domain/art-job-feed.type';
import {
  articleMentionsGame,
  filterKakaoCandidates,
  GameImageResolver,
} from './game-image.resolver';
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

const noRepresentative = {
  fetchRepresentativeGames: jest.fn().mockResolvedValue([]),
} as never;

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
      (
        await new GameImageResolver(kakaoOff(), noRepresentative).resolve(
          listing,
        )
      ).image,
    ).toEqual({
      url: 'https://play-lh.googleusercontent.com/right=w512',
      origin: 'PLAY_STORE',
    });
  });
  it('검색이 실패하면 회사명+게임명 구글 링크를 준다', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const result = await new GameImageResolver(
      kakaoOff(),
      noRepresentative,
    ).resolve(listing);
    expect(result.image).toBeNull();
    expect(result.googleSearchUrl).toBe(
      `https://www.google.com/search?tbm=isch&q=${encodeURIComponent('스마일게이트 카오스 제로 나이트메어')}`,
    );
  });
  it('게임명이 없으면 회사명+게임으로 구글 링크를 만든다', async () => {
    global.fetch = jest.fn();
    const result = await new GameImageResolver(
      kakaoOff(),
      noRepresentative,
    ).resolve({
      ...listing,
      title: '캐릭터 원화',
    });
    expect(result).toMatchObject({
      gameTitle: null,
      image: null,
      googleSearchUrl: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent('스마일게이트 게임')}`,
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
      const result = await new GameImageResolver(
        kakaoOff(),
        noRepresentative,
      ).resolve({
        ...listing,
        title,
      });
      expect(result.image !== null).toBe(matches);
    },
  );

  // 플레이스토어 검색은 빈 결과, 기사 페이지는 주어진 제목을 돌려준다.
  const mockPages = (articleTitles: Record<string, string>) => {
    global.fetch = jest.fn(async (url: string) => {
      const title = articleTitles[url];
      return {
        ok: true,
        status: 200,
        text: async () =>
          title === undefined ? '' : `<title>${title}</title>`,
      };
    }) as never;
  };

  it('기사 제목에 게임명이 있는 게임 매체 이미지를 쓴다', async () => {
    mockPages({
      'https://www.inven.co.kr/webzine/news/?news=1':
        '다른 게임 신작 소식 | 웹진',
      'https://www.inven.co.kr/webzine/news/?news=2':
        '&#039;카오스 제로 나이트메어&#039; 신규 캐릭터 공개',
    });
    const kakao = kakaoReturning([
      document({ docUrl: 'https://blog.example.com/fanart' }),
      document({
        docUrl: 'https://www.inven.co.kr/webzine/news/?news=1',
        imageUrl: 'https://img.inven.co.kr/other.jpg',
      }),
      document({ docUrl: 'https://www.inven.co.kr/webzine/news/?news=2' }),
    ]);
    const result = await new GameImageResolver(
      kakao as never,
      noRepresentative,
    ).resolve(listing);
    expect(kakao.search).toHaveBeenCalledWith(
      '스마일게이트 카오스 제로 나이트메어',
    );
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

  it('게임명을 확인한 기사가 없으면 이미지 없이 구글 검색 링크로 물러선다', async () => {
    mockPages({
      'https://www.inven.co.kr/webzine/news/?news=1': '도깨비의 세계 사전예약',
    });
    const kakao = kakaoReturning([
      document({ docUrl: 'https://www.inven.co.kr/webzine/news/?news=1' }),
    ]);
    const result = await new GameImageResolver(
      kakao as never,
      noRepresentative,
    ).resolve(listing);
    expect(result.image).toBeNull();
    expect(result.googleSearchUrl).not.toBeNull();
  });

  it('짧은 게임명은 기사 확인을 하지 않고 이미지 없이 둔다', async () => {
    mockPages({});
    const kakao = kakaoReturning([document()]);
    const result = await new GameImageResolver(
      kakao as never,
      noRepresentative,
    ).resolve({
      ...listing,
      title: '[NC] 캐릭터 원화',
      company: '회사',
    });
    expect(result.image).toBeNull();
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('inven.co.kr/webzine'),
      expect.anything(),
    );
  });

  it('확인 못 한 검색 그림은 어느 출처든 싣지 않는다', async () => {
    mockPages({});
    const kakao = kakaoReturning([
      document({
        docUrl: 'https://blog.naver.com/x',
        sourceName: '네이버블로그',
      }),
      document({
        docUrl: 'https://news.example.com/1',
        imageUrl: 'https://news.example.com/a.jpg',
        sourceName: '뉴스',
      }),
      document({
        docUrl: 'https://www.gamefocus.co.kr/1',
        imageUrl: 'https://gf/a.jpg',
        sourceName: '게임포커스',
      }),
    ]);
    const result = await new GameImageResolver(
      kakao as never,
      noRepresentative,
    ).resolve(listing);
    expect(result).toEqual({
      gameTitle: '카오스 제로 나이트메어',
      image: null,
      googleSearchUrl: expect.stringContaining('google.com'),
    });
  });

  it('카카오 검색이 실패해도 던지지 않는다', async () => {
    mockPages({});
    const kakao = {
      isEnabled: () => true,
      search: jest.fn().mockRejectedValue(new Error('401')),
    };
    const result = await new GameImageResolver(
      kakao as never,
      noRepresentative,
    ).resolve(listing);
    expect(result.image).toBeNull();
  });
});

describe('filterKakaoCandidates', () => {
  it('게임 매체가 아닌 출처와 작은 그림은 버리고, 하위 도메인은 인정한다', () => {
    expect(
      filterKakaoCandidates([
        document({ docUrl: 'https://cafe.daum.net/x' }),
        document({ width: 200 }),
        document({ docUrl: 'not a url' }),
        document({ docUrl: 'https://m.ruliweb.com/news/1' }),
      ]).map((candidate) => candidate.docUrl),
    ).toEqual(['https://m.ruliweb.com/news/1']);
  });
});

describe('articleMentionsGame', () => {
  it('og:title 안의 다른 따옴표에서 끊지 않고 엔티티를 풀어 비교한다', () => {
    const html =
      '<meta property="og:title" content="카카오게임즈 \'이터널 리턴\' 업데이트">';
    expect(articleMentionsGame(html, '이터널 리턴')).toBe(true);
  });

  it('content 가 property 보다 앞에 와도 읽는다', () => {
    const html =
      '<meta content="스마일게이트, &#039;로스트아크 모바일&#039; 채용" property="og:title">';
    expect(articleMentionsGame(html, '로스트아크 모바일')).toBe(true);
    expect(articleMentionsGame(html, 'LOST ARK Mobile')).toBe(false);
  });

  it('제목이 없으면 확인 실패다', () => {
    expect(articleMentionsGame('<html></html>', '이터널 리턴')).toBe(false);
  });
});

describe('GameImageResolver — 회사 대표게임', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  const untitled = { ...listing, title: '캐릭터 원화', company: '게임듀오' };
  const representatives = (names: string[] | Error) => ({
    fetchRepresentativeGames:
      names instanceof Error
        ? jest.fn().mockRejectedValue(names)
        : jest.fn().mockResolvedValue(names),
  });
  const playStoreWith = (appName: string) => {
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      text: async () =>
        url.includes(encodeURIComponent(appName.split(' ')[0]))
          ? `<div><a href="/store/apps/details?id=x" aria-label="${appName}"></a><img src="https://play-lh.googleusercontent.com/cat=s64"></div>`
          : '<div></div>',
    })) as never;
  };

  it('제목에 게임명이 없으면 대표게임의 플레이스토어 아이콘을 대표작으로 싣는다', async () => {
    playStoreWith('캣 히어로 : 방치형 RPG');
    const result = await new GameImageResolver(
      kakaoOff(),
      representatives(['어나더던전', '캣히어로']) as never,
    ).resolve(untitled);
    expect(result).toEqual({
      gameTitle: null,
      image: {
        url: 'https://play-lh.googleusercontent.com/cat=w512',
        origin: 'PLAY_STORE',
      },
      representativeGame: '캣히어로',
      googleSearchUrl: null,
    });
  });

  it('제목 게임명의 그림이 있으면 대표게임은 보지 않는다', async () => {
    playStoreWith('카오스 제로 나이트메어');
    const source = representatives(['캣히어로']);
    const result = await new GameImageResolver(
      kakaoOff(),
      source as never,
    ).resolve(listing);
    expect(result.representativeGame).toBeUndefined();
    expect(source.fetchRepresentativeGames).not.toHaveBeenCalled();
  });

  it('대표게임 조회가 실패하거나 일치가 없으면 구글 링크로 물러선다', async () => {
    playStoreWith('무관한 앱');
    for (const source of [
      representatives(new Error('offline')),
      representatives(['캣히어로']),
    ]) {
      const result = await new GameImageResolver(
        kakaoOff(),
        source as never,
      ).resolve(untitled);
      expect(result).toEqual({
        gameTitle: null,
        image: null,
        googleSearchUrl: expect.stringContaining('google.com'),
      });
    }
  });
});
