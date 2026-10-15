import { GamejobSource } from './gamejob.source';

describe('GamejobSource', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('posts the ordered duty list', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => '<html></html>' });
    const result = await new GamejobSource().fetchLatest(2);
    expect(result.received).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://www.gamejob.co.kr/Recruit/_GI_Job_List/',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('page=2&direct=0&order=3&pagesize=40'),
      }),
    );
  });

  it('공고 iframe 을 같은 UA 와 상세 Referer 로 읽는다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        '<html><title>제목</title><body>북미풍 원화</body></html>',
    });
    const listing = {
      sourceId: '123',
      detailUrl: 'https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=123',
    };
    expect(await new GamejobSource().fetchPostingBody(listing as never)).toBe(
      '북미풍 원화',
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://www.gamejob.co.kr/Recruit/GI_Read_Comt_Ifrm?gno=123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: listing.detailUrl,
          'User-Agent': expect.any(String),
        }),
      }),
    );
  });

  it('상세 페이지의 모집분야·키워드·게임분야를 본문 뒤에 붙인다', async () => {
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      text: async () =>
        url.includes('Comt_Ifrm')
          ? '<html><body>배경 원화</body></html>'
          : '<dl class="recruit-data-item"><dt class="recruit-data-title">게임분야</dt><dd class="recruit-data-text">RPG, Casual</dd></dl>',
    })) as never;
    expect(
      await new GamejobSource().fetchPostingBody({
        sourceId: '1',
        detailUrl: 'https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=1',
      } as never),
    ).toBe('배경 원화\n게임분야: RPG, Casual');
  });

  it('상세 페이지를 못 읽어도 본문은 돌려준다', async () => {
    const body = (): Promise<string> =>
      Promise.resolve('<html><body>배경 원화</body></html>');
    const empty = (): Promise<string> => Promise.resolve('');
    global.fetch = jest.fn(async (url: string) =>
      url.includes('Comt_Ifrm')
        ? { ok: true, text: body }
        : { ok: false, status: 404, text: empty },
    ) as never;
    expect(
      await new GamejobSource().fetchPostingBody({
        sourceId: '1',
        detailUrl: 'https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=1',
      } as never),
    ).toBe('배경 원화');
  });

  it('공고 상세 → 회사 정보를 따라가 대표게임을 나눠 준다', async () => {
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      text: async () =>
        url.includes('GI_Read')
          ? '<a href="/Company/Detail?M=7">회사</a>'
          : '<dt>대표게임</dt><dd><span>캣히어로, 어나더던전</span></dd>',
    })) as never;
    const games = await new GamejobSource().fetchRepresentativeGames({
      detailUrl: 'https://www.gamejob.co.kr/Recruit/GI_Read/View?GI_No=1',
    } as never);
    expect(games).toEqual(['캣히어로', '어나더던전']);
    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://www.gamejob.co.kr/Company/Detail?M=7',
      expect.anything(),
    );
  });

  it('회사 정보 링크가 없으면 빈 배열이다', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, text: async () => '<html></html>' });
    expect(
      await new GamejobSource().fetchRepresentativeGames({
        detailUrl: 'https://x',
      } as never),
    ).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
