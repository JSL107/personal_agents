import { KakaoImageSearch, parseKakaoImageSearch } from './kakao-image.search';

const config = (key: string | undefined) => {
  return { get: jest.fn(() => key) } as never;
};

describe('parseKakaoImageSearch', () => {
  it('필드가 다 찬 문서만 남긴다', () => {
    expect(
      parseKakaoImageSearch({
        documents: [
          {
            image_url: 'https://a/1.jpg',
            doc_url: 'https://www.inven.co.kr/1',
            display_sitename: '인벤',
            width: 800,
            height: 450,
          },
          { image_url: 'https://a/2.jpg', width: 800 },
        ],
      }),
    ).toEqual([
      {
        imageUrl: 'https://a/1.jpg',
        docUrl: 'https://www.inven.co.kr/1',
        sourceName: '인벤',
        width: 800,
        height: 450,
      },
    ]);
    expect(parseKakaoImageSearch({ errorType: 'x' })).toEqual([]);
  });
});

describe('KakaoImageSearch', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('키가 없으면 꺼져 있고 호출하지 않는다', async () => {
    global.fetch = jest.fn();
    const search = new KakaoImageSearch(config('  '));
    expect(search.isEnabled()).toBe(false);
    expect(await search.search('x')).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('KakaoAK 헤더로 정확도순 검색을 부른다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ documents: [] }),
    });
    await new KakaoImageSearch(config('KEY')).search('이터널 리턴 게임');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('query=%EC%9D%B4%ED%84%B0%EB%84%90');
    expect(url).toContain('sort=accuracy');
    expect(init.headers).toEqual({ Authorization: 'KakaoAK KEY' });
  });
});
